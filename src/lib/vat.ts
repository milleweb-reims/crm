// Les montants de devis (quoteAmount) sont stockés en euros HT.
// Le client paie le TTC via GoCardless ; la facture Qonto refacture le HT.
// QONTO_VAT_RATE : taux de TVA (défaut "0.2" ; "0" si franchise en base).

export const VAT_RATE = Number(process.env.QONTO_VAT_RATE || "0.2");

export function ttcFromHt(ht: number): number {
  return Math.round(ht * (1 + VAT_RATE) * 100) / 100;
}
