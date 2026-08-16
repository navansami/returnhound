"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, Loader2, RefreshCw, ScanLine } from "lucide-react";
import { toast } from "sonner";

import { parseMrzText, parseMrzTextRepaired, type ParsedId } from "@/lib/id-mrz";
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

/** True when an OCR read looks like a Machine-Readable Zone: at least two
 * fixed-width, [A-Z0-9<]-only lines. Used to distinguish "no MRZ in frame"
 * from "MRZ present but unreadable" so the error message can guide the user. */
function mrzShapedRead(text: string): boolean {
  let lines = 0;
  for (const line of text.split(/\r?\n/)) {
    const length = line.replace(/[^A-Z0-9<]/g, "").length;
    if (length >= 27 && length <= 47) lines++;
    if (lines >= 2) return true;
  }
  return false;
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
 * Locate the Machine-Readable Zone anywhere in the frame. The old projection
 * approach walked dense row-runs from the bottom and assumed the MRZ sits
 * alone at the bottom of a clean photo — it broke on real shots where the card
 * doesn't fill the frame (a dark desk or app UI below), or where the card's 2D
 * barcode and the MRZ lines merge into one dense run. Instead we classify rows
 * by their dark-run structure (text rows have many short glyph runs; barcode
 * blocks and solid fills have few long ones), group text rows into lines, and
 * score every 2–3-line window across the whole frame for MRZ-like shape:
 * similar line heights, high ink density, and (weakly) a lower position in the
 * frame. Returns the row range [y0, y1] and the number of lines, or null.
 */
function findMrzBand(
  gray: Uint8ClampedArray,
  width: number,
  height: number,
): { y0: number; y1: number; lines: number } | null {
  const darkThreshold = 140;
  const minSegments = 4;
  const minDark = Math.max(12, Math.round(width * 0.015));
  const minLineHeight = 6;
  const maxLineHeight = 100;
  const maxLineGap = 45;

  // 1. Classify each row as text-like: enough dark pixels, split into several
  //    short horizontal runs (glyphs) rather than one solid bar (barcode).
  const textRow = new Array<boolean>(height).fill(false);
  for (let y = 0; y < height; y++) {
    let segments = 0;
    let dark = 0;
    let inRun = false;
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (gray[row + x] < darkThreshold) {
        dark++;
        if (!inRun) {
          inRun = true;
          segments++;
        }
      } else {
        inRun = false;
      }
    }
    textRow[y] = segments >= minSegments && dark >= minDark;
  }

  // 2. Group consecutive text rows into lines, tolerating 1–2 stray noise rows
  //    so a slightly glare-washed glyph row doesn't split a line in two.
  const lines: Array<[number, number]> = [];
  let y = 0;
  while (y < height) {
    if (!textRow[y]) {
      y++;
      continue;
    }
    let last = y;
    let cursor = y + 1;
    while (cursor < height) {
      if (textRow[cursor]) {
        last = cursor;
        cursor++;
        continue;
      }
      let holes = 0;
      let look = cursor;
      while (look < height && !textRow[look] && holes <= 2) {
        holes++;
        look++;
      }
      if (holes <= 2 && look < height) {
        last = look;
        cursor = look + 1;
      } else {
        break;
      }
    }
    if (last - y + 1 >= minLineHeight && last - y + 1 <= maxLineHeight) {
      lines.push([y, last]);
    }
    y = cursor;
  }

  // 3. Score every 2–3-line window that could be the MRZ block.
  const inkOf = (a: number, b: number): number => {
    let ink = 0;
    for (let yy = a; yy <= b; yy++) {
      const row = yy * width;
      for (let x = 0; x < width; x++) {
        if (gray[row + x] < darkThreshold) ink++;
      }
    }
    return ink;
  };

  let best: { y0: number; y1: number; lines: number } | null = null;
  let bestScore = -Infinity;
  for (let i = 0; i < lines.length; i++) {
    for (let n = 2; n <= 3 && i + n - 1 < lines.length; n++) {
      const band = lines.slice(i, i + n);
      let gaps = 0;
      let tooWide = false;
      for (let k = 1; k < band.length; k++) {
        const gap = band[k][0] - band[k - 1][1] - 1;
        if (gap > maxLineGap) {
          tooWide = true;
          break;
        }
        gaps += gap;
      }
      if (tooWide) break; // a big gap ends the run of plausible lines
      const heights = band.map(([a, b]) => b - a + 1);
      const mean = heights.reduce((s, h) => s + h, 0) / heights.length;
      const variance =
        heights.reduce((s, h) => s + (h - mean) ** 2, 0) / heights.length;
      const ink = band.reduce((s, [a, b]) => s + inkOf(a, b), 0);
      // MRZ lines are ~30% ink-dense; cap the density term so solid blocks
      // can't dominate. Prefer 3 lines, similar heights, ink-rich lines, and
      // (weakly) blocks lower in the frame — the MRZ sits at the card's bottom.
      const density = Math.min(0.6, ink / (width * mean));
      const score =
        n * 12 - variance * 1.5 + density * 60 + (band[0][0] / height) * 30 - gaps * 0.5;
      if (score > bestScore) {
        bestScore = score;
        best = {
          y0: Math.max(0, band[0][0] - 4),
          y1: Math.min(height - 1, band[band.length - 1][1] + 4),
          lines: n,
        };
      }
    }
  }
  return best;
}

