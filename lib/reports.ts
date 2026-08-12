import { and, asc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { format } from "date-fns";

import { db, schema } from "@/lib/db";
import { STORAGE_LABELS } from "@/lib/labels";
import { STORAGE_LOCATIONS } from "@/lib/validators";

type StorageLocation = (typeof STORAGE_LOCATIONS)[number];

export type ReportRules = {
  recipients: string[];
  policeAfterDays: number;
  foodExpiryHours: number;
  dailyEnabled: boolean;
};

const DEFAULT_RULES: ReportRules = { recipients: [], policeAfterDays: 30, foodExpiryHours: 24, dailyEnabled: true };

/* -------------------------------- Settings -------------------------------- */

export async function getReportRules(): Promise<ReportRules> {
  const [row] = await db.select().from(schema.setting).where(eq(schema.setting.key, "report_rules")).limit(1);
  const v = (row?.value ?? {}) as Partial<ReportRules>;
  return {
    recipients: Array.isArray(v.recipients) ? v.recipients.map(String).filter(Boolean) : [],
    policeAfterDays: typeof v.policeAfterDays === "number" ? v.policeAfterDays : DEFAULT_RULES.policeAfterDays,
    foodExpiryHours: typeof v.foodExpiryHours === "number" ? v.foodExpiryHours : DEFAULT_RULES.foodExpiryHours,
    dailyEnabled: v.dailyEnabled !== false,
  };
}

/* --------------------------------- Queries -------------------------------- */

export type HeldItem = {
  itemId: string;
  itemName: string;
  category: string;
  entryId: string;
  rsNumber: string;
  foundAt: Date;
  foundLocation: string;
  storageLocation: StorageLocation;
  isValuable: boolean;
};

const HELD_COLUMNS = {
  itemId: schema.item.id,
  itemName: schema.item.name,
  category: schema.item.category,
  entryId: schema.entry.id,
  rsNumber: schema.entry.rsNumber,
  foundAt: schema.entry.foundAt,
  foundLocation: schema.entry.foundLocation,
  storageLocation: schema.entry.storageLocation,
  isValuable: schema.entry.isValuable,
};

/** Every item still held (status = logged). */
export async function heldItems(): Promise<HeldItem[]> {
  return db
    .select(HELD_COLUMNS)
    .from(schema.item)
    .innerJoin(schema.entry, eq(schema.item.entryId, schema.entry.id))
    .where(eq(schema.item.status, "logged"))
    .orderBy(asc(schema.entry.foundAt));
}

/** Items still held whose entry was found before `cutoff` → due for Dubai Police. */
export async function dueForPolice(cutoff: Date): Promise<HeldItem[]> {
  return db
    .select(HELD_COLUMNS)
    .from(schema.item)
    .innerJoin(schema.entry, eq(schema.item.entryId, schema.entry.id))
    .where(and(eq(schema.item.status, "logged"), lt(schema.entry.foundAt, cutoff)))
    .orderBy(asc(schema.entry.foundAt));
}

/** Food/alcohol still held past their 24-hour window. */
export async function expiringFoodAlcohol(cutoff: Date): Promise<HeldItem[]> {
  return db
    .select(HELD_COLUMNS)
    .from(schema.item)
    .innerJoin(schema.entry, eq(schema.item.entryId, schema.entry.id))
    .where(
      and(
        eq(schema.item.status, "logged"),
        lt(schema.entry.foundAt, cutoff),
        inArray(schema.item.category, ["food", "alcohol"]),
      ),
    )
    .orderBy(asc(schema.entry.foundAt));
}

/** Entries logged and items collected in the last 24 hours. */
export async function recentActivity(since: Date): Promise<{ newEntries: number; collected: number }> {
  const [newRows] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.entry)
    .where(gte(schema.entry.createdAt, since));
  const [collectRows] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.collection)
    .where(gte(schema.collection.collectedAt, since));
  return { newEntries: Number(newRows?.count ?? 0), collected: Number(collectRows?.count ?? 0) };
}

/* ------------------------------ Report bundle ----------------------------- */

export type ReportData = {
  generatedAt: Date;
  recipients: string[];
  policeAfterDays: number;
  foodExpiryHours: number;
  heldCount: number;
  heldByStorage: { storageLocation: StorageLocation; count: number }[];
  due: HeldItem[];
  expiring: HeldItem[];
  newEntryCount: number;
  collectedCount: number;
};

export async function gatherReportData(): Promise<ReportData> {
  const rules = await getReportRules();
  const now = Date.now();
  const policeCutoff = new Date(now - rules.policeAfterDays * 24 * 3600 * 1000);
  const foodCutoff = new Date(now - rules.foodExpiryHours * 3600 * 1000);
  const dayAgo = new Date(now - 24 * 3600 * 1000);

  const [held, due, expiring, activity] = await Promise.all([
    heldItems(),
    dueForPolice(policeCutoff),
    expiringFoodAlcohol(foodCutoff),
    recentActivity(dayAgo),
  ]);

  const heldByStorage = STORAGE_LOCATIONS.map((s) => ({
    storageLocation: s,
    count: held.filter((h) => h.storageLocation === s).length,
  })).filter((s) => s.count > 0);

  return {
    generatedAt: new Date(now),
    recipients: rules.recipients,
    policeAfterDays: rules.policeAfterDays,
    foodExpiryHours: rules.foodExpiryHours,
    heldCount: held.length,
    heldByStorage,
    due,
    expiring,
    newEntryCount: activity.newEntries,
    collectedCount: activity.collected,
  };
}

