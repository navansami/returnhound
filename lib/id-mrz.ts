import { parse } from "mrz";
import { ID_TYPES } from "@/lib/validators";

/**
 * Local MRZ reading for guest IDs (Emirates ID / passport). This module is
 * deliberately free of any OCR or network dependency — callers run an OCR
 * engine (Tesseract.js, in-browser) and hand us its raw text. The photo never
 * leaves the device: no Cloudinary, no Gemini, no server round-trip.
 *
 * The `mrz` parser validates ICAO check digits, so a misread is *rejected*
 * here (null → the collection form falls back to manual entry) rather than
 * silently recording a wrong government ID number.
 */

/** MRZ line widths per ICAO 9303: TD1 cards are 3×30, TD2 2×36, TD3 2×44. */
const MRZ_LINE_LENGTHS = new Set([30, 36, 44]);

export type ParsedId = {
  name: string;
  idNumber: string;
  idType: (typeof ID_TYPES)[number];
};

/** True when a line could be part of an MRZ: fixed width, only [A-Z0-9<]. */
function isMrzLine(line: string): boolean {
  if (line.length === 0 || !MRZ_LINE_LENGTHS.has(line.length)) return false;
  for (const ch of line) {
    if (ch !== "<" && !(ch >= "A" && ch <= "Z") && !(ch >= "0" && ch <= "9")) {
      return false;
    }
  }
  return true;
}

/**
 * Pull the Machine-Readable Zone out of free-form OCR text. The MRZ is the
 * trailing run of 2–3 fixed-width lines composed only of [A-Z0-9<]; anything
 * above it (card title text, surrounding noise) is dropped.
 */
export function extractMrzLines(ocrText: string): string[] {
  const lines = ocrText.split(/\r?\n/).map((line) => line.trim());
  const run: string[] = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    if (isMrzLine(lines[i])) {
      run.unshift(lines[i]);
    } else if (run.length > 0) {
      break; // first non-MRZ line under the zone ends the trailing run
    }
  }
  return run.length >= 2 ? run.slice(0, 3) : [];
}

/** Map the MRZ document format + nationality onto the collection's idType enum. */
function mapIdType(
  format: string,
  nationality?: string | null,
): (typeof ID_TYPES)[number] {
  switch (format) {
    case "TD3":
      return "passport"; // 2×44 line format carried by passports
    case "TD1":
      // 3×30 line format on national ID cards — Emirates ID when the
      // nationality is UAE, otherwise a foreign ID we label "other".
      return nationality === "ARE" ? "emirates_id" : "other";
    default:
      return "other";
  }
}

/**
 * Parse OCR'd ID text into the fields the collection form needs. Returns null
 * when the MRZ can't be found or its ICAO check digits don't all validate —
 * the caller falls back to manual entry. A wrong ID number is never accepted.
 */
export function parseMrzText(ocrText: string): ParsedId | null {
  const lines = extractMrzLines(ocrText);
  if (lines.length < 2) return null;
  // `parseMrzLines` keeps the strict ICAO gate: `mrz` reassembles the full
  // document number itself, including the ICAO 9303 truncation convention used
  // by UAE Emirates IDs (where the 15-digit number overflows the 9-character
  // field into the optional field) — so `documentNumber` is the complete
  // number, and any misread fails the check digits and returns null.
  return parseMrzLines(lines);
}

const MRZ_CHARSET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ<";

/** ICAO 9303 check-digit (mod 10, weights 7-3-1) — mirrors the `mrz` lib. */
function computeCheckDigit(str: string): number {
  let code = 0;
  const factors = [7, 3, 1];
  for (let i = 0; i < str.length; i++) {
    let charCode = str.charCodeAt(i);
    if (charCode === 60) charCode = 0;
    if (charCode >= 65) charCode -= 55;
    if (charCode >= 48) charCode -= 48;
    charCode *= factors[i % 3];
    code += charCode;
  }
  return code % 10;
}

