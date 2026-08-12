import { db, schema } from "@/lib/db";

type AuditInput = {
  entityType: string;
  entityId: string;
  action: string;
  userId: string | null | undefined;
  before?: unknown;
  after?: unknown;
};

/** Append a row to the immutable audit trail. Values are deep-cloned to jsonb. */
export async function writeAudit({ entityType, entityId, action, userId, before, after }: AuditInput) {
  await db.insert(schema.auditLog).values({
    entityType,
    entityId,
    action,
    userId: userId ?? null,
    before: before === undefined ? null : structuredClone(before),
    after: after === undefined ? null : structuredClone(after),
  });
}
