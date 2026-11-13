"""Build Nayan's medicine index from the Kaggle "A-Z Medicine Dataset of India".

Dataset: https://www.kaggle.com/datasets/shudhanshusingh/az-medicine-dataset-of-india
         (CC BY-SA 4.0, single version from Nov 2022). Used for identity only: brand -> salts, strengths, form.
Parsing rules were checked against all 253,973 rows (shared with the BillSahi importer).

Usage (from the nayan folder):
  python -I data/build_drugdb.py data/raw/A_Z_medicines_dataset_of_India.csv
writes data/medicines.json.gz, which the server loads (lib/drugdb-server.ts).
"""

from __future__ import annotations

import argparse
import csv
import gzip
import json
import re
import sys
from collections import Counter
from decimal import Decimal, InvalidOperation
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from nayan_normalize import composition_key, normalize_medicine_name, salt_key  # noqa: E402

DATASET_URL = "https://www.kaggle.com/datasets/shudhanshusingh/az-medicine-dataset-of-india"

OUTPUT_COLUMNS = [
    "id", "name", "name_norm", "manufacturer", "price_2022", "pack_size_label", "pack_quantity", "pack_unit",
    "dosage_form", "form_variant", "composition", "salt_key", "composition_key", "salt_count",
    "composition_complete", "is_discontinued",
]

RELEASE_VARIANTS = {"dt", "sr", "er", "pr", "cr", "mr", "md", "xr", "od", "cd", "ds", "ec", "xl"}

_ws = re.compile(r"\s+")


def clean(s: str | None) -> str:
    """Collapse tabs, double spaces and surrounding whitespace."""
    return _ws.sub(" ", s or "").strip()


def parse_composition_cell(cell: str | None) -> dict | None:
    """'Amoxycillin  (500mg) ' → {'salt': 'Amoxycillin', 'strength': '500mg'}; '' → None."""
    text = clean(cell)
    if not text:
        return None
    m = re.fullmatch(r"(?P<salt>.+?)\s*\((?P<strength>[^()]*)\)", text)
    if not m:
        return {"salt": text, "strength": None}
    strength = clean(m.group("strength"))
    return {"salt": clean(m.group("salt")), "strength": None if strength.upper() == "NA" else strength}


def parse_pack(label: str | None) -> tuple[Decimal | None, str | None, str]:
    """'strip of 10 tablets' → (10, 'tablet', 'tablets'); 'bottle of 100 ml Syrup' → (100, 'ml', 'Syrup')."""
    text = clean(label)
    m = re.fullmatch(r"(?P<container>[a-z -]+?) of (?P<qty>\d+(?:\.\d+)?) ?(?P<rest>.*)", text, re.I)
    if not m:
        return None, None, text
    qty = Decimal(m.group("qty"))
    rest = m.group("rest")
    first, _, after = rest.partition(" ")
    token = first.lower()
    if token == "ml":
        return qty, "ml", after
    if token in ("ltr", "l", "litre", "liter"):
        return qty * 1000, "ml", after
    if token in ("gm", "g"):
        return qty, "g", after
    if token == "mdi":
        return qty, "dose", after
    form = rest.lower()
    if "tablet" in form:
        unit = "tablet"
    elif "capsule" in form:
        unit = "capsule"
    elif "sachet" in form:
        unit = "sachet"
    elif "kit" in form:
        unit = "kit"
    else:
        unit = "unit"
    return qty, unit, rest


def _variant_after(words: list[str], keyword: str) -> str | None:
    for i, w in enumerate(words):
        if w.startswith(keyword):
            for nxt in words[i + 1:]:
                if nxt in RELEASE_VARIANTS:
                    return nxt
            return None
    return None


def dosage_form(form_text: str, name: str) -> tuple[str, str | None]:
    """Map the pack label's form words to the schema's dosage_form enum, keeping release types apart."""
    f = form_text.lower()
    words = f.split()
    n = name.lower()
    if "tablet" in f:
        variant = _variant_after(words, "tablet")
        if variant is None and "dispersible" in n:
            variant = "dt"
        return "tablet", variant
    if "capsule" in f:
        if "soft gelatin" in f:
            return "capsule", "softgel"
        return "capsule", _variant_after(words, "capsule")
    if "dry syrup" in f:
        return "syrup", "dry"
    if "syrup" in f or "expectorant" in f or "linctus" in f or "oral liquid" in f or f.strip() == "liquid":
        return "syrup", None
    if "suspension" in f:
        return "suspension", None
    if "injection" in f or "infusion" in f:
        if "powder" in f:
            return "injection", "powder"
        return "injection", "infusion" if "infusion" in f else None
    if "drop" in f:
        for kind in ("eye", "ear", "nasal", "oral"):
            if kind in f:
                return "drops", kind
        return "drops", None
    for form in ("cream", "ointment", "gel"):
        if form in f:
            return form, None
    if "solution" in f or "lotion" in f:
        return "solution", None
    if "inhaler" in f or "respules" in f or "rotacap" in f:
        return "inhaler", None
    if "powder" in f or "granule" in f:
        return "powder", None
    return "other", None