/**
 * ICAO check digits that can be validated without a full parse. TD1 (3×30):
 * line 1 carries the document-number check; line 2 the date-of-birth, expiry
 * and composite checks (the composite also spans line 1, so it is checked
 * against the read's other line here and re-validated by the full parse).
 * TD3 (2×44): line 1 carries document-number, DOB, expiry, personal-number and
 * composite checks — all within the line. Name lines have no check digit, but
 * the 2-character document code (ID / P<) is enforced because Tesseract loves
 * to read the I in "ID" as a T.
 */
function checksPass(
  line: string,
  width: number,
  lineIndex: number,
  otherLine?: string,
): boolean {
  if (width === 30) {
    if (lineIndex === 0) {
      const code = line.slice(0, 2);
      if (!/^[ACI][A-Z<]$/.test(code) || code[1] === "V") return false;
      return computeCheckDigit(line.slice(5, 14)) === Number(line[14]);
    }
    if (lineIndex === 1) {
      if (computeCheckDigit(line.slice(0, 6)) !== Number(line[6])) return false;
      if (computeCheckDigit(line.slice(8, 14)) !== Number(line[14])) return false;
      if (otherLine) {
        const compositeSource =
          otherLine.slice(5, 30) + line.slice(0, 7) + line.slice(8, 15) + line.slice(18, 29);
        if (computeCheckDigit(compositeSource) !== Number(line[29])) return false;
      }
      return true;
    }
    return true;
  }
  if (width === 44 && lineIndex === 1) {
    if (computeCheckDigit(line.slice(0, 9)) !== Number(line[9])) return false;
    if (computeCheckDigit(line.slice(13, 19)) !== Number(line[19])) return false;
    if (computeCheckDigit(line.slice(21, 27)) !== Number(line[27])) return false;
    const personal = line.slice(28, 42);
    if (personal === "<".repeat(14)) {
      // An empty personal number must carry a 0 or < check digit (mrz rule).
      if (line[42] !== "0" && line[42] !== "<") return false;
    } else if (computeCheckDigit(personal) !== Number(line[42])) {
      return false;
    }
    const compositeSource = line.slice(0, 10) + line.slice(13, 20) + line.slice(21, 43);
    return computeCheckDigit(compositeSource) === Number(line[43]);
  }
  return true;
}

/**
 * Single-edit repair candidates for one OCR'd line. Lines that already pass
 * every applicable check are kept as-is; otherwise we try every substitution,
 * and fix length errors with insertions/deletions. Only candidates whose own
 * check digits validate survive — the name line (which has none) is never
 * guessed beyond length-correcting with filler characters or a deletion.
 * `otherLine` (the read's line 1 partner) lets the TD1 composite check prune
 * line-2 candidates; the full parse re-validates the final combination.
 */
function repairCandidates(
  line: string,
  width: number,
  lineIndex: number,
  otherLine?: string,
): string[] {
  const out = new Set<string>();
  const add = (candidate: string) => {
    if (candidate.length === width && checksPass(candidate, width, lineIndex, otherLine)) {
      out.add(candidate);
    }
  };

  add(line);

  // The 2-character document code is often read entirely wrong (ID -> TL), and
  // a single substitution can't fix a 2-character slip — try every valid code
  // directly. Only the ICAO check digits downstream decide what survives.
  if (line.length === width && lineIndex === 0) {
    const firsts = width === 30 ? ["A", "C", "I"] : ["P"];
    for (const first of firsts) {
      for (const second of "ABCDEFGHIJKLMNOPQRSTUVWXYZ<") {
        if (second === "V") continue;
        const code = first + second;
        if (line.startsWith(code)) continue;
        add(code + line.slice(2));
      }
    }
  }

  if (line.length === width) {
    if (checksPass(line, width, lineIndex, otherLine)) return [...out];
    for (let i = 0; i < width; i++) {
      for (const ch of MRZ_CHARSET) {
        if (ch === line[i]) continue;
        add(line.slice(0, i) + ch + line.slice(i + 1));
      }
    }
  } else if (line.length === width - 1) {
    // A missing character — try filling each position. The name line only
    // ever fills with the filler character, never with a guessed letter.
    const chars = lineIndex === 2 || width === 44 ? "<" : MRZ_CHARSET;
    for (let i = 0; i <= width; i++) {
      for (const ch of chars) {
        add(line.slice(0, i) + ch + line.slice(i));
      }
    }
  } else if (line.length === width + 1) {
    // A stray character — try dropping each position.
    for (let i = 0; i < line.length; i++) {
      add(line.slice(0, i) + line.slice(i + 1));
    }
  } else if (line.length > width + 1 || line.length < width - 1) {
    // The name line has no check digit, and OCR tends to append stray glyphs
    // to (or drop fillers from) the last MRZ line. Drop/restore up to 3
    // trailing characters rather than guess what the name should be.
    const isNameLine = width === 30 ? lineIndex === 2 : lineIndex === 0;
    if (isNameLine) {
      const excess = line.length - width;
      if (excess >= 1 && excess <= 3) add(line.slice(0, width));
      const missing = width - line.length;
      if (missing >= 1 && missing <= 3) add(line + "<".repeat(missing));
    }
  }
  return [...out];
}

