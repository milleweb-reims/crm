import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { connectDB } from "@/lib/db";
import { prospectPricing } from "@/lib/pricing-service";
import { Prospect } from "@/lib/models/prospect.model";
import { Activity } from "@/lib/models/activity.model";
import { emitCrmEvent } from "@/lib/events";
import { sendAdminEmail } from "@/lib/mailer";
import { generateInvoice, generateSubscriptionInvoice } from "@/lib/invoicing";
import {
  addOneMonthClamped,
  createSubscription,
  parseGcDate,
  toLocalDateString,
} from "@/lib/gocardless";
import { ttcFromHt } from "@/lib/vat";

type ProspectDoc = InstanceType<typeof Prospect> | null;

/**
 * GoCardless webhook handler for payment events.
 *
 * Processes two payment event families:
 * - `billing_requests/fulfilled`: User completes Instant Bank Pay flow (primary event)
 * - `payments/confirmed`: Bank confirmation for mandates and redeliveries
 *
 * When payment is confirmed, marks prospect as paid, logs activity, generates invoice,
 * and notifies admin to purchase the client's domain name.
 *
 * Requires environment variables:
 * - GOCARDLESS_WEBHOOK_SECRET: Webhook signature validation
 * - GOCARDLESS_ACCESS_TOKEN: API access
 * - GOCARDLESS_ENVIRONMENT: "sandbox" for tests, "live" (default) for production
 */

interface GcEvent {
  readonly id: string;
  readonly resource_type: string;
  readonly action: string;
  readonly links?: {
    readonly payment?: string;
    readonly billing_request?: string;
    readonly payment_request_payment?: string;
    readonly mandate_request_mandate?: string;
  };
}

const GC_API_BASE =
  process.env.GOCARDLESS_ENVIRONMENT === "sandbox"
    ? "https://api-sandbox.gocardless.com"
    : "https://api.gocardless.com";

