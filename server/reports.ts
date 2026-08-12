"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db, schema } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { sendEmail } from "@/lib/email";
import { gatherReportData, getReportRules, renderReportHtml } from "@/lib/reports";
import { canManageSettings, canRunReports, type Role } from "@/lib/rbac";
import { requireUser } from "@/lib/session";
import { format } from "date-fns";

export type ReportResult = { ok: true; sentTo: string[] } | { ok: false; error: string };

const rulesSchema = z.object({
  recipients: z.array(z.string().email("Invalid email address").trim()),
  policeAfterDays: z.number().int().min(1, "At least 1 day").max(365),
  foodExpiryHours: z.number().int().min(1, "At least 1 hour").max(336),
  dailyEnabled: z.boolean(),
});

/** Build + send the daily report using the configured rules. Shared by cron + manual trigger. */
export async function runDailyReport(): Promise<ReportResult> {
  const rules = await getReportRules();
  if (!rules.dailyEnabled) return { ok: true, sentTo: [] };
  if (rules.recipients.length === 0) return { ok: false, error: "No report recipients are configured." };

  const data = await gatherReportData();
  const html = renderReportHtml(data);
  const res = await sendEmail({
    to: rules.recipients,
    subject: `Lost & Found report — ${format(data.generatedAt, "EEEE d MMM yyyy")}`,
    html,
  });
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, sentTo: rules.recipients };
}

/** Manual "send now" from the Reports page (admins + editors). */
export async function triggerReportNow(): Promise<ReportResult> {
  const session = await requireUser();
  const role = session.user.role as Role;
  if (!canRunReports(role)) return { ok: false, error: "You don't have permission to run reports." };
  return runDailyReport();
}

/** Save report rules (admins only). `recipients` arrives as a comma-separated string. */
export async function updateReportRules(raw: unknown): Promise<ReportResult> {
  const session = await requireUser();
  const role = session.user.role as Role;
  if (!canManageSettings(role)) return { ok: false, error: "Only admins can change report rules." };

  const { recipients, policeAfterDays, foodExpiryHours, dailyEnabled } = (raw ?? {}) as {
    recipients?: string;
    policeAfterDays?: number;
    foodExpiryHours?: number;
    dailyEnabled?: boolean;
  };

  const parsed = rulesSchema.safeParse({
    recipients: String(recipients ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    policeAfterDays: Number(policeAfterDays),
    foodExpiryHours: Number(foodExpiryHours),
    dailyEnabled: Boolean(dailyEnabled),
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: issue?.message ?? "Invalid report rules." };
  }

  try {
    const value = parsed.data;
    await db
      .insert(schema.setting)
      .values({ key: "report_rules", value, updatedById: session.user.id })
      .onConflictDoUpdate({ target: schema.setting.key, set: { value, updatedById: session.user.id, updatedAt: new Date() } });
    await writeAudit({
      entityType: "setting",
      entityId: "report_rules",
      action: "update",
      userId: session.user.id,
      before: undefined,
      after: value,
    });
    revalidatePath("/settings");
    revalidatePath("/reports");
    return { ok: true, sentTo: value.recipients };
  } catch {
    return { ok: false, error: "Failed to save the report rules." };
  }
}