/**
 * Trailing MRZ-like lines out of an OCR read, allowing small length slips that
 * `extractMrzLines` would reject. The band is cropped tightly, so the read is
 * mostly the MRZ plus boundary noise.
 */
function lenientMrzLines(ocrText: string): string[] {
  const lines = ocrText
    .split(/\r?\n/)
    .map((line) => line.toUpperCase().replace(/[^A-Z0-9<]/g, ""))
    .filter((line) => line.length > 0);
  const run: string[] = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (line.length >= 28 && line.length <= 46) {
      run.unshift(line);
    } else if (run.length > 0) {
      break;
    }
  }
  return run.length >= 2 ? run.slice(0, 3) : [];
}

/** Try `parseMrzText` over every combination of per-line repair candidates. */
export function parseMrzTextRepaired(ocrText: string): ParsedId | null {
  const lines = lenientMrzLines(ocrText);
  if (lines.length < 2) return null;

  // TD1 (3×30) and TD3 (2×44) are the formats with a repair path; TD2 stays
  // with the strict parse in `parseMrzText`.
  // Widths are checked leniently on purpose: a line that OCR dropped or
  // padded a character on is exactly what the repair is for.
  const width =
    lines.length === 3 && lines.every((l) => l.length >= 27 && l.length <= 33)
      ? 30
      : lines.length === 2 && lines.every((l) => l.length >= 41 && l.length <= 47)
        ? 44
        : 0;
  if (!width) return null;

  const candidates = lines.map((line, i) =>
    repairCandidates(line, width, i, i === 1 ? lines[0] : undefined),
  );
  // Keep the search bounded: a near-correct read yields a handful of
  // candidates per line; anything bigger is unlikely to be a single-edit fix.
  let budget = 4000;
  for (const a of candidates[0]) {
    for (const b of candidates[1]) {
      const combos: string[][] =
        candidates.length === 3
          ? candidates[2].map((c) => [a, b, c])
          : [[a, b]];
      for (const combo of combos) {
        if (--budget < 0) return null;
        const parsed = parseMrzLines(combo);
        if (parsed) return parsed;
      }
    }
  }
  return null;
}

/** Share the parse + field mapping so repair and strict paths behave alike. */
function parseMrzLines(lines: string[]): ParsedId | null {
  let parsed;
  try {
    parsed = parse(lines, { autocorrect: true });
  } catch {
    return null;
  }
  if (!parsed.valid) return null;

  const idNumber = (parsed.documentNumber ?? "").replace(/[< ]+$/, "").trim();
  const firstName = (parsed.fields.firstName ?? "").trim();
  const lastName = (parsed.fields.lastName ?? "").trim();
  if (!idNumber || (!firstName && !lastName)) return null;

  return {
    name: [firstName, lastName].filter(Boolean).join(" "),
    idNumber,
    idType: mapIdType(parsed.format, parsed.fields.nationality),
  };
}
