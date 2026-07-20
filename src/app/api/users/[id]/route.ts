import { NextRequest, NextResponse } from "next/server";
import { hash } from "bcryptjs";
import { isValidObjectId } from "mongoose";
import { connectDB } from "@/lib/db";
import { User } from "@/lib/models/user.model";
import { Prospect } from "@/lib/models/prospect.model";
import { Activity } from "@/lib/models/activity.model";
import { Reminder } from "@/lib/models/reminder.model";
import { Territory } from "@/lib/models/territory.model";
import { getAuthSession, unauthorized, forbidden } from "@/lib/api-auth";
import { emitCrmEvent } from "@/lib/events";
import type { UserRole } from "@/types";

// Champs modifiables via PUT. Tout le reste du corps de requête est ignoré :
// on n'écrit jamais directement `passwordHash`, `_id` ou un champ hors schéma.
const ADMIN_EDITABLE = ["name", "email", "role", "isActive"] as const;
const SELF_EDITABLE = ["name", "email"] as const;

/**
 * Ne retient du corps de requête que les champs autorisés pour ce rôle.
 * @param body - Corps JSON reçu
 * @param isAdmin - L'appelant est-il administrateur
 * @returns Objet de mise à jour sûr à passer à Mongoose
 */
function pickUpdatableFields(
  body: Record<string, unknown>,
  isAdmin: boolean
): Record<string, unknown> {
  const allowed: readonly string[] = isAdmin ? ADMIN_EDITABLE : SELF_EDITABLE;
  return Object.fromEntries(
    allowed
      .filter((key) => body[key] !== undefined)
      .map((key) => [
        key,
        key === "email" && typeof body[key] === "string"
          ? (body[key] as string).toLowerCase()
          : body[key],
      ])
  );
}

/**
 * Y a-t-il encore un administrateur actif si celui-ci perd ses droits ?
 * Sans administrateur capable de se connecter, plus personne ne peut gérer les
 * comptes — et personne ne peut se redonner le rôle.
 */
async function isLastActiveAdmin(userId: string): Promise<boolean> {
  const remaining = await User.countDocuments({
    _id: { $ne: userId },
    role: "admin",
    isActive: true,
  });
  return remaining === 0;
}

/**
 * Vérifie qu'une mise à jour ne retire pas le dernier administrateur actif
 * (désactivation ou rétrogradation, y compris sur son propre compte).
 */
async function blockIfLastAdminLosesAccess(options: {
  readonly userId: string;
  readonly nextRole?: UserRole;
  readonly nextIsActive?: boolean;
}): Promise<NextResponse | null> {
  const { userId, nextRole, nextIsActive } = options;
  const losesAccess = nextIsActive === false || (!!nextRole && nextRole !== "admin");
  if (!losesAccess) return null;

  const current = (await User.findById(userId)
    .select("role isActive")
    .lean()) as { role: UserRole; isActive: boolean } | null;

  if (!current || current.role !== "admin" || !current.isActive) return null;
  if (!(await isLastActiveAdmin(userId))) return null;

  return NextResponse.json(
    { error: "Impossible de retirer le dernier administrateur actif" },
    { status: 409 }
  );
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  await connectDB();

  const { id } = await params;

  if (!isValidObjectId(id)) {
    return NextResponse.json(
      { error: "Utilisateur introuvable" },
      { status: 404 }
    );
  }

  const body = (await req.json()) as Record<string, unknown>;

  // Non-admins can only update their own profile
  if (session.user.role !== "admin" && id !== session.user.id) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  const isAdmin = session.user.role === "admin";
  const updates = pickUpdatableFields(body, isAdmin);

  const lastAdminError = await blockIfLastAdminLosesAccess({
    userId: id,
    nextRole: updates.role as UserRole | undefined,
    nextIsActive: updates.isActive as boolean | undefined,
  });
  if (lastAdminError) return lastAdminError;

  // Le mot de passe n'est jamais stocké tel quel, et `passwordHash` n'est
  // jamais accepté depuis la requête.
  if (typeof body.password === "string" && body.password) {
    updates.passwordHash = await hash(body.password, 12);
  }

  const user = await User.findByIdAndUpdate(id, updates, {
    new: true,
    select: "-passwordHash",
  }).lean();

  if (!user) {
    return NextResponse.json(
      { error: "Utilisateur introuvable" },
      { status: 404 }
    );
  }

  return NextResponse.json(user);
}

interface DeletionSummary {
  readonly locksReleased: number;
  readonly prospectsReassigned: number;
  readonly prospectsUnassigned: number;
  readonly remindersTransferred: number;
  readonly remindersDeleted: number;
  readonly activitiesAnonymised: number;
  readonly territoriesUpdated: number;
}

interface ReassignTarget {
  readonly targetId: string | null;
  readonly error: NextResponse | null;
}

/**
 * Valide l'utilisateur vers qui transférer les prospects du compte supprimé.
 * @param options - Id demandé (query `reassignTo`) et id du compte supprimé
 * @returns Cible validée, ou `targetId: null` si aucun transfert n'est demandé
 */
