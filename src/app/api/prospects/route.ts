import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { Prospect } from "@/lib/models/prospect.model";
import { Activity } from "@/lib/models/activity.model";
import { Reminder } from "@/lib/models/reminder.model";
import { getAuthSession, unauthorized } from "@/lib/api-auth";
import { emitCrmEvent } from "@/lib/events";

export async function GET(req: NextRequest) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  await connectDB();

  const { searchParams } = req.nextUrl;
  const page = parseInt(searchParams.get("page") || "1");
  const limit = parseInt(searchParams.get("limit") || "20");
  const status = searchParams.get("status");
  const search = searchParams.get("search");
  const assignedTo = searchParams.get("assignedTo");
  const city = searchParams.get("city");

  const filter: Record<string, unknown> = {};

  if (status) filter.status = status;
  if (assignedTo) filter.assignedTo = assignedTo;
  // rdv=upcoming : prospects dont le RDV est à venir, quel que soit le statut
  if (searchParams.get("rdv") === "upcoming") {
    filter.rdvDate = { $gte: new Date() };
  }
  // paid=month : prospects payés depuis le début du mois courant
  if (searchParams.get("paid") === "month") {
    const now = new Date();
    filter.paidAt = { $gte: new Date(now.getFullYear(), now.getMonth(), 1) };
  }
  if (city) filter["address.city"] = { $regex: city, $options: "i" };
  if (search) {
    filter.$or = [
      { name: { $regex: search, $options: "i" } },
      { phone: { $regex: search, $options: "i" } },
      { email: { $regex: search, $options: "i" } },
      { "address.city": { $regex: search, $options: "i" } },
    ];
  }

  // Rôle dev : voit les prospects en RDV — un RDV posé = un site à construire
  // avant la démo.
  if (session.user.role === "dev") {
    filter.status = "rdv";
  }

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

  const prospect = await Prospect.create(body);

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
