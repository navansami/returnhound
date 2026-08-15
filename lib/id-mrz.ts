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

  let parsed;
  try {
    parsed = parse(lines, { autocorrect: true });
  } catch {
    return null; // unrecognized format / throw from checkLines
  }
  if (!parsed.valid) return null;

  // `mrz` reassembles the full document number itself, including the ICAO 9303
  // truncation convention used by UAE Emirates IDs (where the 15-digit number
  // overflows the 9-character field into the optional field) — so
  // `documentNumber` here is already the complete number.
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
