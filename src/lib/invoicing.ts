/**
 * Génération de la facture Qonto d'un prospect payé, partagée entre le
 * webhook GoCardless (automatique) et l'endpoint de rattrapage manuel
 * (paiement reçu mais facture non générée : Qonto indisponible, erreur…).
 */

import { Activity } from "@/lib/models/activity.model";
import { emitCrmEvent } from "@/lib/events";
import { sendEmail, type MailAttachment } from "@/lib/mailer";
import { createQontoInvoice, getQontoInvoicePdf } from "@/lib/qonto";

/** Prospect with payment and invoicing information */
export interface PaidProspect {
  readonly _id: { toString(): string };
  readonly name: string;
  readonly email?: string;
  readonly emails?: { readonly individual?: string; readonly contact?: string };
  readonly address?: { readonly line1?: string; readonly full?: string; readonly city?: string; readonly postalCode?: string };
  readonly paidAmount?: number | null;
  /** Written by persistInvoiceOnProspect once the Qonto invoice is created. */
  qontoInvoiceId?: string | null;
  qontoInvoiceNumber?: string | null;
  qontoInvoiceUrl?: string | null;
  save(): Promise<unknown>;
}

/**
 * Attempts to download the invoice PDF for email attachment.
 * Qonto generates PDFs asynchronously, so retries up to 3 times with 3-second delays.
 */
async function downloadInvoicePdf(invoiceId: string): Promise<MailAttachment | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 3000));
    try {
      const pdf = await getQontoInvoicePdf(invoiceId);
      if (pdf) return pdf;
    } catch {
      // continue retrying
    }
  }
  return null;
}

/** Resolves prospect email from multiple sources in order of priority */
function resolveProspectEmail(
  prospect: PaidProspect,
  customerEmail: string | null
): string | null {
  return (
    customerEmail ||
    prospect.email ||
    prospect.emails?.individual ||
    prospect.emails?.contact ||
    null
  );
}

/** Persists Qonto invoice data to prospect document and saves to database */
async function persistInvoiceOnProspect(
  prospect: PaidProspect,
  invoice: { readonly id: string; readonly number?: string; readonly invoiceUrl?: string }
): Promise<void> {
  prospect.qontoInvoiceId = invoice.id;
  prospect.qontoInvoiceNumber = invoice.number || null;
  prospect.qontoInvoiceUrl = invoice.invoiceUrl || null;
  await prospect.save();
}

/** Records invoice generation activity in prospect history */
async function recordInvoiceActivity(options: {
  readonly prospectId: { toString(): string };
  readonly invoiceId: string;
  readonly invoiceNumber: string | undefined;
}): Promise<void> {
  await Activity.create({
    prospectId: options.prospectId,
    userId: null,
    type: "payment",
    content: `🧾 Facture Qonto générée${options.invoiceNumber ? ` (n° ${options.invoiceNumber})` : ""}`,
    metadata: { qontoInvoiceId: options.invoiceId },
  });
}

/** Emits prospect updated event for cache invalidation */
function emitProspectUpdatedEvent(prospectId: string): void {
  emitCrmEvent({
    type: "prospect:updated",
    prospectId,
    userId: "system",
    timestamp: Date.now(),
  });
}

/** Builds HTML email content for invoice notification */
function buildInvoiceEmailHtml(options: {
  readonly paidAmount: number;
  readonly attachment: MailAttachment | null;
  readonly invoiceNumber: string | undefined;
  readonly invoiceUrl: string | undefined;
}): string {
  const invoiceInfo =
    options.attachment
      ? "Vous trouverez votre facture en pièce jointe."
      : options.invoiceUrl
        ? `Votre facture est disponible ici : <a href="${options.invoiceUrl}">voir la facture</a>.`
        : "Votre facture vous sera transmise très prochainement.";

  return `<h2>Merci pour votre paiement</h2>
       <p>Bonjour,</p>
       <p>Nous avons bien reçu votre paiement de <strong>${options.paidAmount.toLocaleString("fr-FR")} €</strong> pour la création de votre site web.</p>
       <p>${invoiceInfo}</p>
       <p>À très vite,<br/>L'équipe Milleweb</p>`;
}

/**
 * Sends invoice email to prospect with PDF attachment if available.
 * Returns true if email was sent successfully, false otherwise.
 */
async function sendInvoiceEmail(options: {
  readonly prospectEmail: string;
  readonly prospectName: string;
  readonly paidAmount: number;
  readonly invoiceId: string;
  readonly invoiceNumber: string | undefined;
  readonly invoiceUrl: string | undefined;
  readonly prospectId: { toString(): string };
}): Promise<boolean> {
  const attachment = await downloadInvoicePdf(options.invoiceId);
  const html = buildInvoiceEmailHtml({
    paidAmount: options.paidAmount,
    attachment,
    invoiceNumber: options.invoiceNumber,
    invoiceUrl: options.invoiceUrl,
  });

  const sent = await sendEmail({
    to: options.prospectEmail,
    subject: `Votre facture Milleweb${options.invoiceNumber ? ` — n° ${options.invoiceNumber}` : ""}`,
    html,
    attachments: attachment ? [attachment] : undefined,
  });

  if (sent) {
    await recordEmailSentActivity({
      prospectId: options.prospectId,
      email: options.prospectEmail,
      invoiceId: options.invoiceId,
    });
  }

  return sent;
}

/** Records email delivery activity in prospect history */
async function recordEmailSentActivity(options: {
  readonly prospectId: { toString(): string };
  readonly email: string;
  readonly invoiceId: string;
}): Promise<void> {
  await Activity.create({
    prospectId: options.prospectId,
    userId: null,
    type: "email",
    content: `🧾 Facture envoyée à ${options.email}`,
    metadata: { qontoInvoiceId: options.invoiceId },
  });
}

/**
 * Generates invoice in Qonto, persists to prospect record, and sends via email.
 * Returns the created invoice, or null if generation failed or prospect has no paid amount.
 * Orchestrates email resolution, invoice creation, persistence, activity logging, and email delivery.
 */
export async function generateInvoice(
  prospect: PaidProspect,
  customerEmail: string | null
) {
  if (!prospect.paidAmount) return null;

  const prospectEmail = resolveProspectEmail(prospect, customerEmail);

  const invoice = await createQontoInvoice({
    name: prospect.name,
    email: prospectEmail,
    streetAddress: prospect.address?.line1 || prospect.address?.full || null,
    city: prospect.address?.city || null,
    zipCode: prospect.address?.postalCode || null,
    amount: prospect.paidAmount,
    title: "Création de site web",
  });

  if (!invoice) return null;

  await persistInvoiceOnProspect(prospect, invoice);
  await recordInvoiceActivity({
    prospectId: prospect._id,
    invoiceId: invoice.id,
    invoiceNumber: invoice.number,
  });
  emitProspectUpdatedEvent(prospect._id.toString());

  if (prospectEmail) {
    await sendInvoiceEmail({
      prospectEmail,
      prospectName: prospect.name,
      paidAmount: prospect.paidAmount,
      invoiceId: invoice.id,
      invoiceNumber: invoice.number,
      invoiceUrl: invoice.invoiceUrl,
      prospectId: prospect._id,
    });
  }

  return invoice;
}
