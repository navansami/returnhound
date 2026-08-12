"use server";

import { revalidatePath } from "next/cache";
import { eq, inArray } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { nextRsNumber } from "@/lib/rs-number";
import { canCreateEntry, canDeleteEntry, canManageEntry, type Role } from "@/lib/rbac";
import { requireUser } from "@/lib/session";
import { entryInputSchema, firstError } from "@/lib/validators";

export type ActionResult =
  | { ok: true; entryId: string; rsNumber?: string }
  | { ok: false; error: string };

/** Create an entry (one paper form → RS number) with 1–20 items. */
export async function createEntry(raw: unknown): Promise<ActionResult> {
  const session = await requireUser();
  const role = session.user.role as Role;
  if (!canCreateEntry(role)) return { ok: false, error: "You don't have permission to create entries." };

  const parsed = entryInputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstError(parsed) };
  const input = parsed.data;

  const rsNumber = await nextRsNumber();
  const isValuable = input.storageLocation === "security" || input.isValuable;

  // Security agents may only log items held in Security (valuable).
  if (role === "security" && !isValuable) {
    return { ok: false, error: "Security can only log items stored in Security (valuable)." };
  }

  try {
    const [newEntry] = await db
      .insert(schema.entry)
      .values({
        rsNumber,
        foundAt: input.foundAt,
        foundLocation: input.foundLocation,
        finderName: input.finderName,
        finderDepartment: input.finderDepartment ?? null,
        finderEmployeeId: input.finderEmployeeId ?? null,
        receivedAt: input.receivedAt ?? input.foundAt,
        agentUserId: session.user.id,
        agentName: input.agentName ?? session.user.name,
        agentSignature: input.agentSignature ?? null,
        storageLocation: input.storageLocation,
        storageDetail: input.storageDetail ?? null,
        isValuable,
        comments: input.comments ?? null,
        formImageUrl: input.formImageUrl ?? null,
        formImagePublicId: input.formImagePublicId ?? null,
        createdById: session.user.id,
        updatedById: session.user.id,
      })
      .returning({ id: schema.entry.id, rsNumber: schema.entry.rsNumber });

    try {
      await db.insert(schema.item).values(
        input.items.map((it) => ({
          entryId: newEntry.id,
          name: it.name,
          description: it.description ?? null,
          category: it.category,
          imageUrl: it.imageUrl ?? null,
          imagePublicId: it.imagePublicId ?? null,
        })),
      );
    } catch {
      // Roll back the entry if its items failed to persist (no transaction over HTTP).
      await db.delete(schema.entry).where(eq(schema.entry.id, newEntry.id));
      return { ok: false, error: "Failed to save the items." };
    }

    await writeAudit({
      entityType: "entry",
      entityId: newEntry.id,
      action: "create",
      userId: session.user.id,
      after: { rsNumber: newEntry.rsNumber, isValuable, itemCount: input.items.length },
    });

    revalidatePath("/entries");
    revalidatePath("/dashboard");
    return { ok: true, entryId: newEntry.id, rsNumber: newEntry.rsNumber };
  } catch {
    return { ok: false, error: "Failed to create the entry." };
  }
}

