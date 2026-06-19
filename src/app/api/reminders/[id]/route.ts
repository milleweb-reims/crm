import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { Reminder } from "@/lib/models/reminder.model";
import { getAuthSession, unauthorized } from "@/lib/api-auth";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  await connectDB();

  const { id } = await params;
  const body = await req.json();

  const reminder = await Reminder.findByIdAndUpdate(id, body, {
    new: true,
  }).lean();

  if (!reminder) {
    return NextResponse.json(
      { error: "Rappel introuvable" },
      { status: 404 }
    );
  }

  return NextResponse.json(reminder);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  await connectDB();

  const { id } = await params;
  const reminder = await Reminder.findByIdAndDelete(id);

  if (!reminder) {
    return NextResponse.json(
      { error: "Rappel introuvable" },
      { status: 404 }
    );
  }

  return NextResponse.json({ success: true });
}
