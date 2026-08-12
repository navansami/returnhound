"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import Papa from "papaparse";
import { Check, ChevronLeft, FileUp, Info, Loader2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { existingRsNumbers, importEntries } from "@/server/imports";
import { CATEGORY_LABELS, ENTRY_STATUS_LABELS, STORAGE_LABELS } from "@/lib/labels";
import { CATEGORIES, ITEM_STATUSES, STORAGE_LOCATIONS } from "@/lib/validators";
import { computeEntryStatus } from "@/lib/status";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type StorageLocation = (typeof STORAGE_LOCATIONS)[number];
type ItemCategory = (typeof CATEGORIES)[number];
type ItemStatus = (typeof ITEM_STATUSES)[number];

const FIELDS = [
  { key: "rsNumber", label: "RS number", hint: "Optional — blank rows get a new number", required: false },
  { key: "foundAt", label: "Found date", hint: "Required", required: true },
  { key: "foundTime", label: "Found time (separate column)", hint: "Optional", required: false },
  { key: "foundLocation", label: "Found location", hint: "Required", required: true },
  { key: "finderName", label: "Finder name", hint: "Required", required: true },
  { key: "finderDepartment", label: "Finder department", hint: "Optional", required: false },
  { key: "finderEmployeeId", label: "Finder employee ID", hint: "Optional", required: false },
  { key: "agentName", label: "Agent name", hint: "Optional", required: false },
  { key: "itemName", label: "Item name", hint: "Required — one row per item", required: true },
  { key: "itemDescription", label: "Item description", hint: "Optional", required: false },
  { key: "itemCategory", label: "Item category", hint: "Optional — fuzzy-matched", required: false },
  { key: "itemStatus", label: "Item status", hint: "Optional — e.g. Logged / Collected", required: false },
  { key: "storageLocation", label: "Storage location", hint: "Optional — defaults to Lost & Found store", required: false },
  { key: "isValuable", label: "Valuable?", hint: "Optional — yes/no", required: false },
  { key: "comments", label: "Comments", hint: "Optional", required: false },
] as const;

type FieldKey = (typeof FIELDS)[number]["key"];
type Mapping = Partial<Record<FieldKey, string>>;
type DateFormat = "auto" | "ddmmyyyy" | "mmddyyyy" | "iso" | "serial";

type PreviewItem = { name: string; description: string | null; category: ItemCategory; status: ItemStatus };
type PreviewEntry = {
  rsNumber: string | null;
  foundAt: Date;
  foundLocation: string;
  finderName: string;
  finderDepartment: string | null;
  finderEmployeeId: string | null;
  agentName: string | null;
  storageLocation: StorageLocation;
  isValuable: boolean;
  comments: string | null;
  items: PreviewItem[];
  problems: string[];
  excluded?: boolean;
};
type PreviewResult = { entries: PreviewEntry[]; skippedRows: number; problems: string[] };

const DATE_FORMATS: { value: DateFormat; label: string }[] = [
  { value: "auto", label: "Auto (DD/MM/YYYY preferred)" },
  { value: "ddmmyyyy", label: "Day/Month/Year (14/05/2024)" },
  { value: "mmddyyyy", label: "Month/Day/Year (05/14/2024)" },
  { value: "iso", label: "ISO (2024-05-14)" },
  { value: "serial", label: "Excel serial number" },
];

/* ------------------------------ Cell helpers ------------------------------ */

function cell(row: Record<string, unknown>, col?: string): string {
  const v = col ? (row[col] ?? "") : "";
  return String(v).trim();
}
function nullish(v: string): string | null {
  return v ? v : null;
}

/* ------------------------------- Auto-mapping ----------------------------- */

const FIELD_PATTERNS: Record<FieldKey, RegExp[]> = {
  rsNumber: [/^rs$/, /^rs[._ -]?(no|number|#)$/, /reference/],
  foundAt: [/found.*(date|time|dt)/, /datetime/, /date found/, /^date/, /date/],
  foundTime: [/^time$/, /^time /],
  foundLocation: [/found.*(location|where|place|area)/, /location/, /where found/, /^area$/, /^place$/],
  finderName: [/finder/, /found by/, /guest name/, /reported by/, /^name$/],
  finderDepartment: [/dept/, /department/],
  finderEmployeeId: [/employee/, /staff id/, /staff no/, /finder.*id/],
  agentName: [/agent/, /logged by/, /received by/, /officer/],
  itemName: [/item/, /article/, /object/, /property/, /^description/],
  itemDescription: [/description/, /details/, /additional/],
  itemCategory: [/category/, /type/],
  itemStatus: [/status/, /state/],
  storageLocation: [/storage/, /^stored/, /kept at/],
  isValuable: [/valuable/, /high value/],
  comments: [/comment/, /^notes?$/, /remarks/],
};

function normalizeHeader(s: string): string {
  return String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

function autoMap(columns: string[]): Mapping {
  const mapping: Mapping = {};
  const used = new Set<string>();
  for (const field of FIELDS) {
    for (const col of columns) {
      if (used.has(col)) continue;
      const n = normalizeHeader(col);
      if (FIELD_PATTERNS[field.key].some((re) => re.test(n))) {
        mapping[field.key] = col;
        used.add(col);
        break;
      }
    }
  }
  return mapping;
}

/* -------------------------------- Date parse ------------------------------ */

function applyTime(date: Date, timeStr: string): Date {
  if (!timeStr) return date;
  const m = timeStr.match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?\s*(AM|PM)?/i);
  if (!m) return date;
  const hh = +m[1];
  const mm = +m[2];
  const ss = +(m[3] ?? 0);
  let h = hh;
  if (m[4]) {
    if (/pm/i.test(m[4]) && h < 12) h += 12;
    if (/am/i.test(m[4]) && h === 12) h = 0;
  }
  const out = new Date(date);
  out.setHours(h, mm, ss, 0);
  return out;
}

function parseDateTime(dateStr: string, timeStr: string, format: DateFormat): Date | null {
  const d = dateStr.trim();
  const t = timeStr.trim();
  if (!d) return null;

  if (format === "serial") {
    const n = Number(d);
    if (!Number.isFinite(n) || n <= 0) return null;
    const base = new Date(Date.UTC(1899, 11, 30));
    base.setUTCDate(base.getUTCDate() + Math.floor(n));
    return applyTime(base, t);
  }

  if (format === "iso" || format === "auto") {
    const iso = new Date(d);
    if (!Number.isNaN(iso.getTime())) return applyTime(iso, t);
    const m = d.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?(?:\s*(AM|PM))?)?/i);
    if (m) {
      const [, y, mo, day, hh, mm, ss, ap] = m;
      const dt = makeDate(+y, +mo, +day, +hh, +mm, +ss, ap);
      return applyTime(dt, t);
    }
  }

  const m = d.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})(?:[T ](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?(?:\s*(AM|PM))?)?/i);
  if (m) {
    const [, a, b, c, hh, mm, ss, ap] = m;
    let day = +a;
    let month = +b;
    let year = +c;
    if (format === "mmddyyyy") {
      month = +a;
      day = +b;
    } else if (format === "ddmmyyyy") {
      day = +a;
      month = +b;
    } else {
      // auto: disambiguate; default to Day/Month (Dubai convention)
      if (+a > 12 && +b <= 12) {
        day = +a;
        month = +b;
      } else if (+b > 12 && +a <= 12) {
        month = +a;
        day = +b;
      } else {
        day = +a;
        month = +b;
      }
    }
    if (year < 100) year += 2000;
    const dt = makeDate(year, month, day, +hh, +mm, +ss, ap);
    return Number.isNaN(dt.getTime()) ? null : applyTime(dt, t);
  }

  const last = new Date(d);
  return Number.isNaN(last.getTime()) ? null : applyTime(last, t);
}

