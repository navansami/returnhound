"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";

import { CATEGORIES } from "@/lib/validators";
import { CATEGORY_LABELS, STORAGE_LABELS } from "@/lib/labels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export type EntryFilters = {
  q?: string;
  status?: string;
  storage?: string;
  valuable?: string;
  category?: string;
};

function buildHref(f: EntryFilters): string {
  const sp = new URLSearchParams();
  if (f.q?.trim()) sp.set("q", f.q.trim());
  if (f.status && f.status !== "all") sp.set("status", f.status);
  if (f.storage && f.storage !== "all") sp.set("storage", f.storage);
  if (f.valuable && f.valuable !== "all") sp.set("valuable", f.valuable);
  if (f.category && f.category !== "all") sp.set("category", f.category);
  const qs = sp.toString();
  return qs ? `/entries?${qs}` : "/entries";
}

export function EntrySearchBar({ current }: { current: EntryFilters }) {
  const router = useRouter();
  const [q, setQ] = useState(current.q ?? "");

  const setFilter = (patch: Partial<EntryFilters>) => {
    router.push(buildHref({ ...current, ...patch }));
  };

  // Debounced text search.
  useEffect(() => {
    const t = setTimeout(() => {
      if (q !== (current.q ?? "")) setFilter({ q });
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search RS number, item, location, finder…"
          className="pl-9"
        />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Select value={current.status ?? "all"} onValueChange={(v) => setFilter({ status: v })}>
          <SelectTrigger className="h-9 text-xs">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {["logged", "enquired", "partially_collected", "collected", "discarded"].map((s) => (
              <SelectItem key={s} value={s}>
                {s.replaceAll("_", " ")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={current.storage ?? "all"} onValueChange={(v) => setFilter({ storage: v })}>
          <SelectTrigger className="h-9 text-xs">
            <SelectValue placeholder="Storage" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All storage</SelectItem>
            {(Object.keys(STORAGE_LABELS) as (keyof typeof STORAGE_LABELS)[]).map((k) => (
              <SelectItem key={k} value={k}>
                {STORAGE_LABELS[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={current.valuable ?? "all"} onValueChange={(v) => setFilter({ valuable: v })}>
          <SelectTrigger className="h-9 text-xs">
            <SelectValue placeholder="Value" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All items</SelectItem>
            <SelectItem value="true">Valuable only</SelectItem>
            <SelectItem value="false">Not valuable</SelectItem>
          </SelectContent>
        </Select>
        <Select value={current.category ?? "all"} onValueChange={(v) => setFilter({ category: v })}>
          <SelectTrigger className="h-9 text-xs">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {CATEGORIES.map((c) => (
              <SelectItem key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {current.q || current.status || current.storage || current.valuable || current.category ? (
        <Button variant="ghost" size="sm" onClick={() => router.push("/entries")}>
          <X className="size-3.5" /> Clear filters
        </Button>
      ) : null}
    </div>
  );
}
