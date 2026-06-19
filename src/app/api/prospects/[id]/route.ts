import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { Prospect } from "@/lib/models/prospect.model";
import { Activity } from "@/lib/models/activity.model";
import { getAuthSession, unauthorized } from "@/lib/api-auth";
import { emitCrmEvent } from "@/lib/events";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  await connectDB();

  const { id } = await params;
  const prospect = await Prospect.findById(id)
    .populate("assignedTo", "name email role")
    .lean();

  if (!prospect) {
    return NextResponse.json(
      { error: "Prospect introuvable" },
      { status: 404 }
    );
  }

  return NextResponse.json(prospect);
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  await connectDB();

  const { id } = await params;
  const body = await req.json();

  const existing = await Prospect.findById(id).populate("assignedTo", "name email role");
  if (!existing) {
    return NextResponse.json(
      { error: "Prospect introuvable" },
      { status: 404 }
    );
  }

  // Auto-assign on status change (closer takes a prospect)
  if (body.status && body.status !== existing.status) {
    const isCloserOrAdmin = session.user.role === "closer" || session.user.role === "admin";

    // If prospect is being moved out of "prospect" status, auto-assign
    if (existing.status === "prospect" && isCloserOrAdmin && !existing.assignedTo) {
      body.assignedTo = session.user.id;
    }

    // Conflict check: if already assigned to another user, reject
    if (
      existing.assignedTo &&
      existing.assignedTo._id.toString() !== session.user.id &&
      session.user.role !== "admin"
    ) {
      const assignedName = existing.assignedTo.name || "un autre utilisateur";
      return NextResponse.json(
        {
          error: `Ce prospect est déjà pris par ${assignedName}`,
          assignedTo: existing.assignedTo,
        },
        { status: 409 }
      );
    }

    await Activity.create({
      prospectId: id,
      userId: session.user.id,
      type: "status_change",
      content: `Statut changé de "${existing.status}" à "${body.status}"`,
      metadata: { from: existing.status, to: body.status },
    });
  }

  const prospect = await Prospect.findByIdAndUpdate(id, body, {
    new: true,
    runValidators: true,
  })
    .populate("assignedTo", "name email role")
    .lean();

  emitCrmEvent({ type: "prospect:updated", prospectId: id, userId: session.user.id, timestamp: Date.now() });

  return NextResponse.json(prospect);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  await connectDB();

  const { id } = await params;
  const prospect = await Prospect.findByIdAndDelete(id);

  if (!prospect) {
    return NextResponse.json(
      { error: "Prospect introuvable" },
      { status: 404 }
    );
  }

  // Clean up related data
  await Activity.deleteMany({ prospectId: id });

  emitCrmEvent({ type: "prospect:deleted", prospectId: id, userId: session.user.id, timestamp: Date.now() });

  return NextResponse.json({ success: true });
}
