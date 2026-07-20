import { NextRequest, NextResponse } from "next/server";
import { isValidObjectId } from "mongoose";
import { connectDB } from "@/lib/db";
import { User } from "@/lib/models/user.model";
import { Prospect } from "@/lib/models/prospect.model";
import { Activity } from "@/lib/models/activity.model";
import { Reminder } from "@/lib/models/reminder.model";
import { getAuthSession, unauthorized, forbidden } from "@/lib/api-auth";

/**
 * Ce que la suppression d'un compte va emporter : sert à afficher un
 * récapitulatif chiffré avant que l'admin confirme.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getAuthSession();
  if (!session) return unauthorized();
  if (session.user.role !== "admin") return forbidden();

  await connectDB();

  const { id } = await params;

  if (!isValidObjectId(id)) {
    return NextResponse.json(
      { error: "Utilisateur introuvable" },
      { status: 404 }
    );
  }

  const user = await User.findById(id).select("name").lean();
  if (!user) {
    return NextResponse.json(
      { error: "Utilisateur introuvable" },
      { status: 404 }
    );
  }

  const [prospects, locks, reminders, activities] = await Promise.all([
    Prospect.countDocuments({ assignedTo: id }),
    Prospect.countDocuments({ lockedBy: id }),
    Reminder.countDocuments({ userId: id }),
    Activity.countDocuments({ userId: id }),
  ]);

  return NextResponse.json({ prospects, locks, reminders, activities });
}
