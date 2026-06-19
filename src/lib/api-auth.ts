import { auth } from "./auth";
import { NextResponse } from "next/server";
import type { UserRole } from "@/types";

export async function getAuthSession() {
  const session = await auth();
  if (!session?.user) {
    return null;
  }
  return session;
}

export function unauthorized() {
  return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
}

export function forbidden() {
  return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
}

export function requireRoles(...roles: UserRole[]) {
  return async () => {
    const session = await getAuthSession();
    if (!session) return { session: null, error: unauthorized() };
    if (!roles.includes(session.user.role)) {
      return { session: null, error: forbidden() };
    }
    return { session, error: null };
  };
}
