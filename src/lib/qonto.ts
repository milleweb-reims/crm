// Génération de factures client dans Qonto à la réception d'un paiement.
// API : https://docs.qonto.com (Business API, clé en header Authorization).
//
// Env requises :
// - QONTO_API_KEY : "login-organisation:clé-secrète" (Qonto → Paramètres → API)
// - QONTO_IBAN    : IBAN du compte Qonto affiché sur la facture
// Optionnelle :
// - QONTO_VAT_RATE : taux de TVA (défaut "0.2" ; "0" si franchise en base)

const QONTO_API_BASE = "https://thirdparty.qonto.com";

interface QontoInvoiceInput {
  name: string;
  email?: string | null;
  city?: string | null;
  zipCode?: string | null;
  streetAddress?: string | null;
  amount: number; // TTC en euros
  title?: string;
}

export interface QontoInvoice {
  id: string;
  number?: string;
  invoiceUrl?: string;
}

export interface QontoInvoicePdf {
  filename: string;
  content: Buffer;
}

async function qontoFetch(
  path: string,
  init?: RequestInit
): Promise<Record<string, unknown> | null> {
  const apiKey = process.env.QONTO_API_KEY;
  if (!apiKey) {
    console.error("Qonto non configuré (QONTO_API_KEY manquante) — facture non générée");
    return null;
  }

  const res = await fetch(`${QONTO_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: apiKey,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error("Qonto API error", { path, status: res.status, body });
    return null;
  }
  return res.json();
}

// Qonto refuse de facturer un client sans adresse : placeholder si inconnue.
function billingAddress(input: QontoInvoiceInput) {
  return {
    street_address: input.streetAddress || "Adresse non renseignée",
    city: input.city || "France",
    zip_code: input.zipCode || "00000",
    country_code: "FR",
  };
}

interface QontoClient {
  id: string;
  kind?: string;
  tax_identification_number?: string | null;
  billing_address?: unknown;
}

// Qonto refuse de facturer une entreprise sans tin_number (SIREN) : un
// client "company" hérité sans SIREN est infacturable (422).
function isInvoiceable(client: QontoClient) {
  return client.kind !== "company" || !!client.tax_identification_number;
}

// Qonto n'impose pas d'unicité sur les clients : on cherche par email avant
// d'en créer un — mais on ne réutilise que des clients facturables.
//
// Le client est créé en kind "individual" et non "company" : Qonto exige un
// tin_number (SIREN) pour facturer une entreprise, et le CRM ne connaît pas
// le SIREN des prospects (422 systématique sinon).
async function findOrCreateClient(input: QontoInvoiceInput): Promise<string | null> {
  if (input.email) {
    const byEmail = await qontoFetch(
      `/v2/clients?filter[email]=${encodeURIComponent(input.email)}`
    );
    const clients = byEmail?.clients as QontoClient[] | undefined;
    const found = clients?.find(isInvoiceable);
    if (found) {
      // Sans adresse de facturation, la création de facture échoue en 422
      if (!found.billing_address) {
        await qontoFetch(`/v2/clients/${found.id}`, {
          method: "PATCH",
          body: JSON.stringify({ billing_address: billingAddress(input) }),
        });
      }
      return found.id;
    }
  }

  const words = input.name.trim().split(/\s+/);
  const created = await qontoFetch("/v2/clients", {
    method: "POST",
    body: JSON.stringify({
      first_name: words[0],
      last_name: words.slice(1).join(" ") || words[0],
      name: input.name,
      kind: "individual",
      currency: "EUR",
      locale: "FR",
      ...(input.email ? { email: input.email } : {}),
      billing_address: billingAddress(input),
    }),
  });

  const client = created?.client as { id: string } | undefined;
  return client?.id ?? null;
}

export async function createQontoInvoice(
  input: QontoInvoiceInput
): Promise<QontoInvoice | null> {
  const iban = process.env.QONTO_IBAN;
  if (!iban) {
    console.error("Qonto non configuré (QONTO_IBAN manquant) — facture non générée");
    return null;
  }

  const clientId = await findOrCreateClient(input);
  if (!clientId) return null;

  const today = new Date().toISOString().slice(0, 10);
  const vatRate = process.env.QONTO_VAT_RATE || "0.2";
  // Le montant payé est TTC : on refacture le HT correspondant
  const unitPrice = (input.amount / (1 + Number(vatRate))).toFixed(2);

  const res = await qontoFetch("/v2/client_invoices", {
    method: "POST",
    body: JSON.stringify({
      client_id: clientId,
      issue_date: today,
      due_date: today, // déjà payé via GoCardless
      currency: "EUR",
      payment_methods: { iban },
      items: [
        {
          title: (input.title || "Création de site web").slice(0, 40),
          quantity: "1",
          unit_price: { value: unitPrice, currency: "EUR" },
          vat_rate: vatRate,
        },
      ],
    }),
  });

  const invoice = res?.client_invoice as
    | { id: string; number?: string; invoice_url?: string }
    | undefined;
  if (!invoice) return null;

  return {
    id: invoice.id,
    number: invoice.number,
    invoiceUrl: invoice.invoice_url,
  };
}

// Télécharge le PDF d'une facture. L'invoice_url public (pay.qonto.com) sert
// du HTML : le PDF passe par l'attachment de la facture (URL S3 signée).
// L'attachment est généré en asynchrone par Qonto → peut renvoyer null juste
// après la création de la facture.
export async function getQontoInvoicePdf(
  invoiceId: string
): Promise<QontoInvoicePdf | null> {
  const invRes = await qontoFetch(`/v2/client_invoices/${invoiceId}`);
  const invoice = invRes?.client_invoice as
    | { attachment_id?: string }
    | undefined;
  if (!invoice?.attachment_id) return null;

  const attRes = await qontoFetch(`/v2/attachments/${invoice.attachment_id}`);
  const attachment = attRes?.attachment as
    | { url?: string; file_name?: string }
    | undefined;
  if (!attachment?.url) return null;

  const res = await fetch(attachment.url);
  if (!res.ok) return null;

  return {
    filename: attachment.file_name || "facture-milleweb.pdf",
    content: Buffer.from(await res.arrayBuffer()),
  };
}