/* -------------------------------- HTML email ------------------------------ */

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function daysHeld(foundAt: Date): number {
  return Math.max(0, Math.floor((Date.now() - foundAt.getTime()) / 86_400_000));
}

function itemRows(items: HeldItem[]): string {
  if (items.length === 0) return '<tr><td colspan="4" style="padding:10px 12px;color:#888">None.</td></tr>';
  return items
    .map(
      (i) => `<tr>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;font-family:monospace">${i.rsNumber}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee">${escapeHtml(i.itemName)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee">${escapeHtml(i.foundLocation)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee">${format(i.foundAt, "dd MMM yyyy")} · ${daysHeld(i.foundAt)}d</td>
      </tr>`,
    )
    .join("");
}

export function renderReportHtml(data: ReportData): string {
  const storageRows = data.heldByStorage
    .map(
      (s) => `<tr>
        <td style="padding:6px 12px;border-bottom:1px solid #f0f0f0">${STORAGE_LABELS[s.storageLocation]}</td>
        <td style="padding:6px 12px;border-bottom:1px solid #f0f0f0;text-align:right">${s.count}</td>
      </tr>`,
    )
    .join("");

  return `<!doctype html>
<html>
<body style="margin:0;padding:24px;background:#f6f6f4;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1c1c1e">
  <div style="max-width:640px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden">
    <div style="background:#7c5cff;color:#fff;padding:20px 24px">
      <div style="font-size:18px;font-weight:600">Lost &amp; Found — daily report</div>
      <div style="font-size:13px;opacity:.85">Fairmont The Palm · ${format(data.generatedAt, "EEEE d MMM yyyy, HH:mm")}</div>
    </div>
    <div style="padding:24px">
      <table role="presentation" style="width:100%;border-collapse:collapse;margin-bottom:24px">
        <tr>
          <td style="width:25%;text-align:center;padding:12px;background:#f8f7ff;border-radius:8px">
            <div style="font-size:24px;font-weight:700">${data.heldCount}</div>
            <div style="font-size:12px;color:#666">Items held</div>
          </td>
          <td style="width:25%;text-align:center;padding:12px;background:#f8f7ff;border-radius:8px">
            <div style="font-size:24px;font-weight:700">${data.newEntryCount}</div>
            <div style="font-size:12px;color:#666">New entries 24h</div>
          </td>
          <td style="width:25%;text-align:center;padding:12px;background:#f8f7ff;border-radius:8px">
            <div style="font-size:24px;font-weight:700">${data.collectedCount}</div>
            <div style="font-size:12px;color:#666">Collected 24h</div>
          </td>
          <td style="width:25%;text-align:center;padding:12px;background:#f8f7ff;border-radius:8px">
            <div style="font-size:24px;font-weight:700;color:${data.due.length ? "#d64545" : "#1c1c1e"}">${data.due.length}</div>
            <div style="font-size:12px;color:#666">Due for police</div>
          </td>
        </tr>
      </table>

      <h3 style="font-size:14px;margin:0 0 8px">Due for Dubai Police (&gt; ${data.policeAfterDays} days)</h3>
      <table role="presentation" style="width:100%;border-collapse:collapse;margin-bottom:24px;border:1px solid #eee;border-radius:8px;overflow:hidden">
        <tr style="background:#fafafa;font-size:12px;color:#555;text-transform:uppercase;letter-spacing:.04em">
          <th style="padding:8px 12px;text-align:left">RS</th>
          <th style="padding:8px 12px;text-align:left">Item</th>
          <th style="padding:8px 12px;text-align:left">Found at</th>
          <th style="padding:8px 12px;text-align:left">Found date</th>
        </tr>
        ${itemRows(data.due)}
      </table>

      <h3 style="font-size:14px;margin:0 0 8px">Food / alcohol past ${data.foodExpiryHours}-hour window</h3>
      <table role="presentation" style="width:100%;border-collapse:collapse;margin-bottom:24px;border:1px solid #eee;border-radius:8px;overflow:hidden">
        <tr style="background:#fafafa;font-size:12px;color:#555;text-transform:uppercase;letter-spacing:.04em">
          <th style="padding:8px 12px;text-align:left">RS</th>
          <th style="padding:8px 12px;text-align:left">Item</th>
          <th style="padding:8px 12px;text-align:left">Found at</th>
          <th style="padding:8px 12px;text-align:left">Found date</th>
        </tr>
        ${itemRows(data.expiring)}
      </table>

      <h3 style="font-size:14px;margin:0 0 8px">Where things are held</h3>
      <table role="presentation" style="width:100%;border-collapse:collapse;margin-bottom:24px;border:1px solid #eee;border-radius:8px;overflow:hidden">
        <tr style="background:#fafafa;font-size:12px;color:#555;text-transform:uppercase;letter-spacing:.04em">
          <th style="padding:8px 12px;text-align:left">Location</th>
          <th style="padding:8px 12px;text-align:right">Items</th>
        </tr>
        ${storageRows || '<tr><td colspan="2" style="padding:10px 12px;color:#888">None.</td></tr>'}
      </table>

      <p style="font-size:12px;color:#999;margin:0">
        Sent automatically by the Lost &amp; Found system. Recipients are configured in Settings → Reports.
      </p>
    </div>
  </div>
</body>
</html>`;
}
