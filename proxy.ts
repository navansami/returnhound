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

const AUTH_PATHS = ["/login", "/signup", "/forgot-password", "/reset-password"];

const SESSION_COOKIE = "better-auth.session_token";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE)?.value);

  const isProtected = PROTECTED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );
  const isAuthPage = AUTH_PATHS.includes(pathname);

  if (isProtected && !hasSession) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Signed-in users hitting auth pages go straight to the dashboard.
  if (isAuthPage && hasSession) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|sw.js|manifest.webmanifest|icon|favicon|.*\\.(?:png|jpg|jpeg|svg|webp|ico|css|js|woff2?)$).*)",
  ],
};
