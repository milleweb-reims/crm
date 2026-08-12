// Effets d'un changement de statut sur une fiche prospect : prise de la fiche,
// pose et levée du verrou, détection de conflit.
//
// Fonction pure, isolée de la route pour être testable sans base : c'est elle qui
// décide qui repart avec la fiche, et une erreur ici se paie en dossiers volés.

import { isReservationBinding } from "./lock";
import type { UserRole } from "@/types";

/** Ce que la décision a besoin de connaître de la fiche existante. */
export interface ClaimableProspect {
  readonly status: string;
  readonly lockedBy?: Readonly<{ _id: { toString(): string } }> | null;
  readonly assignedTo?: Readonly<{
    _id: { toString(): string };
    name?: string;
  }> | null;
}

export interface StatusChangeEffects {
  readonly updates: Record<string, unknown>;
  readonly activityToRecord?: {
    readonly content: string;
    readonly metadata: Record<string, unknown>;
  };
  readonly conflictError?: {
    readonly message: string;
    readonly assignedName: string;
  };
}

/**
 * Détermine qui repart avec la fiche lors d'un changement de statut.
 *
 * Un closer prend la fiche dès qu'il l'entame, même si la répartition du
 * territoire l'avait suggérée à un collègue : tant que le statut est
 * « Prospect », personne ne l'a appelée (voir isReservationBinding).
 *
 * Un admin, lui, ne dépossède personne — il ne récupère que les fiches libres.
 * Il peut travailler le dossier d'un closer sans le lui retirer au passage, ce
 * qui compte doublement pendant une substitution d'identité.
 */
function resolveClaimant(options: {
  readonly existing: ClaimableProspect;
  readonly userId: string;
  readonly userRole: UserRole;
}): string | null {
  const { existing, userId, userRole } = options;

  if (isReservationBinding(existing)) return null;
  if (userRole === "closer") return userId;
  if (userRole === "admin" && !existing.assignedTo) return userId;

  return null;
}

/**
 * Calcule les effets d'un changement de statut : prise de la fiche, verrou et
 * activité à journaliser — ou le conflit qui doit faire échouer la requête.
 *
 * @param options.updates Corps de la mise à jour, statut cible inclus
 * @param options.existing Fiche en base, `assignedTo` et `lockedBy` peuplés
 */
export function computeStatusChangeEffects(options: {
  readonly updates: Record<string, unknown>;
  readonly existing: ClaimableProspect;
  readonly userId: string;
  readonly userRole: UserRole;
}): StatusChangeEffects {
  const { updates, existing, userId, userRole } = options;

  const claimant = resolveClaimant({ existing, userId, userRole });
  let effectsUpdate = claimant
    ? { ...updates, assignedTo: claimant }
    : updates;

  const holdsLock =
    existing.lockedBy && existing.lockedBy._id.toString() === userId;
  const assignedToUser =
    existing.assignedTo && typeof existing.assignedTo === "object"
      ? existing.assignedTo
      : null;

  // Le conflit ne protège que les dossiers entamés. L'appliquer à une fiche
  // encore au statut « Prospect » condamnerait le closer à regarder le stock de
  // sa ville sans pouvoir l'appeler.
  if (
    !holdsLock &&
    isReservationBinding(existing) &&
    assignedToUser &&
    assignedToUser._id.toString() !== userId &&
    userRole !== "admin"
  ) {
    const assignedName = assignedToUser.name || "un autre utilisateur";
    return {
      updates: effectsUpdate,
      conflictError: {
        message: `Ce prospect est déjà pris par ${assignedName}`,
        assignedName,
      },
    };
  }

  if (updates.status === "en_appel") {
    effectsUpdate = {
      ...effectsUpdate,
      lockedBy: userId,
      lockedAt: new Date(),
    };
  }

  // « À rappeler » gare la fiche : l'appel est terminé, le verrou (posé sans
  // expiration par « en appel ») n'a plus de raison d'être.
  if (updates.status === "a_rappeler") {
    effectsUpdate = {
      ...effectsUpdate,
      lockedBy: null,
      lockedAt: null,
    };
  }

  return {
    updates: effectsUpdate,
    activityToRecord: {
      content: `Statut changé de "${existing.status}" à "${updates.status}"`,
      metadata: { from: existing.status, to: updates.status },
    },
  };
}