/**
 * Crop the MRZ band out of the ORIGINAL full-resolution photo and resize it so
 * each line lands near `lineHeight` px. The band coordinates come from the
 * capped analysis frame, so they're scaled back up to the source. Reading the
 * band at source resolution (instead of the capped frame) keeps the glyphs as
 * sharp as the camera captured them, which is exactly what Tesseract's
 * size-sensitive model needs.
 */
function cropAndResizeMrz(
  source: ImageBitmap | HTMLImageElement,
  frameH: number,
  y0: number,
  y1: number,
  lines: number,
  lineHeight: number,
): HTMLCanvasElement {
  const ch = y1 - y0 + 1;
  const target = Math.max(20, Math.round(lines * lineHeight + 8));
  const srcH = source.height;
  const sy = Math.min(srcH - 1, Math.round((y0 * srcH) / frameH));
  const sh = Math.max(1, Math.min(srcH - sy, Math.round((ch * srcH) / frameH)));
  const outW = Math.max(1, Math.round((source.width * target) / sh));

  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = target;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, sy, source.width, sh, 0, 0, outW, target);
  return canvas;
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
      // output afterwards. When the card sits far from the lens the band lines
      // come out tiny, so we add two harder-upscaled passes. Every pass is
      // gated by the ICAO check digits, so a misread is rejected, never
      // recorded; if all passes still fail their checksums, a single-edit
      // repair (parseMrzTextRepaired) gets one more chance before we fall back
      // to manual entry.
      const bandLineHeight = (band.y1 - band.y0 + 1) / band.lines;
      const variants = [
        { mode: "wl", line: 34 },
        { mode: "wl", line: 40 },
        { mode: "nowl", line: 46 },
        { mode: "nowl", line: 34 },
        ...(bandLineHeight < 35
          ? ([
              { mode: "wl", line: 56 },
              { mode: "nowl", line: 56 },
            ] as const)
          : []),
      ] as const;

      let parsed: ParsedId | null = null;
      const reads: string[] = [];
      let sawMrzShaped = false;
      for (const v of variants) {
        await worker.setParameters({
          tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
          tessedit_char_whitelist: v.mode === "wl" ? MRZ_CHARSET : "",
        });
        const canvas = cropAndResizeMrz(
          source,
          prepared.height,
          band.y0,
          band.y1,
          band.lines,
          v.line,
        );
        const { data } = await worker.recognize(canvas);
        const text = v.mode === "nowl" ? normalizeMrzText(data.text) : data.text;
        reads.push(text);
        sawMrzShaped ||= mrzShapedRead(text);
        parsed = parseMrzText(text);
        if (parsed) break;
      }
      if (!parsed) {
        for (const text of reads) {
          parsed = parseMrzTextRepaired(text);
          if (parsed) break;
        }
      }
      if (!parsed) {
        // If no pass even produced MRZ-looking fixed-width lines, the "band"
        // was probably card artwork or UI — tell the user to frame the zone.
        toast.error(
          sawMrzShaped
            ? "Couldn't read the ID — frame the machine-readable zone (back of Emirates ID / bottom of a passport) and retry, or type the details manually"
            : "Couldn't find the machine-readable zone — hold the card flat so the back of the Emirates ID (or the bottom of a passport) fills the frame",
        );
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