async function resolveReassignTarget(options: {
  readonly requestedId: string | null;
  readonly deletedUserId: string;
}): Promise<ReassignTarget> {
  const { requestedId, deletedUserId } = options;
  if (!requestedId) return { targetId: null, error: null };

  if (requestedId === deletedUserId || !isValidObjectId(requestedId)) {
    return {
      targetId: null,
      error: NextResponse.json(
        { error: "Destinataire du transfert invalide" },
        { status: 400 }
      ),
    };
  }

  const target = (await User.findById(requestedId)
    .select("isActive")
    .lean()) as { isActive: boolean } | null;

  if (!target?.isActive) {
    return {
      targetId: null,
      error: NextResponse.json(
        { error: "Destinataire du transfert introuvable ou inactif" },
        { status: 400 }
      ),
    };
  }

  return { targetId: requestedId, error: null };
}

/**
 * Transfère les rappels au destinataire, ou les supprime si le compte disparaît
 * sans repreneur (le champ `userId` d'un rappel est obligatoire, on ne peut pas
 * le vider).
 */
async function handleReminders(options: {
  readonly userId: string;
  readonly reassignTo: string | null;
}) {
  if (options.reassignTo) {
    const { modifiedCount } = await Reminder.updateMany(
      { userId: options.userId },
      { userId: options.reassignTo }
    );
    return { remindersTransferred: modifiedCount, remindersDeleted: 0 };
  }

  const { deletedCount } = await Reminder.deleteMany({ userId: options.userId });
  return { remindersTransferred: 0, remindersDeleted: deletedCount };
}

/**
 * Détache toutes les références au compte avant sa suppression.
 *
 * L'ordre est volontaire : les références sont nettoyées AVANT la suppression du
 * compte, pour qu'un échec en cours de route laisse un état réparable (compte
 * encore présent) plutôt que des références orphelines. MongoDB tourne ici en
 * standalone : les transactions multi-documents ne sont pas disponibles.
 */
async function detachUserReferences(options: {
  readonly userId: string;
  readonly reassignTo: string | null;
}): Promise<DeletionSummary> {
  const { userId, reassignTo } = options;

  // Un verrou ne se transfère jamais : la fiche redevient simplement libre.
  // Sans ça, une fiche « en appel » verrouillée par le compte supprimé resterait
  // bloquée indéfiniment (ce statut n'a pas de TTL de verrou).
  const locks = await Prospect.updateMany(
    { lockedBy: userId },
    { lockedBy: null, lockedAt: null }
  );

  const prospects = await Prospect.updateMany(
    { assignedTo: userId },
    { assignedTo: reassignTo }
  );

  const reminders = await handleReminders({ userId, reassignTo });

  // `userId` est nullable sur Activity : l'historique est conservé et s'affiche
  // ensuite comme « Système ».
  const activities = await Activity.updateMany({ userId }, { userId: null });

  // Sans ça, la répartition d'un territoire ciblerait un compte supprimé.
  // activeCloserIds filtrerait l'identifiant, mais la donnée resterait fausse
  // et l'interface afficherait un closer fantôme.
  const territories = await Territory.updateMany(
    { closers: userId },
    { $pull: { closers: userId } }
  );

  return {
    locksReleased: locks.modifiedCount,
    prospectsReassigned: reassignTo ? prospects.modifiedCount : 0,
    prospectsUnassigned: reassignTo ? 0 : prospects.modifiedCount,
    activitiesAnonymised: activities.modifiedCount,
    territoriesUpdated: territories.modifiedCount,
    ...reminders,
  };
}

/**
 * Supprime définitivement un compte et détache ses références.
 * Query optionnelle `?reassignTo=<userId>` pour transférer prospects et rappels
 * à un autre utilisateur actif ; sans elle les prospects redeviennent
 * non attribués et les rappels sont supprimés.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getAuthSession();
  if (!session) return unauthorized();
  if (session.user.role !== "admin") return forbidden();

  await connectDB();

  const { id } = await params;

  if (!isValidObjectId(id)) {
    return NextResponse.json(
      { error: "Utilisateur introuvable" },
      { status: 404 }
    );
  }

  if (id === session.user.id) {
    return NextResponse.json(
      { error: "Vous ne pouvez pas supprimer votre propre compte" },
      { status: 400 }
    );
  }

  const target = (await User.findById(id)
    .select("name role isActive")
    .lean()) as { name: string; role: UserRole; isActive: boolean } | null;

  if (!target) {
    return NextResponse.json(
      { error: "Utilisateur introuvable" },
      { status: 404 }
    );
  }

  // Ne jamais laisser le CRM sans administrateur capable de se connecter.
  // (Difficilement atteignable — l'admin qui agit compte lui-même comme
  // administrateur restant — mais protège des suppressions concurrentes.)
  if (target.role === "admin" && target.isActive && (await isLastActiveAdmin(id))) {
    return NextResponse.json(
      { error: "Impossible de supprimer le dernier administrateur actif" },
      { status: 409 }
    );
  }

  const reassign = await resolveReassignTarget({
    requestedId: req.nextUrl.searchParams.get("reassignTo"),
    deletedUserId: id,
  });
  if (reassign.error) return reassign.error;

  const summary = await detachUserReferences({
    userId: id,
    reassignTo: reassign.targetId,
  });

  await User.findByIdAndDelete(id);

  // Des fiches ont changé d'attribution ou de verrou : on rafraîchit les autres
  // sessions ouvertes.
  emitCrmEvent({
    type: "prospect:updated",
    userId: session.user.id,
    timestamp: Date.now(),
  });

  return NextResponse.json({
    deleted: { _id: id, name: target.name },
    ...summary,
  });
}
