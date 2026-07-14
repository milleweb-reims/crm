import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { Prospect } from "@/lib/models/prospect.model";
import { getAuthSession, unauthorized } from "@/lib/api-auth";
import { emitCrmEvent } from "@/lib/events";
import { LOCK_TTL_MS, isLockActive } from "@/lib/lock";

// POST = acquérir / rafraîchir le verrou (heartbeat). body { force: true } (admin) pour reprendre un verrou.
// DELETE = libérer son propre verrou (à la fermeture de la fiche).
// 423 Locked si la fiche est déjà tenue par un autre utilisateur.

interface LockedProspect {
  lockedBy: { _id: { toString(): string }; name: string } | null;
  lockedAt: Date | null;
}

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

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  const { id } = await params;

  let force = false;
  try {
    const body = await req.json();
    force = body?.force === true;
  } catch {
    // pas de body = acquisition/heartbeat simple
  }

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

  // Prospect attribué à un closer : lui seul (ou un admin) peut le prendre
  if (
    existing.assignedTo &&
    existing.assignedTo._id.toString() !== session.user.id &&
    session.user.role !== "admin"
  ) {
    return NextResponse.json(
      {
        error: `Prospect réservé à ${existing.assignedTo.name || "un autre utilisateur"}`,
        reserved: true,
        assignedTo: {
          _id: existing.assignedTo._id.toString(),
          name: existing.assignedTo.name,
        },
      },
      { status: 423 }
    );
  }

  // Le statut "en_appel" verrouille sans expiration (closer au téléphone)
  const lockStillValid =
    isLockActive(existing.lockedAt) || existing.status === "en_appel";
  const heldByOther =
    existing.lockedBy &&
    existing.lockedBy._id.toString() !== session.user.id &&
    lockStillValid;

  if (heldByOther && !force) return lockedResponse(existing);

  // Mise à jour atomique : évite que deux closers acquièrent le verrou en même temps
  const expiredBefore = new Date(Date.now() - LOCK_TTL_MS);
  const filter = force
    ? { _id: id }
    : {
        _id: id,
        $or: [
          { lockedBy: null },
          { lockedBy: session.user.id },
          {
            lockedAt: { $lt: expiredBefore },
            status: { $ne: "en_appel" },
          },
        ],
      };

  const updated = await Prospect.findOneAndUpdate(
    filter,
    { lockedBy: session.user.id, lockedAt: new Date() },
    { returnDocument: "after" }
  );

  if (!updated) {
    // Course perdue : quelqu'un d'autre vient de verrouiller
    const current = await Prospect.findById(id)
      .select("lockedBy lockedAt")
      .populate("lockedBy", "name");
    if (current) return lockedResponse(current);
    return NextResponse.json({ error: "Prospect introuvable" }, { status: 404 });
  }

  // N'émettre que sur une vraie acquisition (pas à chaque heartbeat)
  const isNewAcquisition =
    !existing.lockedBy ||
    existing.lockedBy._id.toString() !== session.user.id ||
    !lockStillValid;

  if (isNewAcquisition) {
    emitCrmEvent({
      type: "prospect:updated",
      prospectId: id,
      userId: session.user.id,
      timestamp: Date.now(),
    });
  }

  return NextResponse.json({ locked: true, lockedAt: updated.lockedAt });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  await connectDB();

  const { id } = await params;

  // On ne libère que son propre verrou (un admin reprend une fiche via POST { force: true }).
  // Une fiche "en_appel" reste verrouillée même si le closer quitte la page.
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
