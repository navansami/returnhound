"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";

import { updateReportRules } from "@/server/reports";
import type { ReportRules } from "@/lib/reports";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export function ReportRulesForm({ initial }: { initial: ReportRules }) {
  const router = useRouter();
  const [recipients, setRecipients] = useState(initial.recipients.join(", "));
  const [policeAfterDays, setPoliceAfterDays] = useState(String(initial.policeAfterDays));
  const [foodExpiryHours, setFoodExpiryHours] = useState(String(initial.foodExpiryHours));
  const [dailyEnabled, setDailyEnabled] = useState(initial.dailyEnabled);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    const res = await updateReportRules({
      recipients,
      policeAfterDays: Number(policeAfterDays),
      foodExpiryHours: Number(foodExpiryHours),
      dailyEnabled,
    });
    setSaving(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success("Report rules saved");
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="recipients">Email recipients</Label>
          <Input
            id="recipients"
            value={recipients}
            onChange={(e) => setRecipients(e.target.value)}
            placeholder="royalservice.office@fairmont.com, security@fairmont.com"
          />
          <p className="text-xs text-muted-foreground">Comma-separated addresses the daily report is sent to.</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="enabled">Send the daily report</Label>
          <div className="flex items-center gap-2 pt-1.5">
            <Switch id="enabled" checked={dailyEnabled} onCheckedChange={setDailyEnabled} />
            <span className="text-sm text-muted-foreground">{dailyEnabled ? "Enabled" : "Paused"}</span>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="police">Hand to police after (days)</Label>
          <Input
            id="police"
            type="number"
            min={1}
            max={365}
            value={policeAfterDays}
            onChange={(e) => setPoliceAfterDays(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">Unclaimed items are flagged for Dubai Police after this.</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="food">Food / alcohol window (hours)</Label>
          <Input
            id="food"
            type="number"
            min={1}
            max={336}
            value={foodExpiryHours}
            onChange={(e) => setFoodExpiryHours(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">Food and alcohol are held for this long, then disposed of.</p>
        </div>
      </div>
      <Button onClick={handleSave} disabled={saving}>
        {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
        Save report rules
      </Button>
    </div>
  );
}
