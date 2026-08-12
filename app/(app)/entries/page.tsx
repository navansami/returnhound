import Link from "next/link";
import { and, desc, eq, exists, ilike, inArray, or, sql } from "drizzle-orm";
import { ChevronLeft, ChevronRight, PackageSearch } from "lucide-react";
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

  // Thumbnails + item counts for the page's entries.
  const ids = rows.map((r) => r.id);
  const itemRows = ids.length
    ? await db
        .select({ entryId: schema.item.entryId, imageUrl: schema.item.imageUrl })
        .from(schema.item)
        .where(inArray(schema.item.entryId, ids))
    : [];
  const byEntry = new Map<string, { count: number; thumb: string | null }>();
  for (const r of rows) byEntry.set(r.id, { count: 0, thumb: null });
  for (const it of itemRows) {
    const e = byEntry.get(it.entryId);
    if (e) {
      e.count += 1;
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
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y">
              {rows.map((e) => {
                const meta = byEntry.get(e.id);
                return (
                  <li key={e.id}>
                    <Link href={`/entries/${e.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40">
                      <div className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-lg border bg-muted">
                        {meta?.thumb ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={meta.thumb} alt="" className="size-full object-cover" />
                        ) : (
                          <PackageSearch className="size-5 text-muted-foreground" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm font-semibold">{e.rsNumber}</span>
                          {e.isValuable ? (
                            <Badge variant="destructive" className="px-1.5 py-0 text-[10px]">
                              Valuable
                            </Badge>
                          ) : null}
                        </div>
                        <p className="truncate text-xs text-muted-foreground">
                          {meta?.count ?? 0} item{meta?.count === 1 ? "" : "s"} · {e.foundLocation || "—"}
                        </p>
                        <p className="text-xs text-muted-foreground">{format(e.foundAt, "dd MMM yyyy, HH:mm")}</p>
                      </div>
                      <StatusBadge status={e.status} />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
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
