// Generates PWA/app icons (512, 192, apple-touch 180) as solid PNGs — no deps.
// Motif: a light magnifier on a dark rounded square.
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "..", "public");

// ---- minimal RGBA PNG encoder ----
const CRC_TABLE = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c;
}
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}
function encodePNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0; // filter: none
    rgba.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function drawIcon(S) {
  const R = Math.round(S * 0.22); // corner radius
  const bg = [24, 24, 27, 255]; // #18181b
  const fg = [244, 244, 245, 255]; // #f4f4f5
  const rgba = Buffer.alloc(S * S * 4);

  const lensCx = S * 0.5;
  const lensCy = S * 0.47;
  const lensR = S * 0.26;
  const ringW = S * 0.07;
  const handleA = { x: S * 0.66, y: S * 0.63 };
  const handleB = { x: S * 0.83, y: S * 0.8 };
  const handleR = S * 0.055;

  const distToSeg = (px, py, ax, ay, bx, by) => {
    const abx = bx - ax;
    const aby = by - ay;
    const apx = px - ax;
    const apy = py - ay;
    const len2 = abx * abx + aby * aby;
    let t = (apx * abx + apy * aby) / len2;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + t * abx;
    const cy = ay + t * aby;
    return Math.hypot(px - cx, py - cy);
  };

  const minX = R;
  const maxX = S - R;
  const minY = R;
  const maxY = S - R;

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      let inside = true;
      if (px < minX || px > maxX || py < minY || py > maxY) {
        const cx = px < minX ? minX : maxX;
        const cy = py < minY ? minY : maxY;
        inside = (px - cx) ** 2 + (py - cy) ** 2 <= R * R;
      }
      if (!inside) continue; // transparent outside the rounded square

      let col = bg;
      const dLens = Math.hypot(px - lensCx, py - lensCy);
      const inRing = dLens <= lensR + ringW && dLens >= lensR - ringW;
      const inHandle = distToSeg(px, py, handleA.x, handleA.y, handleB.x, handleB.y) <= handleR;
      if (inRing || inHandle) col = fg;

      const i = (y * S + x) * 4;
      rgba[i] = col[0];
      rgba[i + 1] = col[1];
      rgba[i + 2] = col[2];
      rgba[i + 3] = col[3];
    }
  }
  return encodePNG(S, S, rgba);
}

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "icon-512.png"), drawIcon(512));
writeFileSync(join(outDir, "icon-192.png"), drawIcon(192));
writeFileSync(join(outDir, "apple-touch-icon.png"), drawIcon(180));
console.log("Icons written to", outDir);
