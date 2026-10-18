import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistic auth check that runs before every page and API route: no session cookie means
 * not logged in. Pages redirect to /login and API routes return 401. Whether the session is
 * actually valid is checked against the database in each page and route (lib/auth.ts currentUser).
 */
const SESSION_COOKIE = "sq_session"; // same as lib/auth.ts
const PUBLIC = [/^\/login$/, /^\/api\/auth\//];

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (PUBLIC.some((p) => p.test(pathname)) || request.cookies.has(SESSION_COOKIE)) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "You're not logged in." }, { status: 401 });
  }
  const login = new URL("/login", request.url);
  if (pathname !== "/") login.searchParams.set("next", pathname + search);
  return NextResponse.redirect(login);
}

export const config = {
  // Everything except Next.js assets and static files.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
