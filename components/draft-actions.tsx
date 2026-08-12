"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, X } from "lucide-react";
import { toast } from "sonner";

import { rejectDraft } from "@/server/drafts";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export function RejectDraftButton({ draftId }: { draftId: string }) {
  const router = useRouter();
  const [rejecting, setRejecting] = useState(false);

  async function handleReject() {
    setRejecting(true);
    const res = await rejectDraft(draftId);
    setRejecting(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success("Draft rejected");
    router.push("/drafts");
    router.refresh();
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="outline">
          <X className="size-4" /> Reject draft
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Reject this draft?</AlertDialogTitle>
          <AlertDialogDescription>It won’t be logged as an entry. You can’t undo this.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={handleReject} disabled={rejecting} className="bg-destructive hover:bg-destructive/90">
            {rejecting ? <Loader2 className="size-4 animate-spin" /> : null}
            Reject
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
