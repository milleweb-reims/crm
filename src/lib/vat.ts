/**
 * Les montants de devis (quoteAmount) sont stockés en euros HT.
 * Le client paie le TTC via GoCardless ; la facture Qonto refacture le HT.
 * Configured via QONTO_VAT_RATE env var (défaut "0.2" ; "0" si franchise en base).
 */
export const VAT_RATE = Number(process.env.QONTO_VAT_RATE || "0.2");

/**
 * Convertit un montant HT en TTC en appliquant le taux de TVA configuré.
 */
export function ttcFromHt(ht: number): number {
  return Math.round(ht * (1 + VAT_RATE) * 100) / 100;
}