function makeDate(y: number, mo: number, d: number, hh = 0, mm = 0, ss = 0, ap?: string): Date {
  let h = hh;
  if (ap) {
    if (/pm/i.test(ap) && h < 12) h += 12;
    if (/am/i.test(ap) && h === 12) h = 0;
  }
  return new Date(y, mo - 1, d, h, mm, ss);
}

/* ------------------------------ Enum matching ----------------------------- */

function matchEnum<T extends string>(
  value: string,
  options: readonly T[],
  labels: Record<T, string>,
  fallback: T,
): T {
  const v = value.trim().toLowerCase();
  if (!v) return fallback;
  for (const opt of options) {
    if (v === opt) return opt;
    if (v === labels[opt].toLowerCase()) return opt;
    if (v.includes(opt.replaceAll("_", " ")) || opt.replaceAll("_", " ").includes(v)) return opt;
  }
  return fallback;
}

function matchItemStatus(value: string): ItemStatus {
  const v = value.trim().toLowerCase();
  if (!v) return "logged";
  if (/handed|police/.test(v)) return "handed_to_police";
  if (/discard/.test(v)) return "discarded";
  if (/collect|claim|returned/.test(v)) return "collected";
  // "enquired", "partial", "pending" all roll back up to logged
  return "logged";
}

