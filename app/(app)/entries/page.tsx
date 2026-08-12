import Link from "next/link";
import { and, desc, eq, exists, ilike, inArray, or, sql } from "drizzle-orm";
import { Calendar, ChevronLeft, ChevronRight, Package, PackageSearch } from "lucide-react";
import { format } from "date-fns";

import { EntrySearchBar, type EntryFilters } from "@/components/entry-search-bar";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { db, schema } from "@/lib/db";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

export default async function EntriesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireUser();
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
  const filters: EntryFilters = {
    q: one(sp.q),
    status: one(sp.status),
    storage: one(sp.storage),
    valuable: one(sp.valuable),
    category: one(sp.category),
  };
  const page = Math.max(1, Number(one(sp.page)) || 1);

  const conditions: ReturnType<typeof eq>[] = [];
  if (filters.q) {
    const like = `%${filters.q}%`;
    conditions.push(
      or(
        ilike(schema.entry.rsNumber, like),
        ilike(schema.entry.foundLocation, like),
        ilike(schema.entry.finderName, like),
        exists(
          db
            .select({ one: sql`1` })
            .from(schema.item)
            .where(
              and(
                eq(schema.item.entryId, schema.entry.id),
                or(ilike(schema.item.name, like), ilike(schema.item.description, like)),
              ),
            ),
        ),
      )!,
    );
  }
  if (filters.status && filters.status !== "all") conditions.push(eq(schema.entry.status, filters.status as never));
  if (filters.storage && filters.storage !== "all")
    conditions.push(eq(schema.entry.storageLocation, filters.storage as never));
  if (filters.valuable && filters.valuable !== "all")
    conditions.push(eq(schema.entry.isValuable, filters.valuable === "true"));
  if (filters.category && filters.category !== "all") {
    conditions.push(
      exists(
        db
          .select({ one: sql`1` })
          .from(schema.item)
          .where(and(eq(schema.item.entryId, schema.entry.id), eq(schema.item.category, filters.category as never))),
      ),
    );
  }
  const where = conditions.length ? and(...conditions) : undefined;

  const [total, rows] = await Promise.all([
    db.$count(schema.entry, where),
    db
      .select({
        id: schema.entry.id,
        rsNumber: schema.entry.rsNumber,
        status: schema.entry.status,
        foundAt: schema.entry.foundAt,
        foundLocation: schema.entry.foundLocation,
        isValuable: schema.entry.isValuable,
      })
      .from(schema.entry)
      .where(where)
      .orderBy(desc(schema.entry.foundAt))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
  ]);

  // Items for the page's entries — thumbnails, counts, and the preview list.
  const ids = rows.map((r) => r.id);
  const itemRows = ids.length
    ? await db
        .select({
          id: schema.item.id,
          entryId: schema.item.entryId,
          name: schema.item.name,
          description: schema.item.description,
          imageUrl: schema.item.imageUrl,
        })
        .from(schema.item)
        .where(inArray(schema.item.entryId, ids))
    : [];
  type ItemPreview = { id: string; name: string; description: string | null };
  const byEntry = new Map<string, { count: number; thumb: string | null; items: ItemPreview[] }>();
  for (const r of rows) byEntry.set(r.id, { count: 0, thumb: null, items: [] });
  for (const it of itemRows) {
    const e = byEntry.get(it.entryId);
    if (e) {
      e.count += 1;
      e.items.push({ id: it.id, name: it.name, description: it.description });
      if (!e.thumb && it.imageUrl) e.thumb = it.imageUrl;
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const href = (p: number) => {
    const sp = new URLSearchParams();
    if (filters.q) sp.set("q", filters.q);
    if (filters.status) sp.set("status", filters.status);
    if (filters.storage) sp.set("storage", filters.storage);
    if (filters.valuable) sp.set("valuable", filters.valuable);
    if (filters.category) sp.set("category", filters.category);
    if (p > 1) sp.set("page", String(p));
    return `/entries${sp.size ? `?${sp}` : ""}`;
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Entries</h1>
        <p className="text-sm text-muted-foreground">
          {total} form{filters.q || filters.status || filters.storage || filters.valuable || filters.category ? " matched" : ""}
        </p>
      </div>

      <EntrySearchBar current={filters} />

      {rows.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-16 text-center">
            <PackageSearch className="size-8 text-muted-foreground" />
            <p className="font-medium">No entries found</p>
            <p className="text-sm text-muted-foreground">Try adjusting your search or filters.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {rows.map((e) => {
            const meta = byEntry.get(e.id);
            const preview = meta?.items.slice(0, 2) ?? [];
            const extra = (meta?.count ?? 0) - preview.length;
            return (
              <Link
                key={e.id}
                href={`/entries/${e.id}`}
                className="group flex flex-col rounded-xl border bg-card p-4 shadow-sm transition-colors hover:border-primary/40 hover:shadow-md"
              >
                {/* Header — thumbnail, RS number, status */}
                <div className="flex items-start gap-3">
                  <div className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-lg border bg-muted">
                    {meta?.thumb ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={meta.thumb} alt="" className="size-full object-cover" />
                    ) : (
                      <PackageSearch className="size-5 text-muted-foreground" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-semibold group-hover:text-primary">
                        {e.rsNumber}
                      </span>
                      {e.isValuable ? (
                        <Badge variant="destructive" className="px-1.5 py-0 text-[10px]">
                          Valuable
                        </Badge>
                      ) : null}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">{e.foundLocation || "—"}</p>
                  </div>
                  <StatusBadge status={e.status} />
                </div>

                {/* Item preview — names + short descriptions */}
                <ul className="mt-3 flex-1 space-y-2">
                  {preview.map((it) => (
                    <li key={it.id} className="flex items-start gap-2">
                      <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary/40" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{it.name}</p>
                        {it.description ? (
                          <p className="truncate text-xs text-muted-foreground">{it.description}</p>
                        ) : null}
                      </div>
                    </li>
                  ))}
                  {extra > 0 ? (
                    <li className="text-xs text-muted-foreground">
                      +{extra} more item{extra === 1 ? "" : "s"}
                    </li>
                  ) : null}
                </ul>

                {/* Footer — found date + item count */}
                <div className="mt-3 flex items-center gap-3 border-t pt-2.5 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <Calendar className="size-3.5" />
                    {format(e.foundAt, "dd MMM yyyy, HH:mm")}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Package className="size-3.5" />
                    {meta?.count ?? 0} item{meta?.count === 1 ? "" : "s"}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {totalPages > 1 ? (
        <div className="flex items-center justify-between">
          <Button variant="outline" size="sm" asChild disabled={page <= 1}>
            <Link href={href(page - 1)}>
              <ChevronLeft className="size-4" /> Prev
            </Link>
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <Button variant="outline" size="sm" asChild disabled={page >= totalPages}>
            <Link href={href(page + 1)}>
              Next <ChevronRight className="size-4" />
            </Link>
          </Button>
        </div>
      ) : null}
    </div>
  );
}
