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
 * Fiche attribuée à un autre closer → renvoie à qui, sinon null.
 * Contrairement au verrou, l'attribution n'expire pas : seul le closer
 * attribué (ou un admin) peut prendre la fiche.
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
