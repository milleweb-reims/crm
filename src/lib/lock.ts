// Verrouillage des fiches prospect : un closer qui ouvre une fiche la verrouille
// pour éviter qu'un autre closer contacte le même prospect en même temps.
// Le verrou expire sans heartbeat (fermeture brutale du navigateur, crash...).

export const LOCK_TTL_MS = 3 * 60 * 1000; // 3 min sans heartbeat = verrou expiré
export const LOCK_HEARTBEAT_MS = 60 * 1000;

export function isLockActive(lockedAt: Date | string | null | undefined) {
  if (!lockedAt) return false;
  return Date.now() - new Date(lockedAt).getTime() < LOCK_TTL_MS;
}

/**
 * Verrou tenu par quelqu'un d'autre → renvoie qui le tient, sinon null.
 * Le statut "en_appel" verrouille sans expiration (le closer est au téléphone),
 * sinon le verrou n'est valide que s'il est encore rafraîchi (TTL).
 */
export function getLockHolder(
  prospect: {
    readonly status: string;
    readonly lockedBy: { readonly _id: string; readonly name: string } | string | null;
    readonly lockedAt: Date | string | null;
  },
  currentUserId?: string
) {
  const lock = prospect.lockedBy;
  if (!lock) return null;
  if (prospect.status !== "en_appel" && !isLockActive(prospect.lockedAt)) return null;
  if (typeof lock === "string") {
    return lock === currentUserId ? null : { _id: lock, name: "un autre utilisateur" };
  }
  return lock._id === currentUserId ? null : lock;
}

/**
 * Une attribution est-elle opposable ?
 *
 * Tant qu'une fiche est au statut « Prospect », elle n'a jamais été appelée :
 * l'attribution n'est qu'une suggestion de répartition du territoire, et tout
 * closer qui voit la fiche peut l'entamer — le serveur la lui attribue alors.
 *
 * Sans cette règle, la visibilité par territoire serait un piège : un closer
 * ajouté sur une ville verrait tout le stock de cette ville sans pouvoir toucher
 * une seule fiche, chacune répondant « déjà pris ».
 *
 * Dès que le dossier est entamé (en appel, à rappeler, RDV, lien envoyé, payé),
 * l'attribution devient exclusive : c'est le dossier de son closer, et personne
 * ne le lui prend.
 */
export function isReservationBinding(prospect: { readonly status: string }) {
  return prospect.status !== "prospect";
}

/**
 * Fiche attribuée à un autre closer → renvoie à qui, sinon null.
 *
 * Informatif, et non bloquant : l'attribution n'expire pas, mais elle n'est
 * opposable que si le dossier est entamé (voir isReservationBinding). Un
 * appelant qui veut savoir s'il peut prendre la fiche croise les deux.
 */
export function getReservationHolder(
  prospect: {
    readonly assignedTo: { readonly _id: string; readonly name: string } | string | null;
  },
  currentUserId?: string
) {
  const assignee = prospect.assignedTo;
  if (!assignee) return null;
  if (typeof assignee === "string") {
    return assignee === currentUserId
      ? null
      : { _id: assignee, name: "un autre utilisateur" };
  }
  return assignee._id === currentUserId ? null : assignee;
}

/**
 * Closer d'un dossier entamé par quelqu'un d'autre → renvoie qui, sinon null.
 *
 * Croise getReservationHolder et isReservationBinding pour l'affichage : une
 * simple suggestion de répartition n'est pas signalée, sinon un closer qui voit
 * le stock de sa ville croit que tout appartient déjà à un collègue.
 */
export function getBindingReservationHolder(
  prospect: Parameters<typeof getReservationHolder>[0] &
    Parameters<typeof isReservationBinding>[0],
  currentUserId?: string
) {
  if (!isReservationBinding(prospect)) return null;
  return getReservationHolder(prospect, currentUserId);
}
