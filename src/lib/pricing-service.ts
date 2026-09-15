// Accès base pour les prix. La décision elle-même vit dans pricing.ts, sans
// dépendance à Mongoose, pour rester testable.

import { connectDB } from "./db";
import { User } from "./models/user.model";
import {
  DEFAULT_PRICING,
  resolveProspectPricing,
  type HolderPricing,
  type PricedProspect,
  type ProspectPricing,
} from "./pricing";

async function findHolderPricing(
  holderId: string
): Promise<HolderPricing | null> {
  await connectDB();

  return (await User.findById(holderId)
    .select("subscriptionAmount")
    .lean()) as HolderPricing | null;
}

/**
 * Prix applicables à une fiche : son prix de création, et l'abonnement lu sur le
 * compte qui la détient.
 *
 * @param prospect La fiche, avec `quoteAmount` et `assignedTo` (ObjectId, document peuplé ou null)
 */
export async function prospectPricing(
  prospect: PricedProspect
): Promise<ProspectPricing> {
  try {
    return await resolveProspectPricing(prospect, findHolderPricing);
  } catch (error) {
    // Base injoignable : un lien de paiement ne doit pas échouer parce qu'un
    // tarif est illisible. Les défauts valent mieux qu'une erreur 500.
    console.error("Tarifs illisibles, repli sur les défauts", { error });
    return DEFAULT_PRICING;
  }
}