async function gcGet(path: string): Promise<Record<string, unknown> | null> {
  const token = process.env.GOCARDLESS_ACCESS_TOKEN;
  if (!token) return null;

  const res = await fetch(`${GC_API_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "GoCardless-Version": "2015-07-06",
    },
  });
  if (!res.ok) {
    console.error("GoCardless API error", { path, status: res.status });
    return null;
  }
  return res.json();
}

interface PaymentDetails {
  readonly paymentId: string;
  readonly amount: number | null;
  readonly prospectId: string | null;
  readonly billingRequestId: string | null;
  readonly subscriptionId: string | null;
  readonly customerEmail: string | null;
  readonly customerName: string | null;
}

/**
 * Resolve payment details from GoCardless API.
 *
 * Fetches payment, mandate, and customer information via API calls.
 * Prospect matching via metadata: CRM links generate prospect_id on payment_request;
 * GoCardless copies this to the payment for direct matching. subscriptionId is set
 * when the payment was created by a subscription (monthly debit).
 */
async function resolvePayment(paymentId: string): Promise<PaymentDetails> {
  const paymentRes = await gcGet(`/payments/${paymentId}`);
  const payment = paymentRes?.payments as
    | {
        amount?: number;
        metadata?: Record<string, string>;
        links?: { mandate?: string; billing_request?: string; subscription?: string };
      }
    | undefined;

  if (!payment) {
    return {
      paymentId,
      amount: null,
      prospectId: null,
      billingRequestId: null,
      subscriptionId: null,
      customerEmail: null,
      customerName: null,
    };
  }

  const base: PaymentDetails = {
    paymentId,
    amount: typeof payment.amount === "number" ? payment.amount / 100 : null,
    prospectId: payment.metadata?.prospect_id || null,
    billingRequestId: payment.links?.billing_request || null,
    subscriptionId: payment.links?.subscription || null,
    customerEmail: null,
    customerName: null,
  };

  const mandateId = payment.links?.mandate;
  if (!mandateId) return base;

  const mandateRes = await gcGet(`/mandates/${mandateId}`);
  const mandate = mandateRes?.mandates as { links?: { customer?: string } } | undefined;
  const customerId = mandate?.links?.customer;
  if (!customerId) return base;

  const customerRes = await gcGet(`/customers/${customerId}`);
  const customer = customerRes?.customers as
    | { email?: string; company_name?: string; given_name?: string; family_name?: string }
    | undefined;

  if (!customer) return base;

  return {
    ...base,
    customerEmail: customer.email || null,
    customerName:
      customer.company_name ||
      [customer.given_name, customer.family_name].filter(Boolean).join(" ") ||
      null,
  };
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Find prospect by payment metadata, billing request ID, email, or name.
 * Attempts matching in priority order: ID → billing request → email → name.
 * Returns null if no prospect found in database.
 */
async function findProspect(details: PaymentDetails) {
  if (details.prospectId) {
    const byId = await Prospect.findById(details.prospectId).catch(() => null);
    if (byId) return byId;
  }

  if (details.billingRequestId) {
    const byBr = await Prospect.findOne({
      gcBillingRequestId: details.billingRequestId,
    });
    if (byBr) return byBr;
  }

  if (details.customerEmail) {
    const email = details.customerEmail.toLowerCase();
    const byEmail = await Prospect.findOne({
      $or: [
        { email: { $regex: `^${escapeRegex(email)}$`, $options: "i" } },
        { "emails.individual": { $regex: `^${escapeRegex(email)}$`, $options: "i" } },
        { "emails.contact": { $regex: `^${escapeRegex(email)}$`, $options: "i" } },
      ],
    });
    if (byEmail) return byEmail;
  }

  if (details.customerName) {
    const byName = await Prospect.findOne({
      name: { $regex: escapeRegex(details.customerName), $options: "i" },
    });
    if (byName) return byName;
  }

  return null;
}

/**
 * Check if prospect has already been marked as paid for this payment.
 * Returns true if payment is already processed (idempotence guard against
 * duplicate webhook deliveries and multi-event payments).
 */
function isAlreadyPaid(prospect: ProspectDoc, paymentId: string): boolean {
  if (!prospect) return false;
  return prospect.gcPaymentId === paymentId || !!prospect.paidAt;
}

/**
 * Record idempotence marker if payment link exists but prospect not yet marked paid.
 * Handles edge case where we recognize the payment but haven't completed the workflow.
 */
async function recordIdempotenceMarker(
  prospect: Exclude<ProspectDoc, null>,
  paymentId: string
): Promise<void> {
  if (!prospect.gcPaymentId) {
    prospect.gcPaymentId = paymentId;
    await prospect.save();
  }
}

/**
 * Update prospect with payment date, amount, payment ID, and status.
 */
async function updatePaidFields(
  prospect: Exclude<ProspectDoc, null>,
  details: PaymentDetails
): Promise<void> {
  prospect.paidAt = new Date();
  // Le montant vient de GoCardless, seule source de ce qui a réellement été
  // prélevé. Aucun repli sur un tarif configuré : il ne dirait rien du montant
  // encaissé, et les factures Qonto s'appuient sur ce champ.
  prospect.paidAmount = details.amount ?? null;
  prospect.gcPaymentId = details.paymentId;
  prospect.status = "paye";
  await prospect.save();
}

/**
 * Schedule background invoice generation (fire-and-forget, does not block webhook response).
 */
function scheduleInvoiceGeneration(
  prospect: Exclude<ProspectDoc, null>,
  customerEmail: string | null
): void {
  generateInvoice(prospect, customerEmail).catch((error) =>
    console.error("Échec génération facture Qonto", {
      prospectId: prospect._id.toString(),
      error,
    })
  );
}

/**
 * Record payment activity in prospect timeline.
 */
async function recordPaymentActivity(
  prospect: Exclude<ProspectDoc, null>,
  details: PaymentDetails
): Promise<void> {
  const amountLabel = prospect.paidAmount
    ? ` (${prospect.paidAmount.toLocaleString("fr-FR")} €)`
    : "";
  await Activity.create({
    prospectId: prospect._id,
    userId: null,
    type: "payment",
    content: `💰 Paiement reçu via GoCardless${amountLabel}`,
    metadata: {
      paymentId: details.paymentId,
      amount: prospect.paidAmount,
      email: details.customerEmail,
    },
  });
}

/**
 * Emit payment event for real-time subscribers and integrations.
 */
async function emitPaymentEvent(prospectId: string): Promise<void> {
  emitCrmEvent({
    type: "prospect:updated",
    prospectId,
    userId: "system",
    timestamp: Date.now(),
  });
}

/**
 * Notify admin of payment with prospect details and call-to-action for domain purchase.
 */
async function notifyAdminOfPayment(
  prospect: ProspectDoc,
  details: PaymentDetails
): Promise<void> {
  const prospectName = prospect?.name || details.customerName || "Client inconnu";
  const amount = details.amount ?? prospect?.paidAmount ?? null;
  await sendAdminEmail(
    `💰 Paiement reçu — ${prospectName} : acheter le nom de domaine`,
    `<h2>Paiement GoCardless confirmé</h2>
     <p><strong>Client :</strong> ${prospectName}</p>
     <p><strong>Email :</strong> ${details.customerEmail || "—"}</p>
     <p><strong>Montant :</strong> ${amount ? `${amount.toLocaleString("fr-FR")} €` : "—"}</p>
     <p><strong>Paiement :</strong> ${details.paymentId}</p>
     ${prospect ? `<p><a href="${process.env.NEXTAUTH_URL || ""}/prospects/${prospect._id}">Voir la fiche prospect</a></p>` : "<p>⚠️ Aucun prospect correspondant trouvé dans le CRM.</p>"}
     <p><strong>Action requise :</strong> acheter le nom de domaine du client.</p>`
  );
}

/**
 * Mark prospect as paid via payment details.
 * Orchestrates idempotence check, field updates, invoice generation, activity logging,
 * event emission, and admin notification in sequence.
 */
async function markPaid(details: PaymentDetails): Promise<void> {
  const prospect = await findProspect(details);

  if (prospect) {
    if (isAlreadyPaid(prospect, details.paymentId)) {
      await recordIdempotenceMarker(prospect, details.paymentId);
      return;
    }

    await updatePaidFields(prospect, details);
    scheduleInvoiceGeneration(prospect, details.customerEmail);
    await recordPaymentActivity(prospect, details);
    await emitPaymentEvent(prospect._id.toString());
  } else {
    console.error("Webhook GoCardless : aucun prospect correspondant", details);
  }

  await notifyAdminOfPayment(prospect, details);
}

/**
 * Resolve the mandate ID created by a fulfilled mandate billing request.
 * Uses the event link when present, falls back to fetching the billing request.
 */
async function resolveMandateId(
  event: GcEvent,
  billingRequestId: string
): Promise<string | null> {
  if (event.links?.mandate_request_mandate) {
    return event.links.mandate_request_mandate;
  }

  const brRes = await gcGet(`/billing_requests/${billingRequestId}`);
  const billingRequest = brRes?.billing_requests as
    | { mandate_request?: { links?: { mandate?: string } } }
    | undefined;
  return billingRequest?.mandate_request?.links?.mandate || null;
}

/**
 * Handle a fulfilled mandate billing request: record the signed mandate, then
 * automatically create the monthly subscription (first debit one month after
 * signature). Never touches the "payé" status — that belongs to the site
 * payment flow. Idempotent via gcSubscriptionId.
 */
async function handleMandateSigned(
  prospect: Exclude<ProspectDoc, null>,
  event: GcEvent,
  billingRequestId: string
): Promise<void> {
  if (prospect.gcSubscriptionId) return;

  const mandateId = await resolveMandateId(event, billingRequestId);
  if (!mandateId) {
    console.error("Webhook GoCardless : mandat introuvable pour la billing request", {
      billingRequestId,
      prospectId: prospect._id.toString(),
    });
    return;
  }

  const signedAt = prospect.mandateSignedAt ?? new Date();
  prospect.gcMandateId = mandateId;
  prospect.mandateSignedAt = signedAt;
  await prospect.save();

  await Activity.create({
    prospectId: prospect._id,
    userId: null,
    type: "payment",
    content: "✍️ Mandat de prélèvement signé",
    metadata: { mandateId, billingRequestId },
  });

  // Tarif du closer qui détient la fiche, au moment de créer l'abonnement.
  const { subscriptionAmount: amountHt } = await prospectPricing(
    prospect.assignedTo
  );
  // Premier prélèvement un mois après la signature, clampé en fin de mois
  const startDate = addOneMonthClamped(signedAt);

  try {
    const { subscriptionId, startDate: scheduledStart } = await createSubscription({
      mandateId,
      prospectId: prospect._id.toString(),
      prospectName: prospect.name,
      monthlyAmountHt: amountHt,
      startDate: toLocalDateString(startDate),
    });

    prospect.gcSubscriptionId = subscriptionId;
    prospect.subscriptionStartDate = scheduledStart ? parseGcDate(scheduledStart) : startDate;
    await prospect.save();

    const startLabel = prospect.subscriptionStartDate.toLocaleDateString("fr-FR", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
    await Activity.create({
      prospectId: prospect._id,
      userId: null,
      type: "payment",
      content: `🔁 Abonnement créé (${amountHt.toLocaleString("fr-FR")} € HT/mois — ${ttcFromHt(amountHt).toLocaleString("fr-FR")} € TTC) — 1er prélèvement le ${startLabel}`,
      metadata: { subscriptionId, mandateId, amount: amountHt },
    });

    await sendAdminEmail(
      `✍️ Mandat signé — ${prospect.name} : abonnement démarré`,
      `<h2>Mandat GoCardless signé</h2>
       <p><strong>Client :</strong> ${prospect.name}</p>
       <p><strong>Abonnement :</strong> ${amountHt.toLocaleString("fr-FR")} € HT/mois (${ttcFromHt(amountHt).toLocaleString("fr-FR")} € TTC)</p>
       <p><strong>1er prélèvement :</strong> ${startLabel}</p>
       <p><a href="${process.env.NEXTAUTH_URL || ""}/prospects/${prospect._id}">Voir la fiche prospect</a></p>`
    );
  } catch (error) {
    console.error("Échec création abonnement après signature du mandat", {
      prospectId: prospect._id.toString(),
      mandateId,
      error,
    });
    await sendAdminEmail(
      `⚠️ Mandat signé — ${prospect.name} : échec de création de l'abonnement`,
      `<h2>Abonnement à créer manuellement</h2>
       <p>Le mandat <strong>${mandateId}</strong> est signé mais la création de
       l'abonnement (${amountHt.toLocaleString("fr-FR")} € HT/mois) a échoué dans GoCardless.</p>
       <p><a href="${process.env.NEXTAUTH_URL || ""}/prospects/${prospect._id}">Voir la fiche prospect</a></p>`
    );
  }

  await emitPaymentEvent(prospect._id.toString());
}