function parseBool(value: string): boolean {
  const v = value.trim().toLowerCase();
  return ["yes", "y", "true", "1", "x", "✓", "valuable", "security"].includes(v);
}

function normalizeRs(value: string): string {
  const v = value.trim();
  const m = v.match(/^rs\s*0*(\d+)$/i);
  return m ? `RS${m[1].padStart(4, "0")}` : v.toUpperCase();
}

/* ------------------------------ Build preview ----------------------------- */

function makeEntry(row: Record<string, unknown>, mapping: Mapping, format: DateFormat): PreviewEntry | null {
  const foundAt = parseDateTime(cell(row, mapping.foundAt), cell(row, mapping.foundTime), format);
  if (!foundAt) return null; // unparseable date → row skipped

  const storageLocation = matchEnum(
    cell(row, mapping.storageLocation),
    STORAGE_LOCATIONS,
    STORAGE_LABELS,
    "lost_found_store",
  );
  const isValuable = storageLocation === "security" || parseBool(cell(row, mapping.isValuable));

  const problems: string[] = [];
  const foundLocation = cell(row, mapping.foundLocation);
  const finderName = cell(row, mapping.finderName);
  if (!foundLocation) problems.push("Blank found location — importing as “Unknown”");
  if (!finderName) problems.push("Blank finder name — importing as “Unknown”");

  return {
    rsNumber: mapping.rsNumber ? normalizeRs(cell(row, mapping.rsNumber)) || null : null,
    foundAt,
    foundLocation: foundLocation || "Unknown",
    finderName: finderName || "Unknown",
    finderDepartment: nullish(cell(row, mapping.finderDepartment)),
    finderEmployeeId: nullish(cell(row, mapping.finderEmployeeId)),
    agentName: nullish(cell(row, mapping.agentName)),
    storageLocation,
    isValuable,
    comments: nullish(cell(row, mapping.comments)),
    items: [],
    problems,
  };
}

function sameEntryDetails(a: PreviewEntry, b: { foundAt: Date; foundLocation: string; finderName: string }): boolean {
  return (
    a.foundLocation === b.foundLocation &&
    a.finderName === b.finderName &&
    +a.foundAt === +b.foundAt
  );
}

