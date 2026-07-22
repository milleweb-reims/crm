/**
 * Client API GoCardless : génération de liens de paiement par prospect.
 * Billing request (Instant Bank Pay avec repli prélèvement) + billing request flow
 * → authorisation_url à partager avec le client.
 * Env requises : GOCARDLESS_ACCESS_TOKEN
 * Optionnelle : GOCARDLESS_ENVIRONMENT ("sandbox" pour les tests, live par défaut)
 */

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
  body: Readonly<Record<string, unknown>>,
  idempotencyKey?: string
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
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
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
  readonly id: string;
  readonly name: string;
  readonly email?: string | null;
  readonly quoteAmount: number; // en euros HT — le client paie le TTC
}

export interface ProspectPaymentLink {
  readonly billingRequestId: string;
  readonly url: string;
}

/**
 * Creates a billing request for the prospect's quote amount, then the associated
 * hosted payment flow. Sets prospect_id in metadata on the payment_request;
 * GoCardless copies this to the final payment, enabling webhook to identify
 * the prospect without email/name matching.
 */
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

interface ProspectMandateInput {
  readonly id: string;
  readonly name: string;
  readonly email?: string | null;
}

export interface ProspectMandateLink {
  readonly billingRequestId: string;
  readonly url: string;
}

/**
 * Creates a mandate-only billing request (SEPA direct debit, no payment) and its
 * hosted flow. The signed mandate alone never charges the customer: the monthly
 * subscription is created by the webhook once the billing request is fulfilled.
 * The webhook tells mandate billing requests apart from payment ones by looking
 * up gcMandateBillingRequestId on the prospect; metadata is informational.
 */
export async function createProspectMandateLink(
  prospect: ProspectMandateInput
): Promise<ProspectMandateLink> {
  const brRes = await gcPost("/billing_requests", {
    billing_requests: {
      mandate_request: {
        scheme: "sepa_core",
        currency: "EUR",
      },
      metadata: { prospect_id: prospect.id, purpose: "subscription_mandate" },
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

/**
 * Adds one month to a date, clamped to the last day of the target month
 * (31 janvier → 28/29 février, jamais le 2-3 mars par débordement JS).
 */
export function addOneMonthClamped(date: Date): Date {
  const result = new Date(date);
  const day = result.getDate();
  result.setMonth(result.getMonth() + 1);
  if (result.getDate() !== day) result.setDate(0);
  return result;
}

/** Format a Date as local YYYY-MM-DD (toISOString shifts the day near midnight). */
export function toLocalDateString(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Parse a GoCardless YYYY-MM-DD date as local time (UTC parsing shifts the day). */
export function parseGcDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
}

interface SubscriptionInput {
  readonly mandateId: string;
  readonly prospectId: string;
  readonly prospectName: string;
  readonly monthlyAmountHt: number; // en euros HT — le client est prélevé du TTC
  // YYYY-MM-DD, doit être ≥ next_possible_charge_date du mandat.
  // Omis → GoCardless prélève à la première date possible.
  readonly startDate?: string;
}

export interface CreatedSubscription {
  readonly subscriptionId: string;
  readonly startDate: string | null;
}

/**
 * Creates the monthly subscription on a signed mandate. GoCardless may adjust
 * the start date (bank holidays, charge windows): the returned startDate is the
 * one actually scheduled. The deterministic idempotency key makes GoCardless
 * dedupe concurrent creations (webhook vs rattrapage manuel) — a given
 * prospect+mandat pair can never get two subscriptions.
 */
export async function createSubscription(
  input: SubscriptionInput
): Promise<CreatedSubscription> {
  const res = await gcPost(
    "/subscriptions",
    {
      subscriptions: {
        amount: Math.round(ttcFromHt(input.monthlyAmountHt) * 100),
        currency: "EUR",
        name: `Abonnement site — ${input.prospectName}`.slice(0, 255),
        interval_unit: "monthly",
        ...(input.startDate ? { start_date: input.startDate } : {}),
        links: { mandate: input.mandateId },
        metadata: { prospect_id: input.prospectId },
      },
    },
    `subscription-${input.prospectId}-${input.mandateId}`
  );

  const subscription = res.subscriptions as { id: string; start_date?: string };

  return {
    subscriptionId: subscription.id,
    startDate: subscription.start_date ?? input.startDate ?? null,
  };
}

/**
 * Best-effort cancellation of a previous billing request during regeneration.
 * Already-completed or already-cancelled requests return errors that are silently ignored.
 */
export async function cancelBillingRequest(billingRequestId: string) {
  try {
    await gcPost(`/billing_requests/${billingRequestId}/actions/cancel`, {});
  } catch (error) {
    console.error("Annulation billing request ignorée", { billingRequestId, error });
  }
}
