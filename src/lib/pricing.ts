// Tarifs de création et d'abonnement : ils appartiennent au compte qui détient
// la fiche, jamais à la fiche elle-même.
//
// Module sans accès base, comme territory-balance.ts : la lecture du compte est
// injectée. C'est ce qui rend la résolution testable sans base — et `db.ts` lève
// à l'import quand MONGODB_URI est absent, ce qui est le cas sous vitest.
// L'implémentation branchée sur Mongoose vit dans pricing-service.ts.

/** Tarifs appliqués quand la fiche n'a pas de détenteur exploitable. */
export const DEFAULT_QUOTE_AMOUNT = 500;
export const DEFAULT_SUBSCRIPTION_AMOUNT = 29;

/** Montants en euros HT. Le client est prélevé du TTC (voir vat.ts). */
export interface ProspectPricing {
  readonly quoteAmount: number;
  readonly subscriptionAmount: number;
}

/** Ce que la résolution attend d'un compte. Non typé : la base peut tout rendre. */
export interface HolderPricing {
  readonly quoteAmount?: unknown;
  readonly subscriptionAmount?: unknown;
}

export type HolderFinder = (
  holderId: string
) => Promise<HolderPricing | null>;

export const DEFAULT_PRICING: ProspectPricing = {
  quoteAmount: DEFAULT_QUOTE_AMOUNT,
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

/**
 * Retient un tarif seulement s'il est un nombre fini strictement positif.
 *
 * L'API refuse déjà d'enregistrer autre chose, mais un document plus ancien ou
 * modifié à la main peut porter n'importe quoi. Un montant nul, négatif ou non
 * numérique qui atteindrait GoCardless produirait un prélèvement absurde : mieux
 * vaut le tarif par défaut.
 */
function amountOr(fallback: number, value: unknown): number {
  const usable =
    typeof value === "number" && Number.isFinite(value) && value > 0;
  return usable ? value : fallback;
}

/**
 * Tarifs applicables à une fiche : ceux de son détenteur.
 *
 * Les deux montants sont résolus séparément — un compte peut n'avoir qu'un seul
 * tarif configuré.
 *
 * @param assignedTo Le champ `assignedTo` de la fiche, sous n'importe quelle forme
 * @param findHolder Lecture du compte détenteur
 */
export async function resolveProspectPricing(
  assignedTo: unknown,
  findHolder: HolderFinder
): Promise<ProspectPricing> {
  const holderId = holderIdOf(assignedTo);
  if (!holderId) return DEFAULT_PRICING;

  const holder = await findHolder(holderId);
  if (!holder) return DEFAULT_PRICING;

  return {
    quoteAmount: amountOr(DEFAULT_QUOTE_AMOUNT, holder.quoteAmount),
    subscriptionAmount: amountOr(
      DEFAULT_SUBSCRIPTION_AMOUNT,
      holder.subscriptionAmount
    ),
  };
}

/** Champs de tarif acceptés à l'écriture sur un compte. */
export const PRICING_FIELDS = ["quoteAmount", "subscriptionAmount"] as const;

export const INVALID_AMOUNT_ERROR =
  "Montant invalide : nombre strictement positif attendu";

/**
 * Extrait les tarifs d'un corps de requête, en refusant tout net au moindre
 * montant inexploitable.
 *
 * Refuser plutôt que d'ignorer silencieusement : un admin qui saisit 0 doit être
 * corrigé, pas voir sa saisie disparaître sans rien dire. Les champs absents ne
 * sont pas touchés, ce qui permet de modifier un seul des deux tarifs.
 */
export function pickPricingUpdates(
  body: Readonly<Record<string, unknown>>
): { readonly updates: Record<string, number> } | { readonly error: string } {
  const updates: Record<string, number> = {};

  for (const field of PRICING_FIELDS) {
    const value = body[field];
    if (value === undefined) continue;

    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      return { error: INVALID_AMOUNT_ERROR };
    }

    updates[field] = value;
  }

  return { updates };
}
