// Self-host the Tesseract.js runtime so OCR never phones home to a CDN at
// runtime (the ID scan runs fully on-device; only static assets are fetched,
// same-origin). Sources come from installed packages so everything stays
// version-matched to `package.json`:
//   - worker script:          tesseract.js  (dist/worker.min.js)
//   - WASM cores (LSTM):      tesseract.js-core  (ships as .wasm.js single files)
//   - eng traineddata:        @tesseract.js-data/eng  (4.0.0_best_int)
//
// Re-run (`node scripts/fetch-tesseract-assets.mjs`) after bumping any of
// those dependencies. Output is committed to git for deterministic builds.
import { copyFileSync, mkdirSync, statSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(root, "public", "tesseract");

/** Source (repo-relative) → filename under public/tesseract/. */
const ASSETS = [
  "node_modules/tesseract.js/dist/worker.min.js",
  "node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js",
  "node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js",
  "node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js",
  "node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz",
];

mkdirSync(outDir, { recursive: true });

let copied = 0;
for (const rel of ASSETS) {
  const src = join(root, rel);
  if (!existsSync(src)) {
    console.error(`MISSING ${rel} — run \`npm install\` first.`);
    process.exitCode = 1;
    continue;
  }
  const dest = join(outDir, rel.split("/").pop());
  copyFileSync(src, dest);
  const mb = statSync(dest).size / 1024 / 1024;
  console.log(`  ${rel.split("/").pop()}  (${mb.toFixed(1)} MB)`);
  copied += 1;
}

if (copied === ASSETS.length) {
  console.log(`Tesseract assets self-hosted in public/tesseract/ (${copied} files).`);
} else {
  console.error(`${copied}/${ASSETS.length} copied — fix the missing sources and re-run.`);
  process.exitCode = 1;
}
