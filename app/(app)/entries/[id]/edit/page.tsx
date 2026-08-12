import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";

import { EntryForm, type EntryFormInitial } from "@/components/entry-form";
import { toDatetimeLocal } from "@/lib/dates";
import { db, schema } from "@/lib/db";
import { canManageEntry, type Role } from "@/lib/rbac";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function EditEntryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireUser();
  const role = session.user.role as Role;

  const [entryRow, items] = await Promise.all([
    db.select().from(schema.entry).where(eq(schema.entry.id, id)).limit(1),
    db.select().from(schema.item).where(eq(schema.item.entryId, id)),
  ]);
  const entry = entryRow[0];
  if (!entry) notFound();
  if (!canManageEntry(role, entry.isValuable)) redirect(`/entries/${id}`);

  const initial: EntryFormInitial = {
    entryId: entry.id,
    rsNumber: entry.rsNumber,
    agentSignature: entry.agentSignature,
    formImage: entry.formImageUrl ? { url: entry.formImageUrl, publicId: entry.formImagePublicId ?? "" } : null,
    values: {
      foundAt: toDatetimeLocal(entry.foundAt),
      receivedAt: entry.receivedAt ? toDatetimeLocal(entry.receivedAt) : "",
      foundLocation: entry.foundLocation,
      finderName: entry.finderName,
      finderDepartment: entry.finderDepartment ?? "",
      finderEmployeeId: entry.finderEmployeeId ?? "",
      agentName: entry.agentName ?? "",
      storageLocation: entry.storageLocation,
      storageDetail: entry.storageDetail ?? "",
      isValuable: entry.isValuable,
      comments: entry.comments ?? "",
      items: items.map((it) => ({
        id: it.id,
        name: it.name,
        description: it.description ?? "",
        category: it.category,
        imageUrl: it.imageUrl,
        imagePublicId: it.imagePublicId,
      })),
    },
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Edit {entry.rsNumber}</h1>
        <p className="text-sm text-muted-foreground">Changes are written to the audit trail.</p>
      </div>
      <EntryForm initial={initial} />
    </div>
  );
}