function buildPreview(rawRows: Record<string, unknown>[], mapping: Mapping, format: DateFormat): PreviewResult {
  const problems: string[] = [];
  let skippedRows = 0;
  const byKey = new Map<string, PreviewEntry>();

  for (const row of rawRows) {
    const itemName = cell(row, mapping.itemName);
    if (!itemName) {
      skippedRows++;
      continue;
    }

    const rs = mapping.rsNumber ? normalizeRs(cell(row, mapping.rsNumber)) : "";
    const key = rs || `__row_${byKey.size}`;
    let entry = byKey.get(key);

    if (!entry) {
      const made = makeEntry(row, mapping, format);
      if (!made) {
        skippedRows++; // unparseable date
        continue;
      }
      byKey.set(key, made);
      entry = made;
    }

    if (entry.items.length < 20) {
      entry.items.push({
        name: itemName,
        description: nullish(cell(row, mapping.itemDescription)),
        category: matchEnum(cell(row, mapping.itemCategory), CATEGORIES, CATEGORY_LABELS, "general"),
        status: matchItemStatus(cell(row, mapping.itemStatus)),
      });
    } else if (entry.problems.indexOf("More than 20 items — importing the first 20") === -1) {
      entry.problems.push("More than 20 items — importing the first 20");
    }

    // Different entry-level details under the same RS number is a data problem.
    if (rs) {
      const rowDate = parseDateTime(cell(row, mapping.foundAt), cell(row, mapping.foundTime), format);
      const probe = {
        foundLocation: cell(row, mapping.foundLocation),
        finderName: cell(row, mapping.finderName),
        foundAt: rowDate ?? entry.foundAt,
      };
      if (!sameEntryDetails(entry, probe)) {
        entry.problems.push(`RS ${rs} appears with different details in another row — using the first row's`);
      }
    }
  }

  const entries: PreviewEntry[] = [];
  for (const entry of byKey.values()) {
    if (entry.items.length === 0) {
      problems.push(`Skipped an entry with no importable items (${entry.rsNumber ?? "unnumbered row"}).`);
      continue;
    }
    entries.push(entry);
  }

  return { entries, skippedRows, problems };
}

/* --------------------------------- Component ------------------------------ */

