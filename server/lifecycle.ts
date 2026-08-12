"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";

import { writeAudit } from "@/lib/audit";
import { db, schema } from "@/lib/db";
import { canManageEntry, type Role } from "@/lib/rbac";
import { requireUser } from "@/lib/session";
import { computeEntryStatus, type EntryStatus, type ItemStatus } from "@/lib/status";
import {
  collectionSchema,
  discardSchema,
  enquirySchema,
  firstError,
  policeSchema,
} from "@/lib/validators";

export type LifecycleResult = { ok: true; entryId: string } | { ok: false; error: string };

async function recomputeEntryStatus(entryId: string, userId: string) {
  const [items, enquiryRows] = await Promise.all([
    db.select({ status: schema.item.status }).from(schema.item).where(eq(schema.item.entryId, entryId)),
    db.select({ id: schema.enquiry.id }).from(schema.enquiry).where(eq(schema.enquiry.entryId, entryId)).limit(1),
  ]);
  const status: EntryStatus = computeEntryStatus(
    items.map((i) => i.status as ItemStatus),
    enquiryRows.length > 0,
  );
  await db
    .update(schema.entry)
    .set({ status, updatedAt: new Date(), updatedById: userId })
    .where(eq(schema.entry.id, entryId));
}

type ActiveItem = {
  item: { id: string; name: string; status: ItemStatus; entryId: string };
  entry: { id: string; isValuable: boolean };
};

/** Load an item plus its entry, guarding the "must still be active" rule. */
async function loadActiveItem(itemId: string, role: Role): Promise<ActiveItem | { error: string }> {
  const [itemRow] = await db
    .select({
      id: schema.item.id,
      name: schema.item.name,
      status: schema.item.status,
      entryId: schema.item.entryId,
    })
    .from(schema.item)
    .where(eq(schema.item.id, itemId))
    .limit(1);
  if (!itemRow) return { error: "Item not found." };
  if (itemRow.status !== "logged")
    return { error: "This item has already been collected, discarded, or handed to police." };

  const [entryRow] = await db
    .select({ id: schema.entry.id, isValuable: schema.entry.isValuable })
    .from(schema.entry)
    .where(eq(schema.entry.id, itemRow.entryId))
    .limit(1);
  if (!entryRow) return { error: "Entry not found." };
  if (!canManageEntry(role, entryRow.isValuable)) return { error: "You don't have permission to do this." };

  return { item: itemRow, entry: entryRow };
}

/** Log a guest (or anyone) enquiring about an entry. */
export async function enquireEntry(entryId: string, raw: unknown): Promise<LifecycleResult> {
  const session = await requireUser();
  const role = session.user.role as Role;

  const parsed = enquirySchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstError(parsed) };
  const data = parsed.data;

  const [entryRow] = await db
    .select({ id: schema.entry.id, isValuable: schema.entry.isValuable })
    .from(schema.entry)
    .where(eq(schema.entry.id, entryId))
    .limit(1);
  if (!entryRow) return { ok: false, error: "Entry not found." };
  if (!canManageEntry(role, entryRow.isValuable)) return { ok: false, error: "You don't have permission to do this." };

  try {
    await db.insert(schema.enquiry).values({
      entryId,
      itemId: data.itemId || null,
      enquirerName: data.enquirerName,
      enquirerContact: data.enquirerContact,
      notes: data.notes ?? null,
      enquiredById: session.user.id,
    });
    await recomputeEntryStatus(entryId, session.user.id);
    await writeAudit({
      entityType: "entry",
      entityId: entryId,
      action: "enquire",
      userId: session.user.id,
      after: { enquirerName: data.enquirerName, itemId: data.itemId ?? null },
    });
    revalidatePath("/entries/" + entryId);
    revalidatePath("/dashboard");
    return { ok: true, entryId };
  } catch {
    return { ok: false, error: "Failed to record the enquiry." };
  }
}

/** Guest handover — verification details + signature, item becomes collected. */
export async function collectItem(itemId: string, raw: unknown): Promise<LifecycleResult> {
  const session = await requireUser();
  const role = session.user.role as Role;

  const parsed = collectionSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstError(parsed) };
  const data = parsed.data;

  const loaded = await loadActiveItem(itemId, role);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  const { item, entry } = loaded;

  try {
    await db.insert(schema.collection).values({
      itemId: item.id,
      guestName: data.guestName,
      idType: data.idType,
      idNumber: data.idNumber,
      contact: data.contact,
      signature: data.signature,
      collectedById: session.user.id,
    });
    await db
      .update(schema.item)
      .set({ status: "collected", updatedAt: new Date() })
      .where(eq(schema.item.id, item.id));
    await recomputeEntryStatus(entry.id, session.user.id);
    await writeAudit({
      entityType: "item",
      entityId: item.id,
      action: "collect",
      userId: session.user.id,
      after: { itemName: item.name, guestName: data.guestName, idType: data.idType },
    });
    revalidatePath("/entries/" + entry.id);
    revalidatePath("/entries");
    revalidatePath("/dashboard");
    return { ok: true, entryId: entry.id };
  } catch {
    return { ok: false, error: "Failed to record the collection." };
  }
}

/** Discard an item with a witness — item becomes discarded. */
export async function discardItem(itemId: string, raw: unknown): Promise<LifecycleResult> {
  const session = await requireUser();
  const role = session.user.role as Role;

  const parsed = discardSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstError(parsed) };
  const data = parsed.data;

  const loaded = await loadActiveItem(itemId, role);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  const { item, entry } = loaded;

  try {
    await db.insert(schema.discard).values({
      itemId: item.id,
      reason: data.reason,
      witnessName: data.witnessName,
      witnessSignature: data.witnessSignature,
      discardedById: session.user.id,
    });
    await db
      .update(schema.item)
      .set({ status: "discarded", updatedAt: new Date() })
      .where(eq(schema.item.id, item.id));
    await recomputeEntryStatus(entry.id, session.user.id);
    await writeAudit({
      entityType: "item",
      entityId: item.id,
      action: "discard",
      userId: session.user.id,
      after: { itemName: item.name, reason: data.reason, witnessName: data.witnessName },
    });
    revalidatePath("/entries/" + entry.id);
    revalidatePath("/entries");
    revalidatePath("/dashboard");
    return { ok: true, entryId: entry.id };
  } catch {
    return { ok: false, error: "Failed to record the discard." };
  }
}

/** Dubai Police handover — item becomes handed_to_police. */
export async function policeHandover(itemId: string, raw: unknown): Promise<LifecycleResult> {
  const session = await requireUser();
  const role = session.user.role as Role;

  const parsed = policeSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstError(parsed) };
  const data = parsed.data;

  const loaded = await loadActiveItem(itemId, role);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  const { item, entry } = loaded;

  try {
    await db.insert(schema.policeHandover).values({
      itemId: item.id,
      referenceNumber: data.referenceNumber,
      notes: data.notes ?? null,
      handedById: session.user.id,
    });
    await db
      .update(schema.item)
      .set({ status: "handed_to_police", updatedAt: new Date() })
      .where(eq(schema.item.id, item.id));
    await recomputeEntryStatus(entry.id, session.user.id);
    await writeAudit({
      entityType: "item",
      entityId: item.id,
      action: "police_handover",
      userId: session.user.id,
      after: { itemName: item.name, referenceNumber: data.referenceNumber },
    });
    revalidatePath("/entries/" + entry.id);
    revalidatePath("/entries");
    revalidatePath("/dashboard");
    return { ok: true, entryId: entry.id };
  } catch {
    return { ok: false, error: "Failed to record the police handover." };
  }
}
