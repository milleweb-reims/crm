import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { Prospect } from "@/lib/models/prospect.model";
import { Activity } from "@/lib/models/activity.model";
import { Reminder } from "@/lib/models/reminder.model";
import { getAuthSession, unauthorized } from "@/lib/api-auth";
import { emitCrmEvent } from "@/lib/events";
import { withCityKey } from "@/lib/city";
import { resolveAssignmentsByCity } from "@/lib/territory-service";

/**
 * Builds a MongoDB filter for prospect queries based on search parameters and user role.
 * Applies dev role restrictions: limits to rdv/paye prospects, excludes those with devUrl
 * unless viewing the delivery pipeline. Structures search with $or across name, phone, email, city.
 *
 * @param params - Filter parameters from URL search params and session
 * @returns MongoDB filter object for find/countDocuments operations
 */
function buildProspectFilter(params: {
  readonly status?: string | null;
  readonly assignedTo?: string | null;
  readonly search?: string | null;
  readonly city?: string | null;
  readonly rdv?: string | null;
  readonly paid?: string | null;
  readonly view?: string | null;
  readonly userRole: string;
  readonly userId: string;
}): Readonly<Record<string, unknown>> {
  const filter = {
    ...(params.status && { status: params.status }),
    ...(params.assignedTo && { assignedTo: params.assignedTo }),
    ...(params.rdv === "upcoming" && { rdvDate: { $gte: new Date() } }),
    ...(params.paid === "month" && {
      paidAt: {
        $gte: new Date(
          new Date().getFullYear(),
          new Date().getMonth(),
          1
        ),
      },
    }),
    ...(params.city && { "address.city": { $regex: params.city, $options: "i" } }),
    ...(params.search && {
      $or: [
        { name: { $regex: params.search, $options: "i" } },
        { phone: { $regex: params.search, $options: "i" } },
        { email: { $regex: params.search, $options: "i" } },
        { "address.city": { $regex: params.search, $options: "i" } },
      ],
    }),
  };

  // Un closer ne voit que ses prospects. L'attribution n'était jusqu'ici qu'une
  // réservation : elle empêchait un autre closer de prendre la fiche, sans la
  // masquer. Attribuer une ville n'avait donc aucun effet sur ce que le closer
  // avait sous les yeux.
  //
  // La valeur est écrasée volontairement, et non fusionnée : un closer qui
  // passerait `?assignedTo=<autre>` dans l'URL ne doit pas contourner la règle.
  if (params.userRole === "closer") {
    return { ...filter, assignedTo: params.userId };
  }

  if (params.userRole !== "dev") {
    return filter;
  }

  const devFilter = { ...filter, status: { $in: ["rdv", "paye"] } };

  if (params.view === "delivery") {
    return devFilter;
  }

  const noDevUrl = { $or: [{ devUrl: null }, { devUrl: "" }] };

  if (filter.$or) {
    const { $or, ...filterWithoutOr } = devFilter;
    return {
      ...filterWithoutOr,
      $and: [{ $or }, noDevUrl],
    };
  }

  return { ...devFilter, ...noDevUrl };
}

export async function GET(req: NextRequest) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  await connectDB();

  const { searchParams } = req.nextUrl;
  const page = parseInt(searchParams.get("page") || "1");
  const limit = parseInt(searchParams.get("limit") || "20");

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