# Names like "Zestrain 100mg/325mg/250mg Tablet" carry 3+ strengths, but the dataset only keeps 2 salts.
_three_strengths = re.compile(r"[\d.]+\s?(?:mg|mcg|gm|iu)?/[\d.]+\s?(?:mg|mcg|gm|iu)?/[\d.]+", re.I)


def convert_row(row: dict) -> dict:
    name = clean(row["name"])
    ingredients = [i for i in (parse_composition_cell(row.get("short_composition1")),
                               parse_composition_cell(row.get("short_composition2"))) if i]
    qty, unit, form_text = parse_pack(row.get("pack_size_label"))
    form, variant = dosage_form(form_text, name)

    raw_price = clean(row.get("price(₹)") or row.get("price"))
    try:
        price = Decimal(raw_price) if raw_price else None
    except InvalidOperation:
        price = None
    if price is not None and price <= 0:
        price = None  # a few rows have 0; never treat that as a real price

    return {
        "id": int(row["id"]),
        "name": name,
        "name_norm": normalize_medicine_name(name),
        "manufacturer": clean(row.get("manufacturer_name")) or None,
        "price_2022": price,
        "pack_size_label": clean(row.get("pack_size_label")) or None,
        "pack_quantity": qty,
        "pack_unit": unit,
        "dosage_form": form,
        "form_variant": variant,
        "composition": " + ".join(f"{i['salt']} ({i['strength'] or 'NA'})" for i in ingredients),
        "salt_key": salt_key(ingredients),
        "composition_key": composition_key(ingredients),
        "salt_count": len(ingredients),
        "composition_complete": not (_three_strengths.search(name) or form_text.lower().endswith("kit")),
        "is_discontinued": clean(row.get("Is_discontinued")).upper() == "TRUE",
    }


def read_rows(path: Path):
    # The file is UTF-8 without BOM, CRLF line endings, and some names are quoted because they contain commas.
    with path.open(encoding="utf-8-sig", newline="") as fh:
        yield from csv.DictReader(fh)


def write_csv(rows: list[dict], path: Path) -> None:
    with path.open("w", encoding="utf-8", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=OUTPUT_COLUMNS)
        w.writeheader()
        for r in rows:
            w.writerow({k: ("" if r[k] is None else str(r[k]).lower() if isinstance(r[k], bool) else r[k]) for k in OUTPUT_COLUMNS})


def to_entry(r: dict, ingredients: list[dict]) -> dict:
    """Compact record for Nayan's server-side index (short keys keep the file small)."""
    entry = {
        "b": r["name"],
        "n": r["name_norm"],
        "f": r["dosage_form"],
        "i": [[i["salt"], i["strength"]] for i in ingredients],
    }
    if r["form_variant"]:
        entry["v"] = r["form_variant"]
    if not r["composition_complete"]:
        entry["c"] = 0
    if r["is_discontinued"]:
        entry["d"] = 1
    return entry


def write_index(entries: list[dict], path: Path) -> None:
    payload = json.dumps(
        {"source": DATASET_URL, "license": "CC BY-SA 4.0", "snapshot": "2022-11", "count": len(entries), "medicines": entries},
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")
    # mtime=0 so rebuilding from the same CSV gives a byte-identical file.
    with gzip.GzipFile(filename="", fileobj=path.open("wb"), mode="wb", compresslevel=9, mtime=0) as gz:
        gz.write(payload)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("source", type=Path, help="A_Z_medicines_dataset_of_India.csv from Kaggle")
    ap.add_argument("output", type=Path, nargs="?", default=Path("data/medicines.json.gz"))
    args = ap.parse_args()
    # python -I ignores PYTHONUTF8; without this, a redirected cp1252 stdout crashes on non-ASCII text.
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    entries = []
    forms: Counter = Counter()
    skipped = 0
    for raw in read_rows(args.source):
        r = convert_row(raw)
        ingredients = [i for i in (parse_composition_cell(raw.get("short_composition1")),
                                   parse_composition_cell(raw.get("short_composition2"))) if i]
        if not r["name_norm"] or not ingredients:
            skipped += 1
            continue
        entries.append(to_entry(r, ingredients))
        forms[r["dosage_form"]] += 1
    write_index(entries, args.output)

    print(f"{len(entries)} medicines -> {args.output} ({args.output.stat().st_size / 1e6:.1f} MB)")
    print(f"  skipped (no name or composition): {skipped}")
    print(f"  dosage forms: {dict(forms.most_common())}")
    print(f"  incomplete compositions (3+ salts or kits): {sum(1 for e in entries if e.get('c') == 0)}")
    print(f"  discontinued: {sum(1 for e in entries if e.get('d'))}")


if __name__ == "__main__":
    main()
