import { NextRequest, NextResponse } from "next/server";
import { isValidObjectId } from "mongoose";

import { forbidden, getAuthSession, unauthorized } from "@/lib/api-auth";
import { connectDB } from "@/lib/db";
import { startImpersonation, stopImpersonation } from "@/lib/impersonation";
import { User } from "@/lib/models/user.model";
import type { UserRole } from "@/types";

interface TargetRow {
  readonly name: string;
  readonly role: UserRole;
  readonly isActive: boolean;
}

/**
 * Démarre une substitution : `POST { userId }`.
 *
 * Le contrôle porte sur le compte RÉEL, pas sur l'identité effective. Sans cette
 * distinction, un admin substitué à un closer perdrait le droit de changer de
 * cible — et surtout, le rôle de la cible déciderait de qui peut se substituer.
 */
export async function POST(req: NextRequest) {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  const real = session.impersonator ?? session.user;
  if (real.role !== "admin") return forbidden();

  const body = (await req.json()) as Record<string, unknown>;
  const userId = typeof body.userId === "string" ? body.userId : "";

  if (!isValidObjectId(userId)) {
    return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 404 });
  }

  if (userId === real.id) {
    return NextResponse.json(
      { error: "Vous êtes déjà sur votre propre compte" },
      { status: 400 }
    );
  }

  await connectDB();

  const target = (await User.findById(userId)
    .select("name role isActive")
    .lean()) as TargetRow | null;

  if (!target) {
    return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 404 });
  }

  // Un compte désactivé ne peut pas se connecter : se substituer à lui
  // montrerait une vue que personne ne peut atteindre.
  if (!target.isActive) {
    return NextResponse.json(
      { error: "Ce compte est désactivé" },
      { status: 400 }
    );
  }

  await startImpersonation(real.id, userId);

  // Trace minimale : la substitution donne des droits d'écriture sous le nom
  // d'un autre, elle ne doit jamais être silencieuse côté serveur.
  console.info("Substitution démarrée", {
    admin: real.id,
    target: userId,
    targetRole: target.role,
  });

  return NextResponse.json({
    user: { _id: userId, name: target.name, role: target.role },
  });
}

/**
 * Arrête la substitution. Aucun contrôle de rôle : rendre la main est toujours
 * sûr, et l'identité effective pendant une substitution n'est justement pas
 * celle d'un admin.
 */
export async function DELETE() {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  if (session.impersonator) {
    console.info("Substitution arrêtée", {
      admin: session.impersonator.id,
      target: session.user.id,
    });
  }

  await stopImpersonation();

  return NextResponse.json({ success: true });
}
