/**
 * Create (or update) a Lost & Found user directly, bypassing email verification.
 * Used while Resend delivery is still being set up.
 *
 * Usage:
 *   npx tsx scripts/create-user.ts --email="x@fairmont.com" --password="..." [--name="Name"]
 */
import { eq } from "drizzle-orm";

import { auth } from "@/lib/auth";
import { db, schema } from "@/lib/db";

function flag(name: string): string | undefined {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  return arg?.split("=").slice(1).join("=");
}

async function main() {
  const email = flag("email")?.toLowerCase();
  const password = flag("password");
  if (!email || !password) {
    console.error('Usage: npx tsx scripts/create-user.ts --email="x@fairmont.com" --password="..." [--name="Name"]');
    process.exit(1);
  }
  const name = flag("name") ?? email.split("@")[0];

  const existing = await db.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.email, email)).limit(1);

  if (existing.length > 0) {
    console.log(`User ${email} already exists — leaving password unchanged, just marking email verified.`);
  } else {
    const res = await auth.api.signUpEmail({
      body: {
        email,
        password,
        name,
        callbackURL: `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/login`,
      },
    });
    console.log(`Created ${res.user?.email} (${res.user?.id}) — role comes from the bootstrap hook.`);
  }

  // The verification email can't be delivered yet; mark verified so password login works.
  await db.update(schema.user).set({ emailVerified: true }).where(eq(schema.user.email, email));

  // Mirror the in-app bootstrap: the first account ever created becomes admin.
  // (Running via auth.api outside a request skips the hook's session context.)
  const total = await db.$count(schema.user);
  if (total === 1) {
    await db.update(schema.user).set({ role: "admin" }).where(eq(schema.user.email, email));
    console.log("First user — promoted to admin.");
  }

  const [u] = await db
    .select({
      id: schema.user.id,
      email: schema.user.email,
      role: schema.user.role,
      emailVerified: schema.user.emailVerified,
      disabled: schema.user.disabled,
    })
    .from(schema.user)
    .where(eq(schema.user.email, email))
    .limit(1);

  console.log("Result:", u ? JSON.stringify(u) : "NOT FOUND");
}

main().catch((e) => {
  console.error("Failed:", e);
  process.exit(1);
});
