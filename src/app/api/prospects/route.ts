import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { Prospect } from "@/lib/models/prospect.model";
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
  if (city) filter["address.city"] = { $regex: city, $options: "i" };
  if (search) {
    filter.$or = [
      { name: { $regex: search, $options: "i" } },
      { phone: { $regex: search, $options: "i" } },
      { email: { $regex: search, $options: "i" } },
      { "address.city": { $regex: search, $options: "i" } },
    ];
  }

  // Dev role: only see assigned en_dev prospects
  if (session.user.role === "dev") {
    filter.status = "en_dev";
    filter.assignedTo = session.user.id;
  }

  const [prospects, total] = await Promise.all([
    Prospect.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate("assignedTo", "name email role")
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
  const prospect = await Prospect.create(body);

  emitCrmEvent({ type: "prospect:created", prospectId: prospect._id.toString(), userId: session.user.id, timestamp: Date.now() });

  return NextResponse.json(prospect, { status: 201 });
}
