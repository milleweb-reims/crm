import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { connectDB } from "@/lib/db";
import { Prospect } from "@/lib/models/prospect.model";
import { Activity } from "@/lib/models/activity.model";
import { emitCrmEvent } from "@/lib/events";
import { sendAdminEmail } from "@/lib/mailer";
import { generateInvoice } from "@/lib/invoicing";

// Webhook GoCardless : quand un paiement est effectué, on marque le prospect
// comme payé, on trace l'activité et on notifie l'admin pour l'achat du domaine.
//
// Deux familles d'événements traitées :
// - billing_requests / fulfilled : le client a terminé le flow de paiement
//   (Instant Bank Pay) — l'événement principal de notre parcours.
// - payments / confirmed : confirmation bancaire (mandats, redélivrances).
//
// Env requises : GOCARDLESS_WEBHOOK_SECRET, GOCARDLESS_ACCESS_TOKEN
// Optionnelle : GOCARDLESS_ENVIRONMENT ("sandbox" pour les tests, live par défaut)

interface GcEvent {
  id: string;
  resource_type: string;
  action: string;
  links?: {
    payment?: string;
    billing_request?: string;
    payment_request_payment?: string;
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
  paymentId: string;
  amount: number | null;
  prospectId: string | null;
  billingRequestId: string | null;
  customerEmail: string | null;
  customerName: string | null;
}

async function resolvePayment(paymentId: string): Promise<PaymentDetails> {
  const details: PaymentDetails = {
    paymentId,
    amount: null,
    prospectId: null,
    billingRequestId: null,
    customerEmail: null,
    customerName: null,
  };

  const paymentRes = await gcGet(`/payments/${paymentId}`);
  const payment = paymentRes?.payments as
    | {
        amount?: number;
        metadata?: Record<string, string>;
        links?: { mandate?: string; billing_request?: string };
      }
    | undefined;
  if (!payment) return details;

  if (typeof payment.amount === "number") details.amount = payment.amount / 100;

  // Les liens générés par le CRM posent prospect_id en metadata sur le
  // payment_request ; GoCardless la recopie sur le paiement → matching direct.
  details.prospectId = payment.metadata?.prospect_id || null;
  details.billingRequestId = payment.links?.billing_request || null;

  const mandateId = payment.links?.mandate;
  if (!mandateId) return details;

  const mandateRes = await gcGet(`/mandates/${mandateId}`);
  const mandate = mandateRes?.mandates as { links?: { customer?: string } } | undefined;
  const customerId = mandate?.links?.customer;
  if (!customerId) return details;

  const customerRes = await gcGet(`/customers/${customerId}`);
  const customer = customerRes?.customers as
    | { email?: string; company_name?: string; given_name?: string; family_name?: string }
    | undefined;
  if (!customer) return details;

  details.customerEmail = customer.email || null;
  details.customerName =
    customer.company_name ||
    [customer.given_name, customer.family_name].filter(Boolean).join(" ") ||
    null;

  return details;
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

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

async function markPaid(details: PaymentDetails) {
  const prospect = await findProspect(details);

  if (prospect) {
    // Idempotence : GoCardless envoie plusieurs événements pour un même
    // paiement (fulfilled puis confirmed) et peut redéliver un webhook.
    if (prospect.gcPaymentId === details.paymentId || prospect.paidAt) {
      if (!prospect.gcPaymentId) {
        prospect.gcPaymentId = details.paymentId;
        await prospect.save();
      }
      return;
    }

    prospect.paidAt = new Date();
    prospect.paidAmount = details.amount ?? prospect.quoteAmount ?? null;
    prospect.gcPaymentId = details.paymentId;
    prospect.status = "paye";
    await prospect.save();

    // Facture Qonto en tâche de fond : la réponse au webhook n'attend pas
    generateInvoice(prospect, details.customerEmail).catch((error) =>
      console.error("Échec génération facture Qonto", {
        prospectId: prospect._id.toString(),
        error,
      })
    );

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

    emitCrmEvent({
      type: "prospect:updated",
      prospectId: prospect._id.toString(),
      userId: "system",
      timestamp: Date.now(),
    });
  } else {
    console.error("Webhook GoCardless : aucun prospect correspondant", details);
  }

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
    // Flow de paiement terminé par le client (Instant Bank Pay)
    if (event.resource_type === "billing_requests" && event.action === "fulfilled") {
      const paymentId = event.links?.payment_request_payment;
      const billingRequestId = event.links?.billing_request || null;

      if (paymentId) {
        const details = await resolvePayment(paymentId);
        details.billingRequestId = details.billingRequestId || billingRequestId;
        await markPaid(details);
      } else if (billingRequestId) {
        // Pas de paiement lié dans l'événement : matching par billing request
        await markPaid({
          paymentId: billingRequestId,
          amount: null,
          prospectId: null,
          billingRequestId,
          customerEmail: null,
          customerName: null,
        });
      }
      continue;
    }

    // Confirmation bancaire du paiement (mandats / redélivrances)
    if (event.resource_type === "payments" && event.action === "confirmed") {
      const paymentId = event.links?.payment;
      if (!paymentId) continue;
      await markPaid(await resolvePayment(paymentId));
    }
  }

  return NextResponse.json({ success: true });
}
