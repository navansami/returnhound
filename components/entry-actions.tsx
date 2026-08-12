"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { deleteEntry } from "@/server/entries";
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

export function EntryActions({
  entryId,
  canEdit,
  canDelete,
}: {
  entryId: string;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    setDeleting(true);
    const result = await deleteEntry(entryId);
    if (!result.ok) {
      toast.error(result.error);
      setDeleting(false);
      return;
    }
    toast.success("Entry deleted");
    router.push("/entries");
    router.refresh();
  }

  return (
    <div className="flex items-center gap-2">
      {canEdit ? (
        <Button asChild variant="outline" size="sm">
          <Link href={`/entries/${entryId}/edit`}>
            <Pencil className="size-3.5" /> Edit
          </Link>
        </Button>
      ) : null}
      {canDelete ? (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" size="sm">
              <Trash2 className="size-3.5" /> Delete
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this entry?</AlertDialogTitle>
              <AlertDialogDescription>
                This permanently removes the entry and all of its items and history. This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleDelete} disabled={deleting}>
                {deleting ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </div>
  );
}
