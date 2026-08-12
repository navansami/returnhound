"use client";

import { useState } from "react";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";

import { triggerReportNow } from "@/server/reports";
import { Button } from "@/components/ui/button";

export function SendReportButton({ recipients }: { recipients: string[] }) {
  const [sending, setSending] = useState(false);

  async function handleSend() {
    setSending(true);
    const res = await triggerReportNow();
    setSending(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success(`Report sent to ${res.sentTo.join(", ") || "no one"}`);
  }

  return (
    <Button onClick={handleSend} disabled={sending || recipients.length === 0}>
      {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
      Send by email now
    </Button>
  );
}
