// Prix de création et abonnement.
//
// Le prix du site se fixe PAR FICHE, par le closer qui la détient, avec un
// plancher de 1 000 € HT. Tout ce qui dépasse ce plancher est reversé au closer
// (closerCommission). L'abonnement mensuel reste un tarif du compte détenteur,
// réglé par l'admin.
//
// Module sans accès base, comme territory-balance.ts : la lecture du compte est
// injectée. C'est ce qui rend la résolution testable sans base — et `db.ts` lève
// à l'import quand MONGODB_URI est absent, ce qui est le cas sous vitest.
// L'implémentation branchée sur Mongoose vit dans pricing-service.ts.

/** Plancher du prix de création, en euros HT. Part de Milleweb sur chaque vente. */
export const MINIMUM_QUOTE_AMOUNT = 1000;

/** Abonnement appliqué quand la fiche n'a pas de détenteur exploitable. */
export const DEFAULT_SUBSCRIPTION_AMOUNT = 29;

/** Montants en euros HT. Le client est prélevé du TTC (voir vat.ts). */
export interface ProspectPricing {
  readonly quoteAmount: number;
  readonly subscriptionAmount: number;
}

/** Ce que la résolution attend d'une fiche. Non typé : la base peut tout rendre. */
export interface PricedProspect {
  readonly quoteAmount?: unknown;
  readonly assignedTo: unknown;
}

/** Ce que la résolution attend d'un compte. Non typé : la base peut tout rendre. */
export interface HolderPricing {
  readonly subscriptionAmount?: unknown;
}

export type HolderFinder = (
  holderId: string
) => Promise<HolderPricing | null>;

export const DEFAULT_PRICING: ProspectPricing = {
  quoteAmount: MINIMUM_QUOTE_AMOUNT,
  subscriptionAmount: DEFAULT_SUBSCRIPTION_AMOUNT,
};

/**
 * 24 caractères hexadécimaux, plutôt que `isValidObjectId` de Mongoose, qui est
 * volontairement laxiste : il accepte un nombre ou toute chaîne de 12
 * caractères. Ici une valeur qui n'est pas un identifiant doit être rejetée, pas
 * réinterprétée.
 */
const OBJECT_ID = /^[0-9a-f]{24}$/i;

/**
 * Identifiant du détenteur d'une fiche, quelle que soit la forme de `assignedTo` :
 * ObjectId brut, document peuplé par `populate`, chaîne, ou `null`.
 *
 * @returns L'identifiant, ou null si la fiche n'est attribuée à personne
 */
