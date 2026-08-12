#!/usr/bin/env python3
"""
Convert the Fairmont Lost & Found Excel log into the import-ready CSV pattern
that app/(app)/imports consumes (components/import-tool.tsx).

Pattern produced:
  - One CSV row per ITEM.
  - Rows sharing the same "RS number" group into ONE entry with multiple items.
  - Dates are ISO (YYYY-MM-DDTHH:MM) so the wizard's "Auto" date format parses them.
  - Entry-level details (found date/location, finder, agent) are repeated on every
    row of the same entry, exactly like the import template.

Known source quirks handled:
  - RS number is stored as "RS5133/07/2026" (date appended after a slash).
  - Some RS numbers are malformed: "RSS5153/08/2026", "RS5316/08/026".
  - Multiple items live in ONE cell ("2 hats, cottons buds, cable") and must be
    split into per-item rows.
  - Finder name + department are combined with a slash: "Saleem/HK".
  - Time column is messy: Excel time fractions, "10:10am", "Not recorded", "-".
  - "Handed over to security" is not a police handover here — it becomes
    isValuable=true + storage location "Security" (status stays Logged).
  - Remarks (guest collection details) are carried into the Comments field.

Usage:
  python3 scripts/convert-excel-log.py <input.xlsx> [--out out.csv]
  e.g.
  python3 scripts/convert-excel-log.py ~/Downloads/08_August_2026.xlsx \
      --out ~/Downloads/08_August_2026_import.csv
"""
import argparse
import csv
import datetime
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

NSM = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"


# --------------------------------------------------------------------------- read xlsx

def read_sheets(path: str) -> list[tuple[str, list[dict[str, object]]]]:
    """Return [(sheet_name, [{col_letter: raw_value, ...}, ...])]. Cell refs use Excel letters."""
    z = zipfile.ZipFile(path)

    shared = []
    for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall(NSM + "si"):
        shared.append("".join(t.text or "" for t in si.iter(NSM + "t")))

    # Map workbook sheet entries -> worksheet file via relationships.
    wb = ET.fromstring(z.read("xl/workbook.xml"))
    rels = {
        r.get("Id"): r.get("Target")
        for r in ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
    }
    sheet_rels = []
    for s in wb.findall(NSM + "sheets/" + NSM + "sheet"):
        name = s.get("name")
        rid = s.get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id")
        target = rels.get(rid, "")
        if not target.startswith("xl/"):
            target = "xl/" + target.lstrip("/")
        sheet_rels.append((name, target))

    # Build a set of column indices that render as dates (to show them for debugging only).
    styles = ET.fromstring(z.read("xl/styles.xml"))
    numfmts = {}
    nf_node = styles.find(NSM + "numFmts")
    if nf_node is not None:
        for f in nf_node.findall(NSM + "numFmt"):
            numfmts[f.get("numFmtId")] = f.get("formatCode", "")
    cell_xfs = styles.find(NSM + "cellXfs")
    date_xfs: set[int] = set()
    if cell_xfs is not None:
        for i, xf in enumerate(cell_xfs.findall(NSM + "xf")):
            fmtid = xf.get("numFmtId")
            code = numfmts.get(fmtid, "")
            if ("y" in code) or fmtid in ("14", "15", "16", "17", "18", "19", "20", "21", "22", "45", "46", "47", "48", "49"):
                date_xfs.add(i)

    def col_letter(ref: str) -> str:
        return re.match(r"[A-Z]+", ref).group(0)

    def parse(path: str) -> list[dict[str, object]]:
        rows = []
        for row in ET.fromstring(z.read(path)).iter(NSM + "row"):
            cells: dict[str, object] = {}
            for c in row.findall(NSM + "c"):
                ref = c.get("r")
                t = c.get("t")
                s = c.get("s")
                vnode = c.find(NSM + "v")
                raw = vnode.text if vnode is not None else None
                isin = c.find(NSM + "is")
                if isin is not None:
                    val = "".join(x.text or "" for x in isin.iter(NSM + "t"))
                elif t == "s":
                    val = shared[int(raw)] if raw is not None else ""
                elif t == "b":
                    val = raw == "1"
                elif t in ("str", "inlineStr"):
                    val = raw or ""
                elif raw is None:
                    val = ""
                else:
                    try:
                        f = float(raw)
                        # Excel date cells are floats; keep them as floats (converted later).
                        val = f
                    except ValueError:
                        val = raw
                cells[col_letter(ref)] = val
            rows.append(cells)
        return rows

    return [(name, parse(target)) for name, target in sheet_rels]


