"use server";

import { revalidatePath } from "next/cache";
import { inArray } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { allocateRsNumbers, bumpRsCounterTo } from "@/lib/rs-number";
import { computeEntryStatus } from "@/lib/status";
import { canImport, type Role } from "@/lib/rbac";
import { requireUser } from "@/lib/session";
import { firstError, importPayloadSchema } from "@/lib/validators";

export type ImportResult = { ok: true; imported: number; itemCount: number } | { ok: false; error: string };

/** Check which of the given RS numbers already exist (for the import preview). */
export async function existingRsNumbers(rsNumbers: string[]): Promise<string[]> {
  const session = await requireUser();
  const role = session.user.role as Role;
  if (!canImport(role)) return [];
  if (rsNumbers.length === 0) return [];
  const rows = await db
    .select({ rsNumber: schema.entry.rsNumber })
    .from(schema.entry)
    .where(inArray(schema.entry.rsNumber, rsNumbers.map((r) => r.toUpperCase())));
  return rows.map((r) => r.rsNumber);
}

/**
 * Commit a CSV import. Validates against the database, allocates any missing
 * RS numbers, batch-inserts entries + items, and bumps the counter past the
 * highest fixed RS number so future entries continue cleanly.
 */
export async function importEntries(raw: unknown): Promise<ImportResult> {
  const session = await requireUser();
  const role = session.user.role as Role;
  if (!canImport(role)) return { ok: false, error: "You don't have permission to import entries." };

  const parsed = importPayloadSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstError(parsed) };
  const { sourceFile, startRsAt, entries } = parsed.data;

  // Optional: continue auto-allocated numbering from a specific value.
  if (startRsAt && startRsAt > 0) await bumpRsCounterTo(startRsAt);

  // Fixed RS numbers must be unique within the file and absent from the DB.
  const provided = entries.filter((e) => e.rsNumber).map((e) => e.rsNumber!.toUpperCase());
  const seen = new Set<string>();
  for (const r of provided) {
    if (seen.has(r)) return { ok: false, error: `Duplicate RS number in the file: ${r}` };
    seen.add(r);
  }
  if (provided.length > 0) {
    const existing = await db
      .select({ rsNumber: schema.entry.rsNumber })
      .from(schema.entry)
      .where(inArray(schema.entry.rsNumber, provided));
    if (existing.length > 0) {
      const list = existing.map((e) => e.rsNumber);
      return {
        ok: false,
        error: `Already in the database: ${list.slice(0, 5).join(", ")}${list.length > 5 ? " and more" : ""}`,
      };
    }
  }

  // Allocate consecutive numbers for the rows that have none.
  const auto = await allocateRsNumbers(entries.length - provided.length);
  let autoIdx = 0;
  const rsByIndex: string[] = new Array(entries.length);
  for (let i = 0; i < entries.length; i++) {
    const rs = entries[i].rsNumber;
    rsByIndex[i] = rs ? rs.toUpperCase() : auto[autoIdx++]!;
  }

  // Keep the counter ahead of any fixed RS numbers from the file.
  const maxFixed = provided.reduce((m, r) => Math.max(m, parseInt(r.replace(/^RS/i, ""), 10) || 0), 0);
  if (maxFixed > 0) await bumpRsCounterTo(maxFixed + 1);

  try {
    const inserted = await db
      .insert(schema.entry)
      .values(
        entries.map((e, i) => {
          const isValuable = e.storageLocation === "security" || e.isValuable;
          return {
            rsNumber: rsByIndex[i],
            status: computeEntryStatus(e.items.map((it) => it.status), false),
            foundAt: e.foundAt,
            foundLocation: e.foundLocation,
            finderName: e.finderName,
            finderDepartment: e.finderDepartment ?? null,
            finderEmployeeId: e.finderEmployeeId ?? null,
            agentName: e.agentName ?? null,
            storageLocation: e.storageLocation,
            storageDetail: e.storageDetail ?? null,
            isValuable,
            comments: e.comments ?? null,
            createdById: session.user.id,
            updatedById: session.user.id,
          };
        }),
      )
      .returning({ id: schema.entry.id, rsNumber: schema.entry.rsNumber });

    const idByRs = new Map(inserted.map((r) => [r.rsNumber, r.id]));
    const itemRows: (typeof schema.item.$inferInsert)[] = [];
    for (let i = 0; i < entries.length; i++) {
      const entryId = idByRs.get(rsByIndex[i])!;
      for (const it of entries[i].items) {
        itemRows.push({
          entryId,
          name: it.name,
          description: it.description ?? null,
          category: it.category,
          status: it.status,
        });
      }
    }

    try {
      await db.insert(schema.item).values(itemRows);
    } catch {
      // Best-effort rollback over HTTP: drop the entries (items cascade).
      await db.delete(schema.entry).where(inArray(schema.entry.id, inserted.map((r) => r.id)));
      return { ok: false, error: "Failed to save the imported items. No entries were imported." };
    }

    await db.insert(schema.auditLog).values(
      inserted.map((r) => ({
        entityType: "entry",
        entityId: r.id,
        action: "import",
        userId: session.user.id,
        after: { rsNumber: r.rsNumber, source: sourceFile },
      })),
    );

    revalidatePath("/entries");
    revalidatePath("/dashboard");
    return { ok: true, imported: inserted.length, itemCount: itemRows.length };
  } catch {
    return { ok: false, error: "The import failed. No entries were added." };
  }
}
