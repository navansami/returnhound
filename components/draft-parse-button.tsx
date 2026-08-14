"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { parseDraft } from "@/server/drafts";
import { Button } from "@/components/ui/button";

/** Run OCR on the draft's form photo, then let the server re-render the form pre-filled. */
export function ParseFormButton({ draftId }: { draftId: string }) {
  const router = useRouter();
  const [parsing, setParsing] = useState(false);

  async function handleParse() {
    setParsing(true);
    const res = await parseDraft(draftId);
    setParsing(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success("Form parsed — review the pre-filled fields");
    router.refresh();
  }

  return (
    <Button type="button" variant="secondary" onClick={handleParse} disabled={parsing}>
      {parsing ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
      {parsing ? "Parsing…" : "Parse form"}
    </Button>
  );
}
