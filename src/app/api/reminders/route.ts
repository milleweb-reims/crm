import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { Reminder } from "@/lib/models/reminder.model";
import { getAuthSession, unauthorized } from "@/lib/api-auth";

export async function GET(req: NextRequest) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  await connectDB();

  const { searchParams } = req.nextUrl;
  const prospectId = searchParams.get("prospectId");
  const today = searchParams.get("today");

  const filter: Record<string, unknown> = {};

  // Non-admins only see their own reminders
  if (session.user.role !== "admin") {
    filter.userId = session.user.id;
  }

  if (prospectId) filter.prospectId = prospectId;

  if (today === "true") {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    filter.dueDate = { $gte: start, $lte: end };
    filter.isCompleted = false;
  }

  const reminders = await Reminder.find(filter)
    .sort({ dueDate: 1 })
    .populate("prospectId", "name phone address.city status")
    .populate("userId", "name")
    .lean();

  return NextResponse.json(reminders);
}

export async function POST(req: NextRequest) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  await connectDB();

  const body = await req.json();

  const reminder = await Reminder.create({
    ...body,
    userId: session.user.id,
  });

  return NextResponse.json(reminder, { status: 201 });
}
