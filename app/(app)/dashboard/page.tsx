import Link from "next/link";
import { desc, sql } from "drizzle-orm";
import { ArrowRight, Boxes, PlusCircle } from "lucide-react";

import { db, schema } from "@/lib/db";
import { ROLE_LABELS, type Role } from "@/lib/rbac";
import { requireUser } from "@/lib/session";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { format } from "date-fns";

export const dynamic = "force-dynamic";

type EntryStatus = "logged" | "enquired" | "collected" | "discarded" | "partially_collected";

const STATUS_KEYS: EntryStatus[] = ["logged", "enquired", "partially_collected", "collected", "discarded"];

export default async function DashboardPage() {
  const session = await requireUser();
  const role = (session.user.role ?? "moderator") as Role;

  const [statusRows, totalItems, recent] = await Promise.all([
    db
      .select({ status: schema.entry.status, n: sql<number>`count(*)::int` })
      .from(schema.entry)
      .groupBy(schema.entry.status),
    db.$count(schema.item),
    db
      .select({
        id: schema.entry.id,
        rsNumber: schema.entry.rsNumber,
        status: schema.entry.status,
        foundAt: schema.entry.foundAt,
        foundLocation: schema.entry.foundLocation,
      })
      .from(schema.entry)
      .orderBy(desc(schema.entry.createdAt))
      .limit(10),
  ]);

  const counts = new Map<string, number>(statusRows.map((r) => [r.status, r.n]));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Welcome back</h1>
          <p className="text-sm text-muted-foreground">
            {session.user.name} · <Badge variant="secondary" className="capitalize">{ROLE_LABELS[role]}</Badge>
          </p>
        </div>
        {role === "admin" || role === "editor" || role === "security" ? (
          <Button asChild>
            <Link href="/entries/new">
              <PlusCircle className="size-4" /> New entry
            </Link>
          </Button>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {STATUS_KEYS.map((s, i) => (
          <Card key={s} className="relative overflow-hidden">
            <div className="absolute inset-x-0 top-0 h-1" style={{ backgroundColor: `var(--chart-${i + 1})` }} />
            <CardContent className="p-4 pt-5">
              <p className="text-xs text-muted-foreground capitalize">{s.replaceAll("_", " ")}</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{counts.get(s) ?? 0}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Recent entries</CardTitle>
            <Button asChild variant="ghost" size="sm">
              <Link href="/entries">
                View all <ArrowRight className="size-3.5" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {recent.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                No entries yet. Log your first item.
              </div>
            ) : (
              <ul className="divide-y">
                {recent.map((e) => (
                  <li key={e.id}>
                    <Link href={`/entries/${e.id}`} className="flex items-center justify-between gap-3 py-3 hover:bg-muted/40">
                      <div className="min-w-0">
                        <p className="font-mono text-sm font-semibold">{e.rsNumber}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {e.foundLocation || "—"} · {format(e.foundAt, "dd MMM yyyy, HH:mm")}
                        </p>
                      </div>
                      <StatusBadge status={e.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">At a glance</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Total items logged</span>
              <span className="font-semibold tabular-nums">{totalItems}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Open (logged / enquired)</span>
              <span className="font-semibold tabular-nums">
                {(counts.get("logged") ?? 0) + (counts.get("enquired") ?? 0)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Collected</span>
              <span className="font-semibold tabular-nums">{counts.get("collected") ?? 0}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Discarded</span>
              <span className="font-semibold tabular-nums">{counts.get("discarded") ?? 0}</span>
            </div>
            <div className="flex items-center gap-2 rounded-lg bg-muted p-3 text-xs text-muted-foreground">
              <Boxes className="size-4 shrink-0" />
              Items are rolled up per form. Use the search to find an item by RS number, name, or description.
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
