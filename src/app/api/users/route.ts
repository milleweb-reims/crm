import { NextRequest, NextResponse } from "next/server";
import { hash } from "bcryptjs";
import { connectDB } from "@/lib/db";
import { User } from "@/lib/models/user.model";
import { getAuthSession, unauthorized } from "@/lib/api-auth";

export async function GET() {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  await connectDB();

  const users = await User.find({}, "-passwordHash").sort({ name: 1 }).lean();

  return NextResponse.json(users);
}

export async function POST(req: NextRequest) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  await connectDB();

  const body = await req.json();
  const { name, email, password, role } = body;

  if (!name || !email || !password || !role) {
    return NextResponse.json(
      { error: "Tous les champs sont requis" },
      { status: 400 }
    );
  }

  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing) {
    return NextResponse.json(
      { error: "Cet email est déjà utilisé" },
      { status: 409 }
    );
  }

  const passwordHash = await hash(password, 12);

  const user = await User.create({
    name,
    email: email.toLowerCase(),
    passwordHash,
    role,
  });

  const { passwordHash: _, ...userWithoutPassword } = user.toObject();
  void _;

  return NextResponse.json(userWithoutPassword, { status: 201 });
}
