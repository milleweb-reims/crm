import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { Prospect } from "@/lib/models/prospect.model";
import { Activity } from "@/lib/models/activity.model";
import { Reminder } from "@/lib/models/reminder.model";
import { getAuthSession, unauthorized } from "@/lib/api-auth";
import { emitCrmEvent } from "@/lib/events";
import { withCityKey } from "@/lib/city";
import { buildProspectFilter } from "@/lib/prospect-scope";
import {
  closerCityKeys,
  resolveAssignmentsByCity,
} from "@/lib/territory-service";

export async function GET(req: NextRequest) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  await connectDB();

  const { searchParams } = req.nextUrl;
  const page = parseInt(searchParams.get("page") || "1");
  const limit = parseInt(searchParams.get("limit") || "20");

  // Un closer voit les prospects des villes de ses territoires. Seul ce rôle a
  // une portée territoriale : inutile d'interroger la base pour les autres.
  const territoryCityKeys =
    session.user.role === "closer"
      ? await closerCityKeys(session.user.id)
      : [];

  const filter = buildProspectFilter({
    status: searchParams.get("status"),
    assignedTo: searchParams.get("assignedTo"),
    search: searchParams.get("search"),
    city: searchParams.get("city"),
    rdv: searchParams.get("rdv"),
    paid: searchParams.get("paid"),
    view: searchParams.get("view"),
    userRole: session.user.role,
    userId: session.user.id,
    territoryCityKeys,
  });

  const [prospects, total] = await Promise.all([
    Prospect.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate("assignedTo", "name email role")
      .populate("lockedBy", "name")
      .lean(),
    Prospect.countDocuments(filter),
  ]);

  return NextResponse.json({
    prospects,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}

export async function POST(req: NextRequest) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  if (session.user.role === "dev") {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  await connectDB();

  const body = await req.json();

  // Le montant du devis est réservé à l'admin : à la création par un closer,
  // on garde le prix par défaut du modèle (500 €).
  if (session.user.role !== "admin") {
    delete body.quoteAmount;
  }

  const payload = withCityKey(body);

  /**
   * Résout le closer d'un territoire pour ce prospect.
   * Le territoire ne s'applique qu'à défaut : une attribution explicite gagne.
   */
  async function resolveTerritoryAssignee(): Promise<string | null> {
    if (payload.assignedTo) return null;

    const cityKey = (payload.address as Record<string, unknown> | undefined)
      ?.cityKey;
    if (typeof cityKey !== "string" || cityKey === "") return null;

    const assignments = await resolveAssignmentsByCity([cityKey]);
    return assignments.get(cityKey)?.[0] ?? null;
  }

  const territoryAssignee = await resolveTerritoryAssignee();

  const prospect = await Prospect.create(
    territoryAssignee ? { ...payload, assignedTo: territoryAssignee } : payload
  );

  emitCrmEvent({ type: "prospect:created", prospectId: prospect._id.toString(), userId: session.user.id, timestamp: Date.now() });

  return NextResponse.json(prospect, { status: 201 });
}

// Delete ALL prospects (and related data) — admin only
export async function DELETE() {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  await connectDB();

  const { deletedCount } = await Prospect.deleteMany({});
  await Promise.all([Activity.deleteMany({}), Reminder.deleteMany({})]);

  emitCrmEvent({ type: "prospect:deleted", userId: session.user.id, timestamp: Date.now() });

  return NextResponse.json({ success: true, deletedCount });
}
