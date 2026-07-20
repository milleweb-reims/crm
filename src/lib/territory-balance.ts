// Répartition d'un lot de prospects entre les closers d'un territoire.
// Le prospect va toujours au closer qui a le moins d'appels en attente.
// Fonction pure : elle n'interroge jamais la base, ce qui permet de répartir
// un lot entier à partir d'une seule mesure de charge.

export interface CloserLoad {
  readonly closerId: string;
  readonly load: number;
}

/**
 * Retourne `count` identifiants de closer, dans l'ordre d'attribution.
 * Égalité départagée par identifiant croissant : le résultat est déterministe.
 * Cas dégénérés (aucun closer, lot nul ou négatif) : tableau vide, sans erreur.
 */
export function distribute(options: {
  readonly loads: ReadonlyArray<CloserLoad>;
  readonly count: number;
}): string[] {
  const { loads, count } = options;

  if (loads.length === 0 || count <= 0) return [];

  // Copie de travail locale : `loads` n'est jamais modifié. La mutation reste
  // confinée à cette fonction, qui demeure pure vue de l'extérieur.
  const running = loads.map((entry) => ({ ...entry }));
  const picked: string[] = [];

  for (let i = 0; i < count; i += 1) {
    let best = running[0]!;

    for (const candidate of running) {
      const lighter = candidate.load < best.load;
      const tieBrokenById =
        candidate.load === best.load && candidate.closerId < best.closerId;

      if (lighter || tieBrokenById) best = candidate;
    }

    picked.push(best.closerId);
    best.load += 1;
  }

  return picked;
}
