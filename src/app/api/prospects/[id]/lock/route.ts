import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { Prospect } from "@/lib/models/prospect.model";
import { getAuthSession, unauthorized } from "@/lib/api-auth";
import { emitCrmEvent } from "@/lib/events";
import { LOCK_TTL_MS, isLockActive } from "@/lib/lock";

interface LockedProspect {
  readonly lockedBy: { readonly _id: { toString(): string }; readonly name: string } | null;
  readonly lockedAt: Date | null;
}

/**
 * Construit une réponse 423 Locked avec les détails du verrou.
 */
function lockedResponse(prospect: LockedProspect) {
  const holder = prospect.lockedBy;
  return NextResponse.json(
    {
      error: `Fiche en cours de traitement par ${holder?.name || "un autre utilisateur"}`,
      lockedBy: holder ? { _id: holder._id.toString(), name: holder.name } : null,
      lockedAt: prospect.lockedAt,
    },
    { status: 423 }
  );
}

/**
 * Parse le body JSON de la requête, retourne force=true si { force: true } est passé.
 */
async function parseOptionalLockBody(
  req: NextRequest
): Promise<boolean> {
  try {
    const body = await req.json();
    return body?.force === true;
  } catch {
    return false;
  }
}

/**
 * Vérifie si le prospect est attribué à un autre utilisateur (et non admin).
 */
function isReservedByOther(
  prospect: Readonly<{ assignedTo: Readonly<{ _id: { toString(): string }; name: string }> | null }>,
  currentUserId: string,
  isAdmin: boolean
): boolean {
  return (
    !!prospect.assignedTo &&
    prospect.assignedTo._id.toString() !== currentUserId &&
    !isAdmin
  );
}

/**
 * Construit la réponse de réservation (prospect attribué).
 */
function reservationResponse(prospect: Readonly<{
  assignedTo: Readonly<{ _id: { toString(): string }; name: string }>;
}>) {
  return NextResponse.json(
    {
      error: `Prospect réservé à ${prospect.assignedTo.name || "un autre utilisateur"}`,
      reserved: true,
      assignedTo: {
        _id: prospect.assignedTo._id.toString(),
        name: prospect.assignedTo.name,
      },
    },
    { status: 423 }
  );
}

/**
 * Construit le filtre de mise à jour atomique pour le verrou.
 */
function buildLockFilter(
  prospectId: string,
  currentUserId: string,
  force: boolean
): Readonly<Record<string, unknown>> {
  if (force) return { _id: prospectId };

  const expiredBefore = new Date(Date.now() - LOCK_TTL_MS);
  return {
    _id: prospectId,
    $or: [
      { lockedBy: null },
      { lockedBy: currentUserId },
      {
        lockedAt: { $lt: expiredBefore },
        status: { $ne: "en_appel" },
      },
    ],
  };
}

/**
 * Détermine si le verrou actuel a changé de main (nouvelle acquisition).
 */
function isNewLockAcquisition(
  existing: Readonly<{
    lockedBy: Readonly<{ _id: { toString(): string } }> | null;
    status: string;
    lockedAt: Date | string | null;
  }>,
  currentUserId: string
): boolean {
  if (!existing.lockedBy) return true;
  if (existing.lockedBy._id.toString() !== currentUserId) return true;
  return !isLockActive(existing.lockedAt);
}

/**
 * Acquérir / rafraîchir le verrou (heartbeat). body { force: true } (admin) pour reprendre un verrou.
 * 423 Locked si la fiche est déjà tenue par un autre utilisateur.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  const { id } = await params;
  const force = await parseOptionalLockBody(req);

  if (force && session.user.role !== "admin") {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  await connectDB();

  const existing = await Prospect.findById(id)
    .select("lockedBy lockedAt status assignedTo")
    .populate("lockedBy", "name")
    .populate("assignedTo", "name");
  if (!existing) {
    return NextResponse.json({ error: "Prospect introuvable" }, { status: 404 });
  }

  if (isReservedByOther(existing, session.user.id, session.user.role === "admin")) {
    return reservationResponse(existing);
  }

  const lockStillValid =
    isLockActive(existing.lockedAt) || existing.status === "en_appel";
  const heldByOther =
    existing.lockedBy &&
    existing.lockedBy._id.toString() !== session.user.id &&
    lockStillValid;

  if (heldByOther && !force) return lockedResponse(existing);

  const filter = buildLockFilter(id, session.user.id, force);

  const updated = await Prospect.findOneAndUpdate(
    filter,
    { lockedBy: session.user.id, lockedAt: new Date() },
    { returnDocument: "after" }
  );

  if (!updated) {
    const current = await Prospect.findById(id)
      .select("lockedBy lockedAt")
      .populate("lockedBy", "name");
    if (current) return lockedResponse(current);
    return NextResponse.json({ error: "Prospect introuvable" }, { status: 404 });
  }

  if (isNewLockAcquisition(existing, session.user.id)) {
    emitCrmEvent({
      type: "prospect:updated",
      prospectId: id,
      userId: session.user.id,
      timestamp: Date.now(),
    });
  }

  return NextResponse.json({ locked: true, lockedAt: updated.lockedAt });
}

/**
 * Libérer son propre verrou (à la fermeture de la fiche).
 * On ne libère que son propre verrou (un admin reprend une fiche via POST { force: true }).
 * Une fiche "en_appel" reste verrouillée même si le closer quitte la page.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  await connectDB();

  const { id } = await params;

  const result = await Prospect.updateOne(
    { _id: id, lockedBy: session.user.id, status: { $ne: "en_appel" } },
    { lockedBy: null, lockedAt: null }
  );

  if (result.modifiedCount > 0) {
    emitCrmEvent({
      type: "prospect:updated",
      prospectId: id,
      userId: session.user.id,
      timestamp: Date.now(),
    });
  }

  return NextResponse.json({ success: true });
}
