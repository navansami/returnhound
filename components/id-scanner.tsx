"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, Loader2, RefreshCw, ScanLine } from "lucide-react";
import { toast } from "sonner";

import { parseMrzText, type ParsedId } from "@/lib/id-mrz";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

import type TesseractNS from "tesseract.js";

type TesseractWorker = TesseractNS.Worker;

/**
 * Lazily-created, session-cached Tesseract worker. OCR runs entirely in the
 * browser: the photo is recognized on-device (self-hosted WASM + language
 * model under /tesseract/) and discarded immediately — it is never uploaded
 * to Cloudinary, sent to Gemini, or routed through our server. Government IDs
 * must not leave the device (see CLAUDE.md / the ID-capture plan).
 */
let workerPromise: Promise<TesseractWorker> | null = null;

function getWorker(): Promise<TesseractWorker> {
  if (!workerPromise) {
    const Tesseract = import("tesseract.js").then((m) =>
      m.createWorker("eng", m.OEM.LSTM_ONLY, {
        workerPath: "/tesseract/worker.min.js",
        corePath: "/tesseract/", // resolves to one of the three -lstm.wasm.js cores
        langPath: "/tesseract/", // fetches /tesseract/eng.traineddata.gz
      }),
    );
    workerPromise = Tesseract;
  }
  return workerPromise;
}

/**
 * "Scan ID" control for the collection form. Captures the guest's passport or
 * Emirates ID with the phone camera, reads its Machine-Readable Zone locally,
 * and hands the parsed fields back to the caller via `onResult`. A read that
 * fails the ICAO check digits is rejected (toast → manual entry) rather than
 * silently recording a wrong government ID number.
 */
export function IdScanner({ onResult }: { onResult: (parsed: ParsedId) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [image, setImage] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Object URLs are local handles on the picked photo — revoke each one as it
  // is replaced or when the dialog closes, so the frame is truly discarded.
  useEffect(() => {
    if (!previewUrl) return;
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  function close() {
    setOpen(false);
    setImage(null);
    setPreviewUrl(null);
  }

  function handleFile(file: File | undefined) {
    if (!file) return;
    setImage(file);
    setPreviewUrl(URL.createObjectURL(file));
  }

  function retake() {
    setImage(null);
    setPreviewUrl(null);
    inputRef.current?.click();
  }

  async function readId() {
    if (!image) return;
    setBusy(true);
    try {
      const worker = await getWorker();
      const { data } = await worker.recognize(image);
      const parsed = parseMrzText(data.text);
      if (!parsed) {
        toast.error("Couldn't read the ID — please type the details manually");
        return;
      }
      onResult(parsed);
      toast.success("ID scanned — fields pre-filled");
      close();
    } catch {
      toast.error("Couldn't read the ID — please type the details manually");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) close();
        else setOpen(true);
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="w-full">
          <ScanLine className="size-4" />
          Scan ID
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Scan guest ID</DialogTitle>
          <DialogDescription>
            Photograph the passport&apos;s Machine-Readable Zone (the last two lines) or the front of an
            Emirates ID. The photo is read on this device and never uploaded.
          </DialogDescription>
        </DialogHeader>

        {image && previewUrl ? (
          <div className="space-y-3">
            <div className="overflow-hidden rounded-lg border bg-muted">
              {/* eslint-disable-next-line @next/next/no-img-element -- local object URL, never uploaded */}
              <img src={previewUrl} alt="Captured ID" className="max-h-64 w-full object-cover" />
            </div>
            <DialogFooter className="gap-2 sm:justify-between">
              <Button type="button" variant="ghost" disabled={busy} onClick={retake}>
                <RefreshCw className="size-4" />
                Retake
              </Button>
              <Button type="button" disabled={busy} onClick={readId}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : <ScanLine className="size-4" />}
                {busy ? "Reading…" : "Read ID"}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-3">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="grid w-full place-items-center gap-2 rounded-lg border border-dashed p-8 text-muted-foreground transition-colors hover:border-primary hover:text-primary"
            >
              <Camera className="size-6" />
              <span className="text-sm font-medium">Open camera</span>
            </button>
            <p className="text-xs text-muted-foreground">
              Tip: hold the phone square over the zone, keep the card flat, and avoid glare.
            </p>
          </div>
        )}

        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            handleFile(e.target.files?.[0]);
            e.target.value = ""; // allow re-selecting the same file on retake
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
