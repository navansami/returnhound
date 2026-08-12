"use client";

import { useEffect, useRef } from "react";
import SignaturePad from "signature_pad";
import { Eraser } from "lucide-react";

import { Button } from "@/components/ui/button";

/** Canvas signature capture → compact SVG (stored on the record). */
export function SignaturePadInput({ onChange }: { onChange: (svg: string | null) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const padRef = useRef<SignaturePad | null>(null);
  const onChangeRef = useRef(onChange);

  // Keep the latest onChange without writing refs during render.
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const pad = new SignaturePad(canvas, {
      backgroundColor: "rgba(255,255,255,0)",
      penColor: "#18181b",
    });
    padRef.current = pad;

    const resize = () => {
      const ratio = Math.max(window.devicePixelRatio || 1, 1);
      canvas.width = Math.max(1, Math.floor(canvas.offsetWidth * ratio));
      canvas.height = Math.max(1, Math.floor(canvas.offsetHeight * ratio));
      canvas.getContext("2d")?.setTransform(ratio, 0, 0, ratio, 0, 0);
      pad.clear();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const onEnd = () => {
      onChangeRef.current(pad.isEmpty() ? null : pad.toSVG({ includeBackgroundColor: false }));
    };
    pad.addEventListener("endStroke", onEnd);

    return () => {
      ro.disconnect();
      pad.off();
      padRef.current = null;
    };
  }, []);

  return (
    <div>
      <div className="rounded-lg border bg-white">
        <canvas ref={canvasRef} className="h-32 w-full touch-none" aria-label="Signature" />
      </div>
      <div className="mt-1 flex justify-end">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            padRef.current?.clear();
            onChangeRef.current(null);
          }}
        >
          <Eraser className="size-3.5" /> Clear
        </Button>
      </div>
    </div>
  );
}
