/**
 * Y a-t-il au moins une vente dans le classement ?
 *
 * Un classement où personne n'a vendu ne classe rien : le dashboard ne
 * l'affiche pas, plutôt que d'ordonner les closers sur leurs seuls RDV.
 */
export function hasSales(entries: ReadonlyArray<{ readonly sales: number }>) {
  return entries.some((entry) => entry.sales > 0);
}