/** Alerts admin that a subscription debit has no Qonto invoice (manual action). */
async function notifyAdminSubscriptionInvoiceFailed(
  prospect: Exclude<ProspectDoc, null>,
  details: PaymentDetails,
  amountTtc: number
): Promise<void> {
  await sendAdminEmail(
    `⚠️ Facture abonnement non générée — ${prospect.name}`,
    `<h2>Prélèvement reçu mais facture Qonto manquante</h2>
     <p><strong>Client :</strong> ${prospect.name}</p>
     <p><strong>Montant prélevé :</strong> ${amountTtc.toLocaleString("fr-FR")} € TTC</p>
     <p><strong>Paiement :</strong> ${details.paymentId}</p>
     <p><a href="${process.env.NEXTAUTH_URL || ""}/prospects/${prospect._id}">Voir la fiche prospect</a></p>
     <p><strong>Action requise :</strong> créer la facture dans Qonto, ou renvoyer
     l'événement webhook depuis le dashboard GoCardless (la facture sera alors retentée).</p>`
  ).catch((error) => console.error("Échec email admin facture abonnement", { error }));
}

/**
 * Record a monthly subscription debit in the prospect timeline and generate
 * its Qonto invoice. Subscription payments must never mark the prospect "payé"
 * nor trigger the site invoice — that flow belongs to the one-off site payment.
 */
