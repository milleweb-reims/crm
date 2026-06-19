import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { Activity } from "@/lib/models/activity.model";
import { getAuthSession, unauthorized } from "@/lib/api-auth";

export async function GET(req: NextRequest) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  await connectDB();

  const { searchParams } = req.nextUrl;
  const prospectId = searchParams.get("prospectId");

  if (!prospectId) {
    return NextResponse.json(
      { error: "prospectId requis" },
      { status: 400 }
    );
  }

  const activities = await Activity.find({ prospectId })
    .sort({ createdAt: -1 })
    .populate("userId", "name email role")
    .lean();

  return NextResponse.json(activities);
}

export async function POST(req: NextRequest) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  await connectDB();

  const body = await req.json();

  const activity = await Activity.create({
    ...body,
    userId: session.user.id,
  });

  return NextResponse.json(activity, { status: 201 });
}
