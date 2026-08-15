import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq, inArray } from "drizzle-orm";
import { format } from "date-fns";
import { CalendarClock, ChevronLeft, MapPin, ShieldAlert, User } from "lucide-react";

import { EntryActions } from "@/components/entry-actions";
import { CollectionDialog, DiscardDialog, EnquiryDialog, PoliceDialog } from "@/components/lifecycle-dialogs";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { db, schema } from "@/lib/db";
import { ID_TYPE_LABELS, ITEM_STATUS_LABELS, STORAGE_LABELS } from "@/lib/labels";
import { canDeleteEntry, canManageEntry, type Role } from "@/lib/rbac";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function EntryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireUser();
  const role = session.user.role as Role;

  const [entryRow, items, audit] = await Promise.all([
    db.select().from(schema.entry).where(eq(schema.entry.id, id)).limit(1),
    db.select().from(schema.item).where(eq(schema.item.entryId, id)),
    db
      .select({
        action: schema.auditLog.action,
        createdAt: schema.auditLog.createdAt,
        userName: schema.user.name,
      })
      .from(schema.auditLog)
      .leftJoin(schema.user, eq(schema.auditLog.userId, schema.user.id))
      .where(and(eq(schema.auditLog.entityType, "entry"), eq(schema.auditLog.entityId, id)))
      .orderBy(desc(schema.auditLog.createdAt))
      .limit(30),
  ]);

  const entry = entryRow[0];
  if (!entry) notFound();

  const itemIds = items.map((i) => i.id);
  const canEdit = canManageEntry(role, entry.isValuable);

  // Lifecycle records for the items on this entry.
  const [collections, discards, police, enquiries] = itemIds.length
    ? await Promise.all([
        db
          .select({
            itemId: schema.collection.itemId,
            guestName: schema.collection.guestName,
            idType: schema.collection.idType,
            idNumber: schema.collection.idNumber,
            contact: schema.collection.contact,
            collectedAt: schema.collection.collectedAt,
            collectorName: schema.user.name,
          })
          .from(schema.collection)
          .leftJoin(schema.user, eq(schema.collection.collectedById, schema.user.id))
          .where(inArray(schema.collection.itemId, itemIds)),
        db
          .select({ itemId: schema.discard.itemId, reason: schema.discard.reason, witnessName: schema.discard.witnessName, discardedAt: schema.discard.discardedAt })
          .from(schema.discard)
          .where(inArray(schema.discard.itemId, itemIds)),
        db
          .select({ itemId: schema.policeHandover.itemId, referenceNumber: schema.policeHandover.referenceNumber, handedAt: schema.policeHandover.handedAt })
          .from(schema.policeHandover)
          .where(inArray(schema.policeHandover.itemId, itemIds)),
        db
          .select({ itemId: schema.enquiry.itemId, enquirerName: schema.enquiry.enquirerName, enquiredAt: schema.enquiry.enquiredAt })
          .from(schema.enquiry)
          .where(and(eq(schema.enquiry.entryId, entry.id), inArray(schema.enquiry.itemId, itemIds))),
      ])
    : [[], [], [], []];

  const byItem = {
    collections: new Map(collections.map((c) => [c.itemId, c])),
    discards: new Map(discards.map((d) => [d.itemId, d])),
    police: new Map(police.map((p) => [p.itemId, p])),
    enquiries: new Map(enquiries.map((e) => [e.itemId, e])),
  };

  return (
    <div className="space-y-6">
      <div>
        <Link href="/entries" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-4" /> All entries
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h1 className="font-mono text-2xl font-semibold">{entry.rsNumber}</h1>
          <StatusBadge status={entry.status} />
          {entry.isValuable ? (
            <Badge variant="destructive">
              <ShieldAlert className="size-3" /> Valuable
            </Badge>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <EnquiryDialog entryId={entry.id} items={items.map((i) => ({ id: i.id, name: i.name, status: i.status }))} canEdit={canEdit} />
        <EntryActions entryId={entry.id} canDelete={canDeleteEntry(role)} canEdit={canEdit} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* Finder / receipt */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Details</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 text-sm sm:grid-cols-2">
              <Info icon={MapPin} label="Found at" value={entry.foundLocation} />
              <Info
                icon={CalendarClock}
                label="Found on"
                value={format(entry.foundAt, "dd MMM yyyy, HH:mm")}
              />
              <Info icon={User} label="Finder" value={entry.finderName} />
              <Info label="Finder department" value={entry.finderDepartment || "—"} />
              <Info label="Finder employee ID" value={entry.finderEmployeeId || "—"} />
              <Info
                label="Received by agent"
                value={
                  entry.receivedAt
                    ? `${entry.agentName ?? "Agent"} · ${format(entry.receivedAt, "dd MMM yyyy, HH:mm")}`
                    : entry.agentName ?? "—"
                }
              />
              <Info label="Storage" value={STORAGE_LABELS[entry.storageLocation]} />
              <Info label="Storage detail" value={entry.storageDetail || "—"} />
              {entry.comments ? (
                <div className="sm:col-span-2">
                  <p className="font-medium text-muted-foreground">Comments</p>
                  <p className="mt-1 whitespace-pre-wrap">{entry.comments}</p>
                </div>
              ) : null}
            </CardContent>
          </Card>

          {/* Items */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Items ({items.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {items.map((it) => {
                const collection = byItem.collections.get(it.id);
                const discard = byItem.discards.get(it.id);
                const policeRec = byItem.police.get(it.id);
                return (
                  <div key={it.id} className="rounded-lg border p-3">
                    <div className="flex gap-4">
                      <div className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-md border bg-muted">
                        {it.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={it.imageUrl} alt={it.name} className="size-full object-cover" />
                        ) : (
                          <span className="text-xs text-muted-foreground">No photo</span>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-medium">{it.name}</p>
                          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground capitalize">
                            {it.category.replaceAll("_", " ")}
                          </span>
                        </div>
                        {it.description ? (
                          <p className="mt-0.5 text-sm text-muted-foreground">{it.description}</p>
                        ) : null}
                        <p className="mt-1 text-xs">
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
                            {ITEM_STATUS_LABELS[it.status]}
                          </span>
                        </p>
                      </div>
                    </div>

                    {/* Lifecycle detail + actions */}
                    <div className="mt-3 space-y-1 border-t pt-3 text-xs text-muted-foreground">
                      {collection ? (
                        <p>
                          Collected by <span className="font-medium text-foreground">{collection.guestName}</span> (
                          {ID_TYPE_LABELS[collection.idType]} · {collection.idNumber}) ·{" "}
                          {format(collection.collectedAt, "dd MMM, HH:mm")}
                          {collection.collectorName ? <> · processed by {collection.collectorName}</> : null}
                        </p>
                      ) : null}
                      {discard ? (
                        <p>
                          Discarded by <span className="font-medium text-foreground">{discard.witnessName}</span> ·{" "}
                          {discard.reason} · {format(discard.discardedAt, "dd MMM, HH:mm")}
                        </p>
                      ) : null}
                      {policeRec ? (
                        <p>
                          Police ref <span className="font-mono font-medium text-foreground">{policeRec.referenceNumber}</span> ·{" "}
                          {format(policeRec.handedAt, "dd MMM, HH:mm")}
                        </p>
                      ) : null}
                    </div>

                    {it.status === "logged" ? (
                      <div className="mt-3 flex gap-2">
                        <CollectionDialog item={{ id: it.id, name: it.name, status: it.status }} canEdit={canEdit} />
                        <DiscardDialog item={{ id: it.id, name: it.name, status: it.status }} canEdit={canEdit} />
                        <PoliceDialog item={{ id: it.id, name: it.name, status: it.status }} canEdit={canEdit} />
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          {entry.formImageUrl ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Paper form</CardTitle>
              </CardHeader>
              <CardContent>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={entry.formImageUrl} alt={`Form ${entry.rsNumber}`} className="w-full rounded-lg border" />
              </CardContent>
            </Card>
          ) : null}

          {/* Audit trail */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Audit trail</CardTitle>
            </CardHeader>
            <CardContent>
              {audit.length === 0 ? (
                <p className="text-sm text-muted-foreground">No changes recorded.</p>
              ) : (
                <ul className="space-y-2">
                  {audit.map((a) => (
                    <li key={`${a.createdAt.toISOString()}-${a.action}`} className="flex items-center justify-between gap-2 text-sm">
                      <span className="capitalize">{a.action.replaceAll("_", " ")}</span>
                      <span className="text-right text-xs text-muted-foreground">
                        {a.userName ?? "System"} · {format(a.createdAt, "dd MMM, HH:mm")}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Info({ icon: Icon, label, value }: { icon?: typeof MapPin; label: string; value: string }) {
  return (
    <div>
      <p className="flex items-center gap-1.5 font-medium text-muted-foreground">
        {Icon ? <Icon className="size-3.5" /> : null}
        {label}
      </p>
      <p className="mt-0.5">{value}</p>
    </div>
  );
}