# --------------------------------------------------------------------------- helpers

EXCEL_EPOCH = datetime.datetime(1899, 12, 30)


def cell(row: dict[str, object], col: str) -> str:
    v = row.get(col, "")
    return "" if v is None else str(v).strip()


def excel_serial_to_date(n: float) -> datetime.datetime:
    return EXCEL_EPOCH + datetime.timedelta(days=n)


def parse_date(v: object) -> datetime.date | None:
    """Column A — serial float, or a 'DD/MM/YYYY ...' string."""
    if isinstance(v, (int, float)):
        try:
            return excel_serial_to_date(float(v)).date()
        except (OverflowError, ValueError):
            return None
    s = str(v).strip()
    m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{4})", s)
    if m:
        try:
            return datetime.date(int(m.group(3)), int(m.group(2)), int(m.group(1)))
        except ValueError:
            return None
    return None


def parse_time(v: object) -> str | None:
    """Column C — Excel time fraction (<1), a time string, or junk. Returns 'HH:MM' or None."""
    if isinstance(v, (int, float)):
        f = float(v)
        if 0 <= f < 1:
            total = int(round(f * 24 * 60))
            return f"{total // 60:02d}:{total % 60:02d}"
        if 1 <= f < 60:
            # Whole-day serial where the user typed a time but Excel stored it as a date
            frac = f - int(f)
            if frac:
                total = int(round(frac * 24 * 60))
                return f"{total // 60:02d}:{total % 60:02d}"
        return None
    s = str(v).strip()
    if not s or s in ("-", "Not recorded", "N/A"):
        return None
    m = re.match(r"^(\d{1,2}):(\d{1,2})\s*(am|pm)?", s, re.I)
    if not m:
        return None
    hh, mm, ap = int(m.group(1)), int(m.group(2)), m.group(3)
    if ap:
        if ap.lower() == "pm" and hh < 12:
            hh += 12
        if ap.lower() == "am" and hh == 12:
            hh = 0
    return f"{hh:02d}:{mm:02d}"


def normalize_rs(raw: str) -> str | None:
    """'RS5133/07/2026' -> 'RS5133'. Tolerates a stray S and year typos in the suffix."""
    s = raw.strip().upper()
    m = re.match(r"^RSS?(\d+)(?:/(\d{1,2})/(\d{2,4}))?$", s)
    if not m:
        return None
    digits = m.group(1).lstrip("0") or "0"
    return "RS" + digits.rjust(4, "0")


def split_items(text: str) -> list[str]:
    return [p.strip() for p in text.split(",") if p.strip()]


# Status mapping (source label -> our import vocabulary)
#   'Handed over to security' is NOT police handover here; it becomes valuable + Security storage.
#   Pending labels ('To be collected', 'To be disposed', 'For shipment') stay LOGGED — the
#   item hasn't left the store yet, so it must not be marked collected/discarded.
def source_status(v: str) -> tuple[str, str, str]:
    """Returns (itemStatus, storageLocation, valuable?) for the import CSV. '' valuable = decide by keyword."""
    s = v.strip().lower()
    if s in ("collected", "released", "collected by guest", "handed to guest"):
        return ("Collected", "", "")
    if s in ("disposed", "discarded", "destroyed", "disposed off"):
        return ("Discarded", "", "")
    if "security" in s or "handed over to sec" in s:
        return ("", "Security", "yes")  # valuable, kept by Security, still Logged
    # 'to be …', 'inquiry', 'for shipment', '------------', blank -> plain logged
    return ("", "", "")


