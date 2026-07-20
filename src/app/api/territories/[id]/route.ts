import { NextRequest, NextResponse } from "next/server";

import { forbidden, getAuthSession, unauthorized } from "@/lib/api-auth";
import { connectDB } from "@/lib/db";
import { Territory } from "@/lib/models/territory.model";
import { applyTerritory, validateClosers } from "@/lib/territory-service";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getAuthSession();
  if (!session) return unauthorized();
  if (session.user.role !== "admin") return forbidden();

  await connectDB();

  const { id } = await params;
  const body = await req.json();

  const closers = await validateClosers(body.closers ?? []);
  if (closers === null) {
    return NextResponse.json(
      { error: "Closer inexistant, inactif ou de rôle incorrect" },
      { status: 400 }
    );
  }

  // Retirer un closer ne retire aucune attribution existante : ses prospects
  // restent les siens, seule la répartition future change.
  const territory = await Territory.findByIdAndUpdate(
    id,
    { closers },
    { new: true }
  ).populate("closers", "name email");

  if (!territory) {
    return NextResponse.json({ error: "Territoire introuvable" }, { status: 404 });
  }

  const { assigned, perCloser } = await applyTerritory(id, session.user.id);

  return NextResponse.json({ territory, assigned, perCloser });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getAuthSession();
  if (!session) return unauthorized();
  if (session.user.role !== "admin") return forbidden();

  await connectDB();

  const { id } = await params;
  const deleted = await Territory.findByIdAndDelete(id);

  if (!deleted) {
    return NextResponse.json({ error: "Territoire introuvable" }, { status: 404 });
  }

  // La règle disparaît, les attributions déjà faites sont conservées.
  return NextResponse.json({ success: true });
}