async function recordSubscriptionPayment(details: PaymentDetails): Promise<void> {
  const prospect = await Prospect.findOne({ gcSubscriptionId: details.subscriptionId });
  if (!prospect) {
    console.error("Webhook GoCardless : prélèvement abonnement sans prospect", details);
    return;
  }

  const amountLabel = details.amount
    ? ` (${details.amount.toLocaleString("fr-FR")} €)`
    : "";

  // Idempotence relivraisons : claim de l'activité de prélèvement par upsert
  // atomique (un findOne puis create laisserait passer deux livraisons
  // simultanées). Renvoie null si l'activité vient d'être créée par cet appel.
  const existingDebit = await Activity.findOneAndUpdate(
    {
      prospectId: prospect._id,
      "metadata.paymentId": details.paymentId,
      "metadata.subscriptionId": { $exists: true },
    },
    {
      $setOnInsert: {
        userId: null,
        type: "payment",
        content: `💰 Prélèvement abonnement reçu${amountLabel}`,
        "metadata.subscriptionId": details.subscriptionId,
        "metadata.amount": details.amount,
      },
    },
    { upsert: true, new: false }
  );

  // La facture a sa propre garde : un échec Qonto passé ne doit pas être masqué
  // par l'activité de prélèvement déjà présente — une relivraison du webhook
  // (ou un renvoi manuel depuis le dashboard GoCardless) retente la facture.
  const existingInvoice = await Activity.findOne({
    prospectId: prospect._id,
    "metadata.paymentId": details.paymentId,
    "metadata.qontoInvoiceId": { $exists: true },
  });

  if (!existingInvoice) {
    // Jamais de repli sur le tarif configuré : sur un abonnement lancé plus
    // tôt, il ne dit rien de ce qui a été prélevé, et une facture au mauvais
    // montant est pire que pas de facture. La branche `else` alerte l'admin.
    const amountTtc = details.amount ?? 0;

    if (amountTtc > 0) {
      // En arrière-plan : ne bloque pas la réponse webhook
      generateSubscriptionInvoice({
        prospect,
        amountTtc,
        customerEmail: details.customerEmail,
        paymentId: details.paymentId,
      })
        .then((invoice) =>
          invoice
            ? undefined
            : notifyAdminSubscriptionInvoiceFailed(prospect, details, amountTtc)
        )
        .catch((error) => {
          console.error("Échec génération facture abonnement", {
            prospectId: prospect._id.toString(),
            paymentId: details.paymentId,
            error,
          });
          return notifyAdminSubscriptionInvoiceFailed(prospect, details, amountTtc);
        });
    } else {
      // Montant nul/négatif (litige, avoir…) : ni facture au montant configuré
      // (rien n'a été prélevé), ni facture à 0 € — signalement admin.
      console.error("Prélèvement abonnement à montant non positif — facture non générée", details);
      await notifyAdminSubscriptionInvoiceFailed(prospect, details, amountTtc);
    }
  }

  if (!existingDebit) {
    await emitPaymentEvent(prospect._id.toString());
  }
}

