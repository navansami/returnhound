import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import type { Role } from "@/lib/rbac";

/** Read the current session. Memoized per-request with React.cache. */
export const getSession = cache(async () => {
  const session = await auth.api.getSession({ headers: await headers() });
  return session;
});

/** Returns the session or redirects to /login. Call from server components/actions. */
export async function requireUser() {
  const session = await getSession();
  if (!session?.user) redirect("/login");
  return session;
}

/** Returns the session if the user holds one of the given roles, else redirects. */
export async function requireRole(...roles: Role[]) {
  const session = await requireUser();
  const role = session.user.role as Role;
  if (!roles.includes(role)) redirect("/");
  return { session, role };
}