/** Update entry metadata and diff the item list (insert / update / remove). */
export async function updateEntry(entryId: string, raw: unknown): Promise<ActionResult> {
  const session = await requireUser();
  const role = session.user.role as Role;

  const [current] = await db
    .select({ id: schema.entry.id, isValuable: schema.entry.isValuable, rsNumber: schema.entry.rsNumber })
    .from(schema.entry)
    .where(eq(schema.entry.id, entryId));
  if (!current) return { ok: false, error: "Entry not found." };
  if (!canManageEntry(role, current.isValuable))
    return { ok: false, error: "You don't have permission to edit this entry." };

  const parsed = entryInputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstError(parsed) };
  const input = parsed.data;

  const isValuable = input.storageLocation === "security" || input.isValuable;

  try {
    await db
      .update(schema.entry)
      .set({
        foundAt: input.foundAt,
        foundLocation: input.foundLocation,
        finderName: input.finderName,
        finderDepartment: input.finderDepartment ?? null,
        finderEmployeeId: input.finderEmployeeId ?? null,
        receivedAt: input.receivedAt ?? input.foundAt,
        agentName: input.agentName ?? null,
        agentSignature: input.agentSignature ?? null,
        storageLocation: input.storageLocation,
        storageDetail: input.storageDetail ?? null,
        isValuable,
        comments: input.comments ?? null,
        formImageUrl: input.formImageUrl ?? null,
        formImagePublicId: input.formImagePublicId ?? null,
        updatedById: session.user.id,
        updatedAt: new Date(),
      })
      .where(eq(schema.entry.id, entryId));

    // --- Item diff ---
    const existingItems = await db.select({ id: schema.item.id, name: schema.item.name }).from(schema.item).where(eq(schema.item.entryId, entryId));
    const existingIds = new Set(existingItems.map((i) => i.id));
    const submittedIds = new Set(input.items.map((it) => it.id).filter(Boolean) as string[]);

    const toDelete = [...existingIds].filter((id) => !submittedIds.has(id));

    if (toDelete.length > 0) {
      // Never delete an item that has lifecycle records — that would silently erase
      // collection/discard/police history. Block instead.
      const [collections, discards, police, enquiries] = await Promise.all([
        db.select({ itemId: schema.collection.itemId }).from(schema.collection).where(inArray(schema.collection.itemId, toDelete)),
        db.select({ itemId: schema.discard.itemId }).from(schema.discard).where(inArray(schema.discard.itemId, toDelete)),
        db.select({ itemId: schema.policeHandover.itemId }).from(schema.policeHandover).where(inArray(schema.policeHandover.itemId, toDelete)),
        db.select({ itemId: schema.enquiry.itemId }).from(schema.enquiry).where(inArray(schema.enquiry.itemId, toDelete)),
      ]);
      const locked = new Set([...collections, ...discards, ...police, ...enquiries].map((r) => r.itemId));
      const blocked = toDelete.filter((id) => locked.has(id));
      if (blocked.length > 0) {
        return {
          ok: false,
          error: "One or more items have collection/discard/police history and can't be removed. Use the lifecycle actions instead.",
        };
      }
      await db.delete(schema.item).where(inArray(schema.item.id, toDelete));
    }

    const existingById = new Map(existingItems.map((i) => [i.id, true]));
    for (const it of input.items) {
      if (it.id && existingById.has(it.id)) {
        await db
          .update(schema.item)
          .set({
            name: it.name,
            description: it.description ?? null,
            category: it.category,
            imageUrl: it.imageUrl ?? null,
            imagePublicId: it.imagePublicId ?? null,
            updatedAt: new Date(),
          })
          .where(eq(schema.item.id, it.id));
      } else {
        await db.insert(schema.item).values({
          entryId,
          name: it.name,
          description: it.description ?? null,
          category: it.category,
          imageUrl: it.imageUrl ?? null,
          imagePublicId: it.imagePublicId ?? null,
        });
      }
    }

    await writeAudit({
      entityType: "entry",
      entityId: entryId,
      action: "update",
      userId: session.user.id,
      before: { rsNumber: current.rsNumber, isValuable: current.isValuable, itemIds: [...existingIds] },
      after: { rsNumber: current.rsNumber, isValuable, itemIds: [...submittedIds] },
    });

    revalidatePath("/entries");
    revalidatePath("/entries/" + entryId);
    revalidatePath("/dashboard");
    return { ok: true, entryId };
  } catch {
    return { ok: false, error: "Failed to update the entry." };
  }
}

/** Delete an entry entirely — admins only. */
export async function deleteEntry(entryId: string): Promise<ActionResult> {
  const session = await requireUser();
  const role = session.user.role as Role;
  if (!canDeleteEntry(role)) return { ok: false, error: "Only admins can delete entries." };

  const [current] = await db
    .select({ id: schema.entry.id, rsNumber: schema.entry.rsNumber })
    .from(schema.entry)
    .where(eq(schema.entry.id, entryId));
  if (!current) return { ok: false, error: "Entry not found." };

  try {
    await db.delete(schema.entry).where(eq(schema.entry.id, entryId));
    await writeAudit({
      entityType: "entry",
      entityId: entryId,
      action: "delete",
      userId: session.user.id,
      before: { rsNumber: current.rsNumber },
    });
    revalidatePath("/entries");
    revalidatePath("/dashboard");
    return { ok: true, entryId };
  } catch {
    return { ok: false, error: "Failed to delete the entry." };
  }
}
