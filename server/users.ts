"use server";

import { revalidatePath } from "next/cache";
import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";

import { writeAudit } from "@/lib/audit";
import { auth } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { canManageUsers, type Role } from "@/lib/rbac";
import { requireUser } from "@/lib/session";

export type UserActionResult = { ok: true } | { ok: false; error: string };

const userUpdateSchema = z.object({
  role: z.enum(["admin", "editor", "security", "moderator"]),
  department: z.string().trim().max(200).optional().nullable(),
  employeeId: z.string().trim().max(100).optional().nullable(),
  disabled: z.boolean().default(false),
});

const userCreateSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Enter a valid email address")
    .refine((email) => email.endsWith("@fairmont.com"), "Access is restricted to @fairmont.com email addresses."),
  password: z.string().min(8, "Password must be at least 8 characters").max(128, "Password is too long"),
  role: z.enum(["admin", "editor", "security", "moderator"]),
});

/** Create a new account with any role — admins only. Users are verified by default. */
export async function createUser(raw: unknown): Promise<UserActionResult> {
  const session = await requireUser();
  const role = session.user.role as Role;
  if (!canManageUsers(role)) return { ok: false, error: "Only admins can manage users." };

  const parsed = userCreateSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid user details." };
  const data = parsed.data;

  const existing = await db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(eq(schema.user.email, data.email))
    .limit(1);
  if (existing.length > 0) return { ok: false, error: "A user with that email already exists." };

  let userId: string;
  try {
    const res = await auth.api.signUpEmail({
      body: {
        email: data.email,
        password: data.password,
        name: data.name,
        callbackURL: `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/login`,
      },
    });
    if (!res.user) return { ok: false, error: "Failed to create the user." };
    userId = res.user.id;
  } catch (err) {
    const message = err instanceof Error && err.message ? err.message : "Failed to create the user.";
    return { ok: false, error: message };
  }

  try {
    // Admin-created accounts are verified by default — no confirmation email needed.
    await db
      .update(schema.user)
      .set({ emailVerified: true, role: data.role, updatedAt: new Date() })
      .where(eq(schema.user.id, userId));

    await writeAudit({
      entityType: "user",
      entityId: userId,
      action: "create",
      userId: session.user.id,
      after: { email: data.email, name: data.name, role: data.role, emailVerified: true, disabled: false },
    });

    revalidatePath("/users");
    return { ok: true };
  } catch {
    return { ok: false, error: "User created, but marking them verified failed — refresh the Users page to check." };
  }
}

/** Update a user's role / department / employee ID / disabled flag — admins only. */
export async function updateUser(userId: string, raw: unknown): Promise<UserActionResult> {
  const session = await requireUser();
  const role = session.user.role as Role;
  if (!canManageUsers(role)) return { ok: false, error: "Only admins can manage users." };

  const parsed = userUpdateSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Invalid user update." };
  const data = parsed.data;

  const [userRow] = await db
    .select({ id: schema.user.id, role: schema.user.role, disabled: schema.user.disabled })
    .from(schema.user)
    .where(eq(schema.user.id, userId));
  if (!userRow) return { ok: false, error: "User not found." };

  // Never allow an admin to lock themselves out.
  if (userId === session.user.id) {
    if (data.disabled) return { ok: false, error: "You can't disable your own account." };
    if (data.role !== "admin") return { ok: false, error: "You can't remove your own admin role." };
  }

  // Always keep at least one active admin.
  if (userRow.role === "admin" && data.role !== "admin") {
    const otherAdmins = await db.$count(
      schema.user,
      and(eq(schema.user.role, "admin"), eq(schema.user.disabled, false), ne(schema.user.id, userId)),
    );
    if (otherAdmins === 0) {
      return { ok: false, error: "There must always be at least one active admin." };
    }
  }

  const before = { role: userRow.role, disabled: userRow.disabled };
  try {
    await db
      .update(schema.user)
      .set({
        role: data.role,
        department: data.department ?? null,
        employeeId: data.employeeId ?? null,
        disabled: data.disabled,
        updatedAt: new Date(),
      })
      .where(eq(schema.user.id, userId));

    await writeAudit({
      entityType: "user",
      entityId: userId,
      action: "update",
      userId: session.user.id,
      before,
      after: { role: data.role, disabled: data.disabled, department: data.department ?? null, employeeId: data.employeeId ?? null },
    });

    revalidatePath("/users");
    return { ok: true };
  } catch {
    return { ok: false, error: "Failed to update the user." };
  }
}