CATEGORY_KEYWORDS: list[tuple[str, str]] = [
    ("electronics", r"phone|iphone|ipad|laptop|tablet|earphone|earpod|airpod|headphone|charger|adapter|power\s?bank|cable|speaker|e-?cig|vape"),
    ("currency", r"wallet|money|\bcash\b|coin|currency|d[ií]rham"),
    ("documents", r"passport|\bid\b|visa|document|licen[cs]e|identity"),
    ("jewellery", r"jewel|necklace|ring|earring|bracelet|watch|gold|silver"),
    ("food", r"food|snack|nut|cash[eë]w|chocolate|biscuit|candy|crisp|fruit|milk|coffee|tea bag|cashew"),
    ("alcohol", r"alcohol|wine|beer|vodka|whis[ck]y|champagne|spirits"),
    ("clothing", r"t-?shirt|shirt|shoes|sandal|slipper|\bcap\b|hat|jacket|pants|trouser|dress|scarf|sock|underwear|garment|crocs|towel|robe"),
    ("other", r"medicine|tablet|inhaler|eyedrop|syringe|perfume|spray|cream|lotion|cosmetic|makeup|toothbrush|shampoo|soap|deod?orant|razor|sunglass|eyeglass|glasses|umbrella|pillow|blanket|floater|goggle|swimwear|bikini|swimsuit|floatie|earbuds"),
    ("general", r"book|magazine|toy|ball|bag|bottle|key|remote|adapter|clock|jar|basket|cork|cover|jumper|sweater|hoodie|shoe|purse|wallet|container"),
]

VALUABLE_KEYWORDS = r"passport|wallet|money|cash|jewel|necklace|earring|ring|bracelet|\bwatch\b|phone|iphone|ipad|laptop|tablet|camera|airpod|earpod|gold|silver|perfume|dirham"


def guess_category(item_name: str) -> str:
    n = item_name.lower()
    for cat, pat in CATEGORY_KEYWORDS:
        if re.search(pat, n):
            return cat
    return ""


def is_valuable(item_name: str) -> bool:
    return bool(re.search(VALUABLE_KEYWORDS, item_name.lower()))


def find_header(rows: list[dict[str, object]]) -> int:
    for i, r in enumerate(rows):
        b = cell(r, "B").lower()
        e = cell(r, "E").lower()
        i_ = cell(r, "I").lower()
        if ("ref" in b or "number" in b) and ("item" in e) and ("status" in i_):
            return i
    return -1


# --------------------------------------------------------------------------- main

