"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";

import { writeAudit } from "@/lib/audit";
import { db, schema } from "@/lib/db";
import { parseLostFoundForm } from "@/lib/ocr";
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

/**
 * Run OCR on a draft's form photo and store the parsed fields (`parsedData`)
 * so the review page can pre-fill the entry form. The agent always reviews
 * and corrects before saving — the parse is a draft aid, not an approval.
 */
export async function parseDraft(draftId: string): Promise<DraftResult> {
  const session = await requireUser();
  const role = session.user.role as Role;
  if (!canCreateEntry(role)) return { ok: false, error: "You don't have permission to parse drafts." };

  const [draft] = await db.select().from(schema.draft).where(eq(schema.draft.id, draftId)).limit(1);
  if (!draft) return { ok: false, error: "Draft not found." };
  if (draft.status !== "pending") return { ok: false, error: "Only pending drafts can be parsed." };
  if (!draft.formImageUrl) return { ok: false, error: "This draft has no form photo to parse." };

  const result = await parseLostFoundForm(draft.formImageUrl);
  if (!result.ok) return { ok: false, error: result.error };

  try {
    await db
      .update(schema.draft)
      .set({ parsedData: result.data, updatedAt: new Date() })
      .where(eq(schema.draft.id, draftId));
    await writeAudit({
      entityType: "draft",
      entityId: draftId,
      action: "parse",
      userId: session.user.id,
      after: { itemCount: result.data.items.length, hasParsedData: true },
    });
    revalidatePath("/drafts");
    revalidatePath(`/drafts/${draftId}`);
    return { ok: true };
  } catch {
    return { ok: false, error: "Failed to save the parsed form." };
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