export function ImportTool() {
  const [step, setStep] = useState<"file" | "map" | "review" | "done">("file");
  const [fileName, setFileName] = useState("");
  const [rawRows, setRawRows] = useState<Record<string, unknown>[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [hasHeader, setHasHeader] = useState(true);
  const [mapping, setMapping] = useState<Mapping>({});
  const [dateFormat, setDateFormat] = useState<DateFormat>("auto");
  const [startRsAt, setStartRsAt] = useState("");
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ imported: number; itemCount: number } | null>(null);

  const missingRequired = FIELDS.filter((f) => f.required && !mapping[f.key]).map((f) => f.label);

  const importable = useMemo(() => preview?.entries.filter((e) => !e.excluded) ?? [], [preview]);
  const totalItems = useMemo(() => importable.reduce((n, e) => n + e.items.length, 0), [importable]);

  function handleFile(file: File) {
    if (file.size > 10 * 1024 * 1024) {
      toast.error("That file is over 10 MB — please split it.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "").replace(/^﻿/, "");
      const parsed = Papa.parse<unknown>(text, {
        header: hasHeader,
        skipEmptyLines: true,
        transformHeader: (h) => h.trim(),
      });
      if (parsed.errors.length > 0) {
        toast.error(`Couldn't read the CSV: ${parsed.errors[0].message}`);
        return;
      }
      let rows: Record<string, unknown>[];
      let cols: string[];
      if (hasHeader) {
        rows = parsed.data as Record<string, unknown>[];
        cols = Object.keys(rows[0] ?? {});
      } else {
        const arrays = parsed.data as unknown[][];
        const width = arrays.reduce((w, r) => Math.max(w, r.length), 0);
        cols = Array.from({ length: width }, (_, i) => `Column ${i + 1}`);
        rows = arrays.map((r) => {
          const obj: Record<string, unknown> = {};
          r.forEach((v, i) => (obj[cols[i]] = v));
          return obj;
        });
      }
      if (rows.length === 0) {
        toast.error("No data rows found in that file.");
        return;
      }
      setFileName(file.name);
      setRawRows(rows);
      setColumns(cols);
      setMapping(autoMap(cols));
      setStep("map");
    };
    reader.readAsText(file);
  }

  async function review() {
    const built = buildPreview(rawRows, mapping, dateFormat);
    setChecking(true);
    try {
      const fixed = built.entries.filter((e) => e.rsNumber).map((e) => e.rsNumber!);
      const existing = await existingRsNumbers(fixed);
      const existingSet = new Set(existing);
      for (const e of built.entries) {
        if (e.rsNumber && existingSet.has(e.rsNumber)) {
          e.excluded = true;
          e.problems.push(`${e.rsNumber} already exists in the database — skipped`);
        }
      }
      built.problems.push(
        ...built.entries
          .filter((e) => e.excluded)
          .map((e) => `${e.rsNumber} already exists in the database — skipped`),
      );
    } catch {
      toast.error("Couldn't check RS numbers against the database.");
    } finally {
      setChecking(false);
      setPreview(built);
      setStep("review");
    }
  }

  function reset() {
    setStep("file");
    setFileName("");
    setRawRows([]);
    setColumns([]);
    setMapping({});
    setDateFormat("auto");
    setStartRsAt("");
    setPreview(null);
    setResult(null);
  }

  async function commit() {
    setImporting(true);
    const res = await importEntries({
      sourceFile: fileName || "import.csv",
      startRsAt: startRsAt ? Number(startRsAt) || null : null,
      entries: importable.map((e) => ({
        rsNumber: e.rsNumber,
        foundAt: e.foundAt.toISOString(),
        foundLocation: e.foundLocation,
        finderName: e.finderName,
        finderDepartment: e.finderDepartment,
        finderEmployeeId: e.finderEmployeeId,
        agentName: e.agentName,
        storageLocation: e.storageLocation,
        isValuable: e.isValuable,
        comments: e.comments,
        items: e.items,
      })),
    });
    setImporting(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    setResult({ imported: res.imported, itemCount: res.itemCount });
    setStep("done");
  }

  const problemCount = (preview?.problems.length ?? 0) + (preview?.entries.reduce((n, e) => n + e.problems.length, 0) ?? 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Import from Excel</h1>
        <p className="text-sm text-muted-foreground">
          Move your existing Lost &amp; Found log into the system. Export the sheet as CSV, then map its columns.
          Rows sharing an RS number are grouped into one entry with multiple items.
        </p>
      </div>

      {/* 1 · File */}
      {step === "file" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">1 · Choose your CSV</CardTitle>
            <CardDescription>
              In Excel: File → Save As → CSV (.csv). Each row becomes an item; rows with the same RS number become items of one entry.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2">
              <Checkbox id="hasHeader" checked={hasHeader} onCheckedChange={(v) => setHasHeader(v === true)} />
              <Label htmlFor="hasHeader">The file has a header row</Label>
            </div>
            <Input type="file" accept=".csv,text/csv" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
          </CardContent>
        </Card>
      )}

      {/* 2 · Map */}
      {step === "map" && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">2 · Map your columns</CardTitle>
              <CardDescription>
                {fileName} — {rawRows.length} data rows. The columns were matched automatically; adjust anything wrong.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-4 md:grid-cols-2">
                {FIELDS.map((field) => (
                  <div key={field.key} className="space-y-1.5">
                    <Label className="flex items-center gap-2">
                      {field.label}
                      {field.required ? (
                        <Badge variant="default" className="text-[10px]">required</Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px]">optional</Badge>
                      )}
                    </Label>
                    <Select
                      value={mapping[field.key] ?? "__none"}
                      onValueChange={(v) => setMapping((m) => ({ ...m, [field.key]: v === "__none" ? undefined : v }))}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Choose a column" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none">— skip —</SelectItem>
                        {columns.map((c) => (
                          <SelectItem key={c} value={c}>
                            {c}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">{field.hint}</p>
                  </div>
                ))}
              </div>

              <Separator />

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Date format</Label>
                  <Select value={dateFormat} onValueChange={(v) => setDateFormat(v as DateFormat)}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DATE_FORMATS.map((f) => (
                        <SelectItem key={f.value} value={f.value}>
                          {f.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Continue numbering from</Label>
                  <Input
                    value={startRsAt}
                    onChange={(e) => setStartRsAt(e.target.value)}
                    placeholder="e.g. 143"
                    inputMode="numeric"
                  />
                  <p className="text-xs text-muted-foreground">
                    Used for rows without an RS number. The counter also advances past the highest RS in the file.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Preview of your file</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    {columns.slice(0, 6).map((c) => (
                      <TableHead key={c}>{c}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rawRows.slice(0, 5).map((r, i) => (
                    <TableRow key={i}>
                      {columns.slice(0, 6).map((c) => (
                        <TableCell key={c} className="max-w-40 truncate">{cell(r, c) || "—"}</TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <div className="flex items-center justify-between">
            <Button variant="ghost" onClick={reset}>
              <ChevronLeft className="size-4" /> Start over
            </Button>
            <Button onClick={review} disabled={missingRequired.length > 0 || checking}>
              {checking ? <Loader2 className="size-4 animate-spin" /> : <FileUp className="size-4" />}
              Review import
            </Button>
          </div>
          {missingRequired.length > 0 && (
            <Alert>
              <Info className="size-4" />
              <AlertTitle>Map the required fields first</AlertTitle>
              <AlertDescription>{missingRequired.join(", ")}.</AlertDescription>
            </Alert>
          )}
        </>
      )}

      {/* 3 · Review */}
      {step === "review" && preview && (
        <>
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">{importable.length} entries</Badge>
            <Badge variant="secondary">{totalItems} items</Badge>
            {preview.skippedRows > 0 && <Badge variant="outline">{preview.skippedRows} rows skipped</Badge>}
            {problemCount > 0 && <Badge variant="destructive">{problemCount} problems</Badge>}
          </div>

          {problemCount > 0 && (
            <Alert variant="destructive">
              <TriangleAlert className="size-4" />
              <AlertTitle>Check these before importing</AlertTitle>
              <AlertDescription>
                <ul className="list-inside list-disc space-y-0.5">
                  {[...preview.problems, ...preview.entries.flatMap((e) => e.problems)]
                    .slice(0, 8)
                    .map((p, i) => (
                      <li key={i}>{p}</li>
                    ))}
                  {problemCount > 8 && <li>…and {problemCount - 8} more.</li>}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Entries to import</CardTitle>
              <CardDescription>Showing the first 8 — {importable.length} in total.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>RS</TableHead>
                    <TableHead>Found</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Finder</TableHead>
                    <TableHead>Items</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Storage</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {importable.slice(0, 8).map((e, i) => {
                    const status = computeEntryStatus(e.items.map((it) => it.status), false);
                    return (
                      <TableRow key={i}>
                        <TableCell className="font-mono">{e.rsNumber ?? "New"}</TableCell>
                        <TableCell>{e.foundAt.toLocaleString()}</TableCell>
                        <TableCell className="max-w-40 truncate">{e.foundLocation}</TableCell>
                        <TableCell className="max-w-40 truncate">{e.finderName}</TableCell>
                        <TableCell>
                          {e.items.length}
                          {e.items.some((it) => it.status !== "logged") && (
                            <span className="ml-1 text-xs text-muted-foreground">({e.items.filter((it) => it.status !== "logged").length} carried over)</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">{ENTRY_STATUS_LABELS[status]}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={e.isValuable ? "default" : "outline"}>
                            {STORAGE_LABELS[e.storageLocation]}
                            {e.isValuable ? " · Valuable" : ""}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <div className="flex items-center justify-between">
            <Button variant="ghost" onClick={() => setStep("map")}>
              <ChevronLeft className="size-4" /> Back
            </Button>
            <Button onClick={commit} disabled={importing || importable.length === 0}>
              {importing ? <Loader2 className="size-4 animate-spin" /> : <FileUp className="size-4" />}
              Import {importable.length} {importable.length === 1 ? "entry" : "entries"}
            </Button>
          </div>
        </>
      )}

      {/* 4 · Done */}
      {step === "done" && result && (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-14 text-center">
            <span className="grid size-12 place-items-center rounded-full bg-emerald-500/10 text-emerald-600">
              <Check className="size-6" />
            </span>
            <h2 className="text-xl font-semibold">Import complete</h2>
            <p className="text-sm text-muted-foreground">
              {result.imported} entries · {result.itemCount} items imported from {fileName}. Check the audit log in the
              database for the record of this import.
            </p>
            <div className="mt-4 flex gap-3">
              <Button asChild variant="outline">
                <Link href="/entries">View entries</Link>
              </Button>
              <Button onClick={reset}>Import another file</Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
