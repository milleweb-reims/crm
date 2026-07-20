import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { Reminder } from "@/lib/models/reminder.model";
import { getAuthSession, unauthorized } from "@/lib/api-auth";

/**
 * Builds a MongoDB filter for reminder queries based on role and query parameters.
 * Non-admins see only their own reminders; admins see all.
 */
function buildReminderFilter(params: {
  readonly userId: string;
  readonly userRole: string;
  readonly prospectId?: string | null;
  readonly isTodayView: boolean;
}): Record<string, unknown> {
  const dateRange =
    params.isTodayView ?
      (() => {
        const start = new Date();
        start.setHours(0, 0, 0, 0);
        const end = new Date();
        end.setHours(23, 59, 59, 999);
        return { dueDate: { $gte: start, $lte: end }, isCompleted: false };
      })()
    : {};

  return {
    ...(params.userRole !== "admin" && { userId: params.userId }),
    ...(params.prospectId && { prospectId: params.prospectId }),
    ...dateRange,
  };
}

export async function GET(req: NextRequest) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  await connectDB();

  const { searchParams } = req.nextUrl;

  const filter = buildReminderFilter({
    userId: session.user.id,
    userRole: session.user.role,
    prospectId: searchParams.get("prospectId"),
    isTodayView: searchParams.get("today") === "true",
  });

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
