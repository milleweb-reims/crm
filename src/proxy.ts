import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  const token =
    request.cookies.get("authjs.session-token")?.value ||
    request.cookies.get("__Secure-authjs.session-token")?.value;

  if (!token) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("callbackUrl", request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // api/webhooks : appelé par des services externes (GoCardless), pas de session
    // .*\\..* : fichiers statiques de /public (logo, icônes...)
    "/((?!login|api/auth|api/webhooks|_next/static|_next/image|favicon.ico|.*\\..*).*)",
  ],
};
