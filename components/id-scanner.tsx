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
let ocrPromise: Promise<{
  worker: TesseractWorker;
  PSM: typeof TesseractNS.PSM;
  OEM: typeof TesseractNS.OEM;
}> | null = null;

function getOcr() {
  if (!ocrPromise) {
    ocrPromise = import("tesseract.js").then(async (m) => {
      const worker = await m.createWorker("eng", m.OEM.LSTM_ONLY, {
        workerPath: "/tesseract/worker.min.js",
        corePath: "/tesseract/", // resolves to one of the three -lstm.wasm.js cores
        langPath: "/tesseract/", // fetches /tesseract/eng.traineddata.gz
      });
      return { worker, PSM: m.PSM, OEM: m.OEM };
    });
  }
  return ocrPromise;
}

const MRZ_CHARSET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ<";

/** Uppercase and drop anything that isn't a valid MRZ character. Tesseract's
 * language model (used as a fallback below) emits lowercase, spaces and
 * punctuation that would garble the fixed-width MRZ lines — strip them. */
function normalizeMrzText(text: string): string {
  return text
    .toUpperCase()
    .split("\n")
    .map((line) => line.replace(/[^A-Z0-9<]/g, ""))
    .join("\n");
}

/**
 * Downscale to a workable size and convert to grayscale. Tesseract's default
 * model reads the MRZ reliably only when the characters land in a narrow size
 * band; on a 1080p+ phone photo they are far too large, so we cap the longest
 * side and let the band-resizing step (cropAndResizeMrz) finish the job. High
 * quality (smooth) scaling is essential — nearest-neighbour upscaling chunks
 * the glyphs and destroys accuracy.
 */
function prepareFrame(source: ImageBitmap | HTMLImageElement): {
  canvas: HTMLCanvasElement;
  gray: Uint8ClampedArray;
  width: number;
  height: number;
} {
  const sw = source.width;
  const sh = source.height;
  const scale = Math.min(1, 1200 / Math.max(sw, sh));
  const W = Math.max(1, Math.round(sw * scale));
  const H = Math.max(1, Math.round(sh * scale));

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, W, H);

  const img = ctx.getImageData(0, 0, W, H);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const g = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
    d[i] = g;
    d[i + 1] = g;
    d[i + 2] = g;
  }
  ctx.putImageData(img, 0, 0);
  return { canvas, gray: new Uint8ClampedArray(d), width: W, height: H };
}

/**
 * Locate the Machine-Readable Zone by horizontal projection. MRZ lines are
 * dense horizontal strips of text; on a passport or Emirates ID back the block
 * sits at the bottom of the card, above nothing but its own lines. We walk the
 * dense row-runs from the bottom and keep runs that look like text lines
 * (≤ ~90 rows) separated by small gaps, stopping when we hit a big gap or a
 * block far taller than a text line (the 2D barcode on an EID back). Returns
 * the row range [y0, y1] (plus margins) and the number of lines, or null.
 */
function findMrzBand(
  gray: Uint8ClampedArray,
  width: number,
  height: number,
): { y0: number; y1: number; lines: number } | null {
  const dense = new Array<boolean>(height).fill(false);
  const rowThresh = Math.max(10, Math.round(width * 0.04));
  for (let y = 0; y < height; y++) {
    let dark = 0;
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (gray[row + x] < 140) dark++;
    }
    dense[y] = dark >= rowThresh;
  }

  const runs: Array<[number, number]> = [];
  let y = 0;
  while (y < height) {
    if (dense[y]) {
      const y0 = y;
      while (y < height && dense[y]) y++;
      runs.push([y0, y - 1]);
    } else {
      y++;
    }
  }

  const cluster: Array<[number, number]> = [];
  for (let i = runs.length - 1; i >= 0; i--) {
    const [a, b] = runs[i];
    if (b - a + 1 > 90) break; // the 2D barcode / QR block — stop here
    if (cluster.length && cluster[0][0] - b - 1 > 45) break; // big gap — stop
    cluster.unshift([a, b]);
  }
  if (cluster.length < 2) return null;
  return {
    y0: Math.max(0, cluster[0][0] - 4),
    y1: Math.min(height - 1, cluster[cluster.length - 1][1] + 4),
    lines: cluster.length,
  };
}

/** Crop the MRZ band and resize it so each line lands near `lineHeight` px. */
function cropAndResizeMrz(
  src: HTMLCanvasElement,
  y0: number,
  y1: number,
  lines: number,
  lineHeight: number,
): HTMLCanvasElement {
  const ch = y1 - y0 + 1;
  const target = Math.max(20, Math.round(lines * lineHeight + 8));
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round((src.width * target) / ch));
  out.height = target;
  const ctx = out.getContext("2d")!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, y0, src.width, ch, 0, 0, out.width, target);
  return out;
}

/** Decode the captured File into something drawable. */
async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") return createImageBitmap(file);
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Couldn't decode image"));
    });
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
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
      const { worker, PSM } = await getOcr();
      const source = await loadBitmap(image);
      const prepared = prepareFrame(source);

      const band = findMrzBand(prepared.gray, prepared.width, prepared.height);
      if (!band) {
        toast.error("Couldn't find the machine-readable zone — hold the card flat so the back of the Emirates ID (or the bottom of a passport) fills the frame");
        return;
      }

      // Tesseract's default model is far more accurate when the MRZ characters
      // land in a ~30–46 px band, and the engine reads digits and names best
      // under slightly different conditions — so we try a small ensemble of
      // line heights, first with the strict MRZ whitelist (clean reads) and
      // then letting the language model help the name line, normalising the
      // output afterwards. Each pass is gated by the ICAO check digits in
      // parseMrzText, so a misread is rejected, never recorded.
      const variants = [
        { mode: "wl", line: 34 },
        { mode: "wl", line: 40 },
        { mode: "nowl", line: 46 },
        { mode: "nowl", line: 34 },
      ] as const;

      let parsed: ParsedId | null = null;
      for (const v of variants) {
        await worker.setParameters({
          tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
          tessedit_char_whitelist: v.mode === "wl" ? MRZ_CHARSET : "",
        });
        const canvas = cropAndResizeMrz(prepared.canvas, band.y0, band.y1, band.lines, v.line);
        const { data } = await worker.recognize(canvas);
        const text = v.mode === "nowl" ? normalizeMrzText(data.text) : data.text;
        parsed = parseMrzText(text);
        if (parsed) break;
      }
      if (!parsed) {
        toast.error("Couldn't read the ID — frame the machine-readable zone (back of Emirates ID / bottom of a passport) and retry, or type the details manually");
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
            Photograph the Machine-Readable Zone — the <span className="font-medium">back of an Emirates
            ID</span> (three lines of characters) or the <span className="font-medium">bottom two lines of a
            passport</span> data page. The photo is read on this device and never uploaded.
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
              Tip: hold the phone square over the text block, keep the card flat and well-lit, and avoid glare.
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
