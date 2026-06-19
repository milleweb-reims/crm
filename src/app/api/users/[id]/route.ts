import { NextRequest, NextResponse } from "next/server";
import { hash } from "bcryptjs";
import { connectDB } from "@/lib/db";
import { User } from "@/lib/models/user.model";
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

  // Non-admins can only update their own profile
  if (session.user.role !== "admin" && id !== session.user.id) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  // Non-admins cannot change roles
  if (session.user.role !== "admin" && body.role) {
    delete body.role;
  }

  // Hash password if provided
  if (body.password) {
    body.passwordHash = await hash(body.password, 12);
    delete body.password;
  }

  const user = await User.findByIdAndUpdate(id, body, {
    new: true,
    select: "-passwordHash",
  }).lean();

  if (!user) {
    return NextResponse.json(
      { error: "Utilisateur introuvable" },
      { status: 404 }
    );
  }

  return NextResponse.json(user);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  await connectDB();

  const { id } = await params;

  // Cannot delete yourself
  if (id === session.user.id) {
    return NextResponse.json(
      { error: "Vous ne pouvez pas supprimer votre propre compte" },
      { status: 400 }
    );
  }

  const user = await User.findByIdAndUpdate(
    id,
    { isActive: false },
    { new: true, select: "-passwordHash" }
  ).lean();

  if (!user) {
    return NextResponse.json(
      { error: "Utilisateur introuvable" },
      { status: 404 }
    );
  }

  return NextResponse.json(user);
}
