import { eq } from "drizzle-orm";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ReportRulesForm } from "@/components/report-rules-form";
import { db, schema } from "@/lib/db";
import { getReportRules } from "@/lib/reports";
import { requireRole } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  await requireRole("admin");

  const [counter] = await db.select().from(schema.setting).where(eq(schema.setting.key, "rs_counter")).limit(1);
  const nextNumber = counter ? Number((counter.value as { next?: number }).next ?? "—") : "Not started";
  const rules = await getReportRules();

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground">System configuration for admins.</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">RS number counter</CardTitle>
          <CardDescription>Next reference to be issued to a new entry.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="font-mono text-2xl font-semibold">
            RS{typeof nextNumber === "number" ? String(nextNumber).padStart(4, "0") : "——"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">The counter is managed automatically.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Daily email report</CardTitle>
          <CardDescription>
            Sent each morning by the Vercel cron. Covers held items, items due for Dubai Police, and food/alcohol past
            their window.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ReportRulesForm initial={rules} />
        </CardContent>
      </Card>
    </div>
  );
}
