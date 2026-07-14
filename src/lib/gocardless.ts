// Client API GoCardless : génération de liens de paiement par prospect.
// Billing request (Instant Bank Pay avec repli prélèvement) + billing request flow
// → authorisation_url à partager avec le client.
// Env requises : GOCARDLESS_ACCESS_TOKEN
// Optionnelle : GOCARDLESS_ENVIRONMENT ("sandbox" pour les tests, live par défaut)

import { ttcFromHt } from "./vat";

const GC_API_BASE =
  process.env.GOCARDLESS_ENVIRONMENT === "sandbox"
    ? "https://api-sandbox.gocardless.com"
    : "https://api.gocardless.com";

export class GoCardlessError extends Error {
  constructor(
    message: string,
    public status?: number
  ) {
    super(message);
    this.name = "GoCardlessError";
  }
}

async function gcPost(
  path: string,
  body: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const token = process.env.GOCARDLESS_ACCESS_TOKEN;
  if (!token) {
    throw new GoCardlessError(
      "GoCardless non configuré (GOCARDLESS_ACCESS_TOKEN manquant)"
    );
  }

  const res = await fetch(`${GC_API_BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "GoCardless-Version": "2015-07-06",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errorBody = await res.text().catch(() => "");
    console.error("GoCardless API error", { path, status: res.status, body: errorBody });
    throw new GoCardlessError(
      res.status === 401
        ? "Token GoCardless invalide ou expiré (GOCARDLESS_ACCESS_TOKEN)"
        : `Erreur GoCardless (${res.status})`,
      res.status
    );
  }

  return res.json();
}

interface ProspectPaymentInput {
  id: string;
  name: string;
  email?: string | null;
  quoteAmount: number; // en euros HT — le client paie le TTC
}

export interface ProspectPaymentLink {
  billingRequestId: string;
  url: string;
}

// Crée une billing request (paiement one-off du montant du devis) puis le flow
// hébergé associé. metadata.prospect_id est posée sur le payment_request :
// GoCardless la recopie sur le paiement final, ce qui permet au webhook de
// retrouver le prospect sans matching email/nom.
export async function createProspectPaymentLink(
  prospect: ProspectPaymentInput
): Promise<ProspectPaymentLink> {
  const brRes = await gcPost("/billing_requests", {
    billing_requests: {
      payment_request: {
        description: `Site web — ${prospect.name}`,
        // Le devis est HT : le client paie le TTC (TVA en sus)
        amount: Math.round(ttcFromHt(prospect.quoteAmount) * 100),
        currency: "EUR",
        metadata: { prospect_id: prospect.id },
      },
      fallback_enabled: true,
      metadata: { prospect_id: prospect.id },
    },
  });

  const billingRequest = brRes.billing_requests as { id: string };

  const flowRes = await gcPost("/billing_request_flows", {
    billing_request_flows: {
      links: { billing_request: billingRequest.id },
      prefilled_customer: {
        company_name: prospect.name,
        ...(prospect.email ? { email: prospect.email } : {}),
      },
    },
  });

  const flow = flowRes.billing_request_flows as { authorisation_url: string };

  return { billingRequestId: billingRequest.id, url: flow.authorisation_url };
}

// Annulation best effort de l'ancienne billing request lors d'une régénération.
// Une billing request déjà complétée ou annulée renvoie une erreur : on ignore.
export async function cancelBillingRequest(billingRequestId: string) {
  try {
    await gcPost(`/billing_requests/${billingRequestId}/actions/cancel`, {});
  } catch (error) {
    console.error("Annulation billing request ignorée", { billingRequestId, error });
  }
}
