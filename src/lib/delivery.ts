import type { DeliveryStage, IProspect } from "@/types";

/**
 * Étape de livraison du site d'une fiche. Compat : les fiches créées avant
 * l'ajout de `deliveryStage` n'ont pas le champ — on retombe sur l'ancienne
 * déduction (devUrl / deliveredDate).
 */
export function getDeliveryStage(prospect: IProspect): DeliveryStage {
  if (prospect.deliveryStage) return prospect.deliveryStage;
  if (prospect.deliveredDate) return "termine";
  if (prospect.devUrl) return "en_cours";
  return "a_faire";
}