export function holderIdOf(assignedTo: unknown): string | null {
  if (!assignedTo) return null;

  const direct = String(assignedTo);
  if (OBJECT_ID.test(direct)) return direct;

  if (typeof assignedTo === "object" && "_id" in assignedTo) {
    return holderIdOf((assignedTo as { readonly _id: unknown })._id);
  }

  return null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export const INVALID_QUOTE_ERROR = "Prix invalide : 1 000 € HT minimum";

/**
 * Un prix de création n'est retenu que s'il atteint le plancher.
 *
 * Refuser plutôt qu'arrondir au plancher : un closer qui saisit 800 doit être
 * corrigé, pas voir sa saisie remplacée sans rien dire.
 */
export function validateQuoteAmount(
  value: unknown
): { readonly amount: number } | { readonly error: string } {
  if (!isFiniteNumber(value) || value < MINIMUM_QUOTE_AMOUNT) {
    return { error: INVALID_QUOTE_ERROR };
  }
  return { amount: value };
}

/**
 * Retient un abonnement seulement s'il est un nombre fini strictement positif.
 *
 * L'API refuse déjà d'enregistrer autre chose, mais un document plus ancien ou
 * modifié à la main peut porter n'importe quoi. Un montant nul, négatif ou non
 * numérique qui atteindrait GoCardless produirait un prélèvement absurde : mieux
 * vaut le tarif par défaut.
 */
function subscriptionOr(fallback: number, value: unknown): number {
  return isFiniteNumber(value) && value > 0 ? value : fallback;
}

/**
 * Prix applicables à une fiche : son propre prix de création, et l'abonnement
 * de son détenteur.
 *
 * Un prix de fiche absent ou sous le plancher (document d'avant la règle, encore
 * à 500) retombe sur le plancher : rien sous 1 000 € HT n'atteint GoCardless.
 *
 * @param prospect La fiche, avec `quoteAmount` et `assignedTo` sous n'importe quelle forme
 * @param findHolder Lecture du compte détenteur
 */
export async function resolveProspectPricing(
  prospect: PricedProspect,
  findHolder: HolderFinder
): Promise<ProspectPricing> {
  const quote = validateQuoteAmount(prospect.quoteAmount);
  const quoteAmount = "amount" in quote ? quote.amount : MINIMUM_QUOTE_AMOUNT;

  const holderId = holderIdOf(prospect.assignedTo);
  const holder = holderId ? await findHolder(holderId) : null;

  return {
    quoteAmount,
    subscriptionAmount: subscriptionOr(
      DEFAULT_SUBSCRIPTION_AMOUNT,
      holder?.subscriptionAmount
    ),
  };
}

/**
 * Part du closer sur une vente : tout ce qui dépasse le plancher, au centime.
 *
 * Jamais négative — une vente d'avant la règle, à 500 € HT, ne crée pas de dette.
 *
 * @param paidAmountHt Montant HT réellement encaissé
 */
export function closerCommission(paidAmountHt: number): number {
  const above = Math.round((paidAmountHt - MINIMUM_QUOTE_AMOUNT) * 100) / 100;
  return Math.max(0, above);
}

interface QuoteAmountUpdateInput {
  readonly body: Readonly<Record<string, unknown>>;
  readonly existing: { readonly status: string; readonly assignedTo: unknown };
  readonly user: { readonly id: string; readonly role: string };
}

type QuoteAmountUpdateResult =
  | { readonly updates: Record<string, unknown> }
  | { readonly error: string; readonly status: 400 | 403 };

/**
 * Décide si `quoteAmount` peut s'écrire sur une fiche, et par qui.
 *
 * Le détenteur fixe son prix, l'admin celui de n'importe quelle fiche. Une fiche
 * libre accepte le prix d'un closer : le statut « en appel » la lui attribuera.
 * Une fiche payée est figée — la rémunération a déjà été calculée dessus.
 *
 * @returns Le corps sans le prix si absent, avec le prix validé sinon, ou une erreur
 */
export function quoteAmountUpdate(
  input: QuoteAmountUpdateInput
): QuoteAmountUpdateResult {
  const { body, existing, user } = input;
  if (!("quoteAmount" in body)) return { updates: { ...body } };

  if (existing.status === "paye") {
    return {
      error: "Fiche payée : le prix ne peut plus être modifié",
      status: 403,
    };
  }

  const holderId = holderIdOf(existing.assignedTo);
  if (user.role !== "admin" && holderId !== null && holderId !== user.id) {
    return {
      error: "Seul le closer qui détient la fiche fixe son prix",
      status: 403,
    };
  }

  const quote = validateQuoteAmount(body.quoteAmount);
  if ("error" in quote) return { error: quote.error, status: 400 };

  return { updates: { ...body, quoteAmount: quote.amount } };
}

/** Champs de tarif acceptés à l'écriture sur un compte. */
export const PRICING_FIELDS = ["subscriptionAmount"] as const;

export const INVALID_AMOUNT_ERROR =
  "Montant invalide : nombre strictement positif attendu";

/**
 * Extrait les tarifs d'un corps de requête, en refusant tout net au moindre
 * montant inexploitable.
 *
 * Refuser plutôt que d'ignorer silencieusement : un admin qui saisit 0 doit être
 * corrigé, pas voir sa saisie disparaître sans rien dire. Les champs absents ne
 * sont pas touchés.
 */
export function pickPricingUpdates(
  body: Readonly<Record<string, unknown>>
): { readonly updates: Record<string, number> } | { readonly error: string } {
  const updates: Record<string, number> = {};

  for (const field of PRICING_FIELDS) {
    const value = body[field];
    if (value === undefined) continue;

    if (!isFiniteNumber(value) || value <= 0) {
      return { error: INVALID_AMOUNT_ERROR };
    }

    updates[field] = value;
  }

  return { updates };
}
