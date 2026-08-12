"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Paperclip } from "lucide-react";
import { toast } from "sonner";

import { createDraft } from "@/server/drafts";
import { ImageUpload, type UploadedImage } from "@/components/image-upload";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/** Upload a paper-form photo → create a pending draft. */
export function DraftUpload() {
  const router = useRouter();
  const [image, setImage] = useState<UploadedImage>(null);
  const [creating, setCreating] = useState(false);

  async function handleCreate() {
    if (!image) return;
    setCreating(true);
    const res = await createDraft({ formImageUrl: image.url, formImagePublicId: image.publicId });
    setCreating(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success("Draft created — fill it in to log the entry");
    setImage(null);
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">New draft</CardTitle>
        <CardDescription>Photograph a paper RS form. You’ll fill in the details on the next step.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-4">
        <ImageUpload value={image} onChange={setImage} folder="drafts" capture="environment" label="Take form photo" />
        <Button onClick={handleCreate} disabled={!image || creating}>
          {creating ? <Loader2 className="size-4 animate-spin" /> : <Paperclip className="size-4" />}
          Create draft
        </Button>
      </CardContent>
    </Card>
  );
}
