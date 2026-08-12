"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";

import { writeAudit } from "@/lib/audit";
import { db, schema } from "@/lib/db";
import { canCreateEntry, type Role } from "@/lib/rbac";
import { requireUser } from "@/lib/session";

export type DraftResult = { ok: true; draftId?: string } | { ok: false; error: string };

/** Create a pending draft from a photographed paper form. */
export async function createDraft(raw: unknown): Promise<DraftResult> {
  const session = await requireUser();
  const role = session.user.role as Role;
  if (!canCreateEntry(role)) return { ok: false, error: "You don't have permission to create drafts." };

  const { formImageUrl, formImagePublicId } = (raw ?? {}) as { formImageUrl?: string; formImagePublicId?: string };
  if (!formImageUrl) return { ok: false, error: "The form photo is required." };

  try {
    const [draft] = await db
      .insert(schema.draft)
      .values({ formImageUrl, formImagePublicId, status: "pending", createdById: session.user.id })
      .returning({ id: schema.draft.id });
    await writeAudit({
      entityType: "draft",
      entityId: draft.id,
      action: "create",
      userId: session.user.id,
      after: { status: "pending" },
    });
    revalidatePath("/drafts");
    return { ok: true, draftId: draft.id };
  } catch {
    return { ok: false, error: "Failed to create the draft." };
  }
}

/** Mark a draft as approved once its entry has been created from it. */
export async function approveDraft(draftId: string): Promise<DraftResult> {
  const session = await requireUser();
  const role = session.user.role as Role;
  if (!canCreateEntry(role)) return { ok: false, error: "You don't have permission to approve drafts." };

  try {
    await db
      .update(schema.draft)
      .set({ status: "approved", updatedAt: new Date() })
      .where(eq(schema.draft.id, draftId));
    await writeAudit({
      entityType: "draft",
      entityId: draftId,
      action: "approve",
      userId: session.user.id,
      after: { status: "approved" },
    });
    revalidatePath("/drafts");
    return { ok: true };
  } catch {
    return { ok: false, error: "Failed to approve the draft." };
  }
}

/** Reject a draft (bad photo, duplicate, etc.). */
export async function rejectDraft(draftId: string): Promise<DraftResult> {
  const session = await requireUser();
  const role = session.user.role as Role;
  if (!canCreateEntry(role)) return { ok: false, error: "You don't have permission to reject drafts." };

  try {
    await db
      .update(schema.draft)
      .set({ status: "rejected", updatedAt: new Date() })
      .where(eq(schema.draft.id, draftId));
    await writeAudit({ entityType: "draft", entityId: draftId, action: "reject", userId: session.user.id });
    revalidatePath("/drafts");
    return { ok: true };
  } catch {
    return { ok: false, error: "Failed to reject the draft." };
  }
}
