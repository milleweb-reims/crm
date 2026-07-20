import { NextRequest, NextResponse } from "next/server";

import { forbidden, getAuthSession, unauthorized } from "@/lib/api-auth";
import { connectDB } from "@/lib/db";
import { Territory } from "@/lib/models/territory.model";
import { releaseTerritory } from "@/lib/territory-service";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getAuthSession();
  if (!session) return unauthorized();
  if (session.user.role !== "admin") return forbidden();

  await connectDB();

  const { id } = await params;

  const territory = await Territory.findById(id).lean();
  if (!territory) {
    return NextResponse.json({ error: "Territoire introuvable" }, { status: 404 });
  }

  const { released } = await releaseTerritory(id, session.user.id);

  return NextResponse.json({ released });
}
