import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import type { CookieOptions } from "@supabase/ssr";

/** Routes accessibles sans session */
const PUBLIC_PATHS = ["/login", "/auth/callback"];

/** Page affichée aux utilisateurs connectés mais non approuvés */
const PENDING_PATH = "/pending";

/** Routes réservées aux admins (en plus du préfixe /admin) — correspondance exacte */
const ADMIN_ONLY_PATHS = ["/kpi", "/kpi/mois", "/kpi/department", "/dashboard"];

/** Routes réservées aux admins */
const ADMIN_PREFIX = "/admin";

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname.startsWith("/_next") || pathname === "/favicon.ico") {
    return NextResponse.next();
  }

  const isPublic = PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + "/")
  );

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Preview Vercel sans env → éviter MIDDLEWARE_INVOCATION_FAILED
  if (!supabaseUrl || !supabaseAnonKey) {
    console.error("[middleware] Variables Supabase manquantes (Preview?)");
    if (isPublic) return NextResponse.next();
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  let res = NextResponse.next({ request: req });

  try {
    const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        getAll() {
          return req.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value, options }) => {
            req.cookies.set(name, value);
            res.cookies.set(name, value, options);
          });
        },
      },
    });

    const {
      data: { user },
    } = await supabase.auth.getUser();

    // 1. Pas connecté → login
    if (!user && !isPublic) {
      const url = req.nextUrl.clone();
      url.pathname = "/login";
      return NextResponse.redirect(url);
    }

    // 2. Connecté → on quitte /login
    if (user && pathname === "/login") {
      const url = req.nextUrl.clone();
      url.pathname = "/dashboard";
      return NextResponse.redirect(url);
    }

    // 3. Connecté → vérification dans la table users
    if (user && !isPublic) {
      const { data: profile } = await supabase
        .from("users")
        .select("role")
        .eq("email", user.email)
        .maybeSingle();

      const isPending = pathname === PENDING_PATH;

      // Pas encore approuvé → /pending
      if (!profile && !isPending) {
        const url = req.nextUrl.clone();
        url.pathname = PENDING_PATH;
        return NextResponse.redirect(url);
      }

      // Déjà approuvé → pas besoin de rester sur /pending
      if (profile && isPending) {
        const url = req.nextUrl.clone();
        url.pathname = "/dashboard";
        return NextResponse.redirect(url);
      }

      // Route admin → ADMIN uniquement
      if (profile && pathname.startsWith(ADMIN_PREFIX) && profile.role !== "ADMIN") {
        const url = req.nextUrl.clone();
        url.pathname = "/dashboard";
        return NextResponse.redirect(url);
      }

      // Routes admin-only hors préfixe /admin → ADMIN uniquement (correspondance exacte)
      if (profile && profile.role !== "ADMIN") {
        const isAdminOnly = ADMIN_ONLY_PATHS.includes(pathname);
        if (isAdminOnly) {
          const url = req.nextUrl.clone();
          url.pathname = "/capacity";
          return NextResponse.redirect(url);
        }
      }
    }

    return res;
  } catch (err) {
    console.error("[middleware] Échec auth/routing :", err);
    if (isPublic) return NextResponse.next();
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
