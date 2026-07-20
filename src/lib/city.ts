// Rattachement d'un prospect à un territoire. Les données viennent d'un scrap
// Google Maps : « Reims », « REIMS », « Épernay » et « Epernay » désignent la
// même ville et doivent tomber sur la même clé.

/**
 * Normalise un nom de ville en clé de rattachement.
 * Minuscules, sans accents, espaces internes réduits à un seul.
 */
export function normalizeCity(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Retourne un nouveau prospect avec address.cityKey dérivé de address.city.
 * Sans adresse ou sans ville exploitable, le prospect est retourné tel quel :
 * il ne sera rattaché à aucun territoire.
 */
export function withCityKey(
  prospect: Record<string, unknown>
): Record<string, unknown> {
  const address = prospect.address;
  if (!address || typeof address !== "object") return prospect;

  const { city } = address as Record<string, unknown>;
  if (typeof city !== "string" || city.trim() === "") return prospect;

  return {
    ...prospect,
    address: {
      ...(address as Record<string, unknown>),
      cityKey: normalizeCity(city),
    },
  };
}
