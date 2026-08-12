"use client";

import { useRef, useState } from "react";
import { Camera, Loader2, X } from "lucide-react";
import { toast } from "sonner";

import { uploadImageToCloudinary } from "@/lib/upload-client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type UploadedImage = { url: string; publicId: string } | null;

/**
 * Single image upload straight to Cloudinary from the browser (signed by the
 * server so bytes never pass through Vercel). `capture` uses the phone camera
 * when available.
 */
export function ImageUpload({
  value,
  onChange,
  folder,
  label = "Add photo",
  capture,
  className,
}: {
  value: UploadedImage;
  onChange: (value: UploadedImage) => void;
  folder: string;
  label?: string;
  capture?: "environment" | "user";
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    try {
      const result = await uploadImageToCloudinary(file, folder);
      onChange({ url: result.url, publicId: result.publicId });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Image upload failed");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className={cn("flex items-start gap-3", className)}>
      <div className="relative size-24 shrink-0 overflow-hidden rounded-lg border bg-muted">
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value.url} alt="" className="size-full object-cover" />
        ) : uploading ? (
          <div className="grid size-full place-items-center">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="grid size-full place-items-center text-muted-foreground">
            <Camera className="size-6" />
          </div>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture={capture}
        className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
      <div className="flex flex-col gap-1.5">
        <Button type="button" variant="outline" size="sm" disabled={uploading} onClick={() => inputRef.current?.click()}>
          {uploading ? <Loader2 className="size-3.5 animate-spin" /> : <Camera className="size-3.5" />}
          {value ? "Replace" : label}
        </Button>
        {value ? (
          <Button type="button" variant="ghost" size="sm" className="text-destructive" onClick={() => onChange(null)}>
            <X className="size-3.5" /> Remove
          </Button>
        ) : null}
      </div>
    </div>
  );
}
