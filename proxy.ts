import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

const PROTECTED_PREFIXES = [
  "/dashboard",
  "/entries",
  "/drafts",
  "/imports",
  "/reports",
  "/users",
  "/settings",
];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // getSessionCookie reads the session cookie including the "__Secure-" prefix
  // Better Auth applies in production. A hardcoded "better-auth.session_token"
  // check only ever matched the dev cookie, so the proxy always believed the
  // user was signed out on Vercel and bounced authenticated routes back to
  // /login while the login page (which validates the real session) sent them
  // forward to /dashboard — an infinite redirect loop.
  const hasSession = Boolean(getSessionCookie(request));

  const isProtected = PROTECTED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );

  if (isProtected && !hasSession) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Auth pages are NOT redirected here on purpose: login/signup/forgot/reset
  // already send signed-in users to /dashboard using a validated session
  // (lib/session.ts). Redirecting on cookie presence alone disagrees with that
  // check whenever the cookie is stale — e.g. after a secret rotation or an
  // expired session — which ping-pongs /login and /dashboard forever.

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|sw.js|manifest.webmanifest|icon|favicon|.*\\.(?:png|jpg|jpeg|svg|webp|ico|css|js|woff2?)$).*)",
  ],
};
