// Accès base pour les tarifs. La décision elle-même vit dans pricing.ts, sans
// dépendance à Mongoose, pour rester testable.

import { connectDB } from "./db";
import { User } from "./models/user.model";
import {
  DEFAULT_PRICING,
  resolveProspectPricing,
  type HolderPricing,
  type ProspectPricing,
} from "./pricing";

async function findHolderPricing(
  holderId: string
): Promise<HolderPricing | null> {
  await connectDB();

  return (await User.findById(holderId)
    .select("quoteAmount subscriptionAmount")
    .lean()) as HolderPricing | null;
}

/**
 * Tarifs applicables à une fiche, lus sur le compte qui la détient.
 *
 * @param assignedTo Le champ `assignedTo` de la fiche (ObjectId, document peuplé ou null)
 */
export async function prospectPricing(
  assignedTo: unknown
): Promise<ProspectPricing> {
  try {
    return await resolveProspectPricing(assignedTo, findHolderPricing);
  } catch (error) {
    // Base injoignable : un lien de paiement ne doit pas échouer parce qu'un
    // tarif est illisible. Les défauts valent mieux qu'une erreur 500.
    console.error("Tarifs illisibles, repli sur les défauts", { error });
    return DEFAULT_PRICING;
  }
}