def main() -> None:
    ap = argparse.ArgumentParser(description="Convert the Lost & Found Excel log to an import CSV.")
    ap.add_argument("input", help="Path to the .xlsx log")
    ap.add_argument("--out", default="", help="Output CSV path (default: <input>_import.csv)")
    ap.add_argument("--sheet", type=int, default=0, help="Worksheet index (default 0 = first sheet)")
    args = ap.parse_args()

    sheets = read_sheets(args.input)
    name, rows = sheets[args.sheet]
    header = find_header(rows)
    if header < 0:
        sys.exit(f"No header row found in sheet {name!r} — expected columns with 'Ref no.', 'Item/s', 'Status'.")
    data = rows[header + 1 :]

    out_path = args.out or args.input.replace(".xlsx", "_import.csv")

    # Assign continuation RS numbers to rows that don't have one, so multi-item rows
    # without a number still group into a single entry instead of splitting apart.
    highest = 0
    for r in data:
        rs = normalize_rs(cell(r, "B"))
        if rs:
            m = re.search(r"\d+", rs)
            if m:
                highest = max(highest, int(m.group(0)))
    next_free = highest + 1

    out_rows: list[dict[str, str]] = []
    warnings: list[str] = []
    skipped = 0
    collected_remarks = 0
    seen_rs: dict[str, int] = {}  # RS -> row it was first seen on

    for idx, r in enumerate(data):
        if not any(str(r.get(k) or "").strip() for k in "ABCDEFGHIJKL"):
            continue  # placeholder row
        src_row = header + idx + 2  # 1-based, for messages

        item_cell = cell(r, "E")
        if not item_cell:
            skipped += 1
            remarks = cell(r, "J")
            warnings.append(f"Row {src_row}: no item (skipped)" + (f" — remarks: {remarks!r}" if remarks else ""))
            continue

        items = split_items(item_cell)
        desc_is_duplicate = cell(r, "E") == cell(r, "F")  # F repeats the item list verbatim

        date = parse_date(r.get("A"))
        t = parse_time(r.get("C"))
        found_at = ""
        if date:
            found_at = date.isoformat()
            if t:
                found_at += "T" + t
        if not found_at:
            warnings.append(f"Row {src_row}: no usable found date — the importer will skip this item. Fix and re-run.")

        raw_ref = cell(r, "B")
        rs = normalize_rs(raw_ref)
        if rs:
            if not re.match(r"^RS\d+/\d{2}/\d{4}$", raw_ref.strip().upper()):
                warnings.append(f"Row {src_row}: RS reference {raw_ref!r} corrected to {rs}")
            if len(rs) < 5:
                warnings.append(f"Row {src_row}: RS {rs} (short number, padded to 4 digits)")
            if rs in seen_rs:
                warnings.append(f"Row {src_row}: RS {rs} already used on row {seen_rs[rs]} — the importer will MERGE these into one entry.")
            else:
                seen_rs[rs] = src_row
        else:
            rs = f"RS{next_free:04d}"
            next_free += 1
            warnings.append(f"Row {src_row}: no RS number — assigned {rs}")

        # Finder name / department split on the slash ("Saleem/HK").
        g = cell(r, "G")
        finder, dept = g, ""
        if "/" in g:
            finder, dept = (p.strip() for p in g.split("/", 1))

        status, storage, valuable = source_status(cell(r, "I"))
        # Column L ("Location status") sometimes carries the outcome even when I is blank.
        lstat = cell(r, "L").lower().strip()
        if not status and lstat:
            if lstat in ("disposed", "disposed off", "discarded"):
                status = "Discarded"
            elif lstat == "collected":
                status = "Collected"
            elif "security" in lstat:
                storage = "Security"
        comments = cell(r, "J")
        if cell(r, "I").strip().lower() == "collected" and comments:
            collected_remarks += 1
        agent = cell(r, "H")

        # Description pairing: F often lists per-item descriptions in the same order.
        desc_parts = split_items(cell(r, "F")) if cell(r, "F") and not desc_is_duplicate else []
        for n, item in enumerate(items):
            desc = ""
            if desc_parts:
                if len(desc_parts) == len(items):
                    desc = desc_parts[n]
                elif n == 0:
                    desc = cell(r, "F")  # single description covering the whole cell
            cat = guess_category(item)
            val = "yes" if (valuable == "yes" or is_valuable(item)) else "no"
            out_rows.append({
                "RS number": rs,
                "Found date": found_at,
                "Found location": cell(r, "D") or "Unknown",
                "Finder name": finder or "Unknown",
                "Finder department": dept,
                "Finder employee ID": "",
                "Agent name": agent,
                "Item name": item,
                "Item description": desc,
                "Item category": cat,
                "Item status": status,
                "Storage location": storage,
                "Valuable": val,
                "Comments": comments,
            })

    # Order of output is already by file order; group by RS is preserved since rows of the
    # same entry carry identical entry-level details.

    with open(out_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=[
            "RS number", "Found date", "Found location", "Finder name", "Finder department",
            "Finder employee ID", "Agent name", "Item name", "Item description", "Item category",
            "Item status", "Storage location", "Valuable", "Comments",
        ])
        writer.writeheader()
        writer.writerows(out_rows)

    entries = len({r["RS number"] for r in out_rows})
    print(f"Sheet: {name!r} — {len(out_rows)} item rows across {entries} entries")
    print(f"Wrote: {out_path}")
    if warnings:
        print(f"\n{len(warnings)} warnings (shown up to 15):")
        for w in warnings[:15]:
            print(f"  - {w}")
        if len(warnings) > 15:
            print(f"  … and {len(warnings) - 15} more.")
    if collected_remarks:
        print(f"\nNote: {collected_remarks} 'Collected' rows carried guest collection details into Comments —"
              " fill the structured Collection fields later if you need them.")


if __name__ == "__main__":
    main()
