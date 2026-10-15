import { NextRequest, NextResponse } from "next/server";

/**
 * Protection temporaire (Basic Auth) pour verrouiller le déploiement public.
 * Remplacer plus tard par Supabase Auth + rôles admin/consultation.
 *
 * Variables Vercel / .env.local :
 *   BASIC_AUTH_USER
 *   BASIC_AUTH_PASSWORD
 */
export function middleware(req: NextRequest) {
  const user = process.env.BASIC_AUTH_USER;
  const password = process.env.BASIC_AUTH_PASSWORD;

  // En local : pas de blocage si les vars ne sont pas définies
  if (!user || !password) {
    if (process.env.NODE_ENV === "development") {
      return NextResponse.next();
    }
    return new NextResponse("Site non configuré (BASIC_AUTH_* manquants).", {
      status: 503,
    });
  }

  const header = req.headers.get("authorization");
  if (header?.startsWith("Basic ")) {
    try {
      const decoded = atob(header.slice(6));
      const sep = decoded.indexOf(":");
      const u = sep >= 0 ? decoded.slice(0, sep) : decoded;
      const p = sep >= 0 ? decoded.slice(sep + 1) : "";
      if (u === user && p === password) {
        return NextResponse.next();
      }
    } catch {
      /* identifiants invalides */
    }
  }

  return new NextResponse("Authentification requise", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="TCAP", charset="UTF-8"',
    },
  });
}

export const config = {
  matcher: [
    /*
     * Tout sauf assets Next / favicon (évite de re-demander le login à chaque image).
     */
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
