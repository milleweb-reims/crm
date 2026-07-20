import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { connectDB } from "@/lib/db";
import { Prospect } from "@/lib/models/prospect.model";
import { Activity } from "@/lib/models/activity.model";
import { emitCrmEvent } from "@/lib/events";
import { sendAdminEmail } from "@/lib/mailer";
import { generateInvoice } from "@/lib/invoicing";

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
  readonly customerEmail: string | null;
  readonly customerName: string | null;
}

/**
 * Resolve payment details from GoCardless API.
 *
 * Fetches payment, mandate, and customer information via API calls.
 * Prospect matching via metadata: CRM links generate prospect_id on payment_request;
 * GoCardless copies this to the payment for direct matching.
 */
async function resolvePayment(paymentId: string): Promise<PaymentDetails> {
  const paymentRes = await gcGet(`/payments/${paymentId}`);
  const payment = paymentRes?.payments as
    | {
        amount?: number;
        metadata?: Record<string, string>;
        links?: { mandate?: string; billing_request?: string };
      }
    | undefined;

  if (!payment) {
    return {
      paymentId,
      amount: null,
      prospectId: null,
      billingRequestId: null,
      customerEmail: null,
      customerName: null,
    };
  }

  const mandateId = payment.links?.mandate;
  if (!mandateId) {
    return {
      paymentId,
      amount: typeof payment.amount === "number" ? payment.amount / 100 : null,
      prospectId: payment.metadata?.prospect_id || null,
      billingRequestId: payment.links?.billing_request || null,
      customerEmail: null,
      customerName: null,
    };
  }

  const mandateRes = await gcGet(`/mandates/${mandateId}`);
  const mandate = mandateRes?.mandates as { links?: { customer?: string } } | undefined;
  const customerId = mandate?.links?.customer;
  if (!customerId) {
    return {
      paymentId,
      amount: typeof payment.amount === "number" ? payment.amount / 100 : null,
      prospectId: payment.metadata?.prospect_id || null,
      billingRequestId: payment.links?.billing_request || null,
      customerEmail: null,
      customerName: null,
    };
  }

  const customerRes = await gcGet(`/customers/${customerId}`);
  const customer = customerRes?.customers as
    | { email?: string; company_name?: string; given_name?: string; family_name?: string }
    | undefined;

  if (!customer) {
    return {
      paymentId,
      amount: typeof payment.amount === "number" ? payment.amount / 100 : null,
      prospectId: payment.metadata?.prospect_id || null,
      billingRequestId: payment.links?.billing_request || null,
      customerEmail: null,
      customerName: null,
    };
  }

  return {
    paymentId,
    amount: typeof payment.amount === "number" ? payment.amount / 100 : null,
    prospectId: payment.metadata?.prospect_id || null,
    billingRequestId: payment.links?.billing_request || null,
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
  prospect.paidAmount = details.amount ?? prospect.quoteAmount ?? null;
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
 * Handle billing_requests/fulfilled event.
 * Emitted when user completes Instant Bank Pay flow (primary payment event).
 */
async function handleBillingRequestFulfilled(event: GcEvent): Promise<void> {
  const paymentId = event.links?.payment_request_payment;
  const billingRequestId = event.links?.billing_request || null;

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
      customerEmail: null,
      customerName: null,
    });
  }
}

/**
 * Handle payments/confirmed event.
 * Emitted for bank confirmation of mandates and redelivery payments.
 */
async function handlePaymentConfirmed(event: GcEvent): Promise<void> {
  const paymentId = event.links?.payment;
  if (!paymentId) return;
  await markPaid(await resolvePayment(paymentId));
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
