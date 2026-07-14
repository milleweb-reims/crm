// Génération de la facture Qonto d'un prospect payé, partagée entre le
// webhook GoCardless (automatique) et l'endpoint de rattrapage manuel
// (paiement reçu mais facture non générée : Qonto indisponible, erreur…).

import { Activity } from "@/lib/models/activity.model";
import { emitCrmEvent } from "@/lib/events";
import { sendEmail, type MailAttachment } from "@/lib/mailer";
import { createQontoInvoice, getQontoInvoicePdf } from "@/lib/qonto";

export interface PaidProspect {
  _id: { toString(): string };
  name: string;
  email?: string;
  emails?: { individual?: string; contact?: string };
  address?: { line1?: string; full?: string; city?: string; postalCode?: string };
  paidAmount?: number | null;
  qontoInvoiceId?: string | null;
  qontoInvoiceNumber?: string | null;
  qontoInvoiceUrl?: string | null;
  save(): Promise<unknown>;
}

// Tente de télécharger le PDF de la facture pour le joindre à l'email.
// Qonto génère le PDF (attachment) en asynchrone juste après la création de
// la facture : on retente quelques fois avant d'abandonner.
async function downloadInvoicePdf(invoiceId: string): Promise<MailAttachment | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 3000));
    try {
      const pdf = await getQontoInvoicePdf(invoiceId);
      if (pdf) return pdf;
    } catch {
      // on retente
    }
  }
  return null;
}

// Génère la facture client dans Qonto, l'enregistre sur la fiche et
// l'envoie au prospect s'il a un email. Renvoie la facture, ou null si la
// génération a échoué (déjà loggé) ou si le prospect n'a pas de montant payé.
export async function generateInvoice(
  prospect: PaidProspect,
  customerEmail: string | null
) {
  if (!prospect.paidAmount) return null;

  const prospectEmail =
    customerEmail ||
    prospect.email ||
    prospect.emails?.individual ||
    prospect.emails?.contact ||
    null;

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

  prospect.qontoInvoiceId = invoice.id;
  prospect.qontoInvoiceNumber = invoice.number || null;
  prospect.qontoInvoiceUrl = invoice.invoiceUrl || null;
  await prospect.save();

  await Activity.create({
    prospectId: prospect._id,
    userId: null,
    type: "payment",
    content: `🧾 Facture Qonto générée${invoice.number ? ` (n° ${invoice.number})` : ""}`,
    metadata: { qontoInvoiceId: invoice.id, invoiceUrl: invoice.invoiceUrl },
  });

  emitCrmEvent({
    type: "prospect:updated",
    prospectId: prospect._id.toString(),
    userId: "system",
    timestamp: Date.now(),
  });

  // Envoi de la facture au client (PDF joint si téléchargeable, sinon lien)
  if (prospectEmail) {
    const attachment = await downloadInvoicePdf(invoice.id);

    const sent = await sendEmail(
      prospectEmail,
      `Votre facture Milleweb${invoice.number ? ` — n° ${invoice.number}` : ""}`,
      `<h2>Merci pour votre paiement</h2>
       <p>Bonjour,</p>
       <p>Nous avons bien reçu votre paiement de <strong>${prospect.paidAmount.toLocaleString("fr-FR")} €</strong> pour la création de votre site web.</p>
       <p>${
         attachment
           ? "Vous trouverez votre facture en pièce jointe."
           : invoice.invoiceUrl
             ? `Votre facture est disponible ici : <a href="${invoice.invoiceUrl}">voir la facture</a>.`
             : "Votre facture vous sera transmise très prochainement."
       }</p>
       <p>À très vite,<br/>L'équipe Milleweb</p>`,
      attachment ? [attachment] : undefined
    );

    if (sent) {
      await Activity.create({
        prospectId: prospect._id,
        userId: null,
        type: "email",
        content: `🧾 Facture envoyée à ${prospectEmail}`,
        metadata: { qontoInvoiceId: invoice.id },
      });
    }
  }

  return invoice;
}