/**
 * Handle billing_requests/fulfilled event.
 * Mandate billing requests (subscription setup) are routed to the mandate flow;
 * payment billing requests follow the Instant Bank Pay flow (primary payment event).
 */
async function handleBillingRequestFulfilled(event: GcEvent): Promise<void> {
  const paymentId = event.links?.payment_request_payment;
  const billingRequestId = event.links?.billing_request || null;

  if (billingRequestId) {
    const mandateProspect = await Prospect.findOne({
      gcMandateBillingRequestId: billingRequestId,
    });
    if (mandateProspect) {
      await handleMandateSigned(mandateProspect, event, billingRequestId);
      return;
    }
  }

  if (paymentId) {
    const details = await resolvePayment(paymentId);
    await markPaid({
      ...details,
      billingRequestId: details.billingRequestId || billingRequestId,
    });
  } else if (billingRequestId) {
    // Fallback: match by billing request ID if payment ID not in event
    await markPaid({
      paymentId: billingRequestId,
      amount: null,
      prospectId: null,
      billingRequestId,
      subscriptionId: null,
      customerEmail: null,
      customerName: null,
    });
  }
}

/**
 * Handle payments/confirmed event.
 * Emitted for bank confirmation of mandates and redeliveries — including the
 * monthly subscription debits, which are only logged in the timeline.
 */
async function handlePaymentConfirmed(event: GcEvent): Promise<void> {
  const paymentId = event.links?.payment;
  if (!paymentId) return;

  const details = await resolvePayment(paymentId);

  if (details.subscriptionId) {
    await recordSubscriptionPayment(details);
    return;
  }

  await markPaid(details);
}

export async function POST(req: NextRequest) {
  const secret = process.env.GOCARDLESS_WEBHOOK_SECRET;
  if (!secret) {
    console.error("GOCARDLESS_WEBHOOK_SECRET manquant");
    return NextResponse.json({ error: "Webhook non configuré" }, { status: 500 });
  }

  const rawBody = await req.text();
  const signature = req.headers.get("webhook-signature") || "";
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");

  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return NextResponse.json({ error: "Signature invalide" }, { status: 498 });
  }

  const { events } = JSON.parse(rawBody) as { events: GcEvent[] };

  await connectDB();

  for (const event of events ?? []) {
    if (event.resource_type === "billing_requests" && event.action === "fulfilled") {
      await handleBillingRequestFulfilled(event);
      continue;
    }

    if (event.resource_type === "payments" && event.action === "confirmed") {
      await handlePaymentConfirmed(event);
    }
  }

  return NextResponse.json({ success: true });
}
