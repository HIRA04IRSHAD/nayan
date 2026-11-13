"""Python twin of lib/normalize.ts.

data/build_drugdb.py builds medicine-name keys with these functions and the app looks names up with the
TypeScript versions. Both are tested against data/normalize_cases.json, so the keys always match.
Change one side only together with the other.
"""

from __future__ import annotations

import math
import re
import unicodedata

PHARMACOPOEIA = {"ip", "bp", "usp", "ph", "eur"}

# Trailing salt-form words that do not change the active moiety as labelled in India.
# Deliberately conservative: succinate/tartrate etc. are NOT stripped because they are different products.
SALT_FORM_SUFFIXES = {
    "hydrochloride", "hcl", "sodium", "potassium", "besylate", "besilate",
    "calcium", "magnesium", "monohydrate", "dihydrate", "trihydrate",
}

SALT_SYNONYMS = {
    "acetaminophen": "paracetamol",
    "thyroxine": "levothyroxine",
    "amoxycillin": "amoxicillin",
    "clavulanate": "clavulanic acid",
    "potassium clavulanate": "clavulanic acid",
    "diluted potassium clavulanate": "clavulanic acid",
    "acetylsalicylic acid": "aspirin",
    "albuterol": "salbutamol",
    "vitamin d3": "cholecalciferol",
}

MASS_TO_MG = {"mg": 1, "g": 1000, "gm": 1000, "mcg": 0.001, "ug": 0.001, "µg": 0.001}

FORM_WORDS = {
    "tab", "tabs", "tablet", "tablets", "cap", "caps", "capsule", "capsules", "syp", "syrup", "inj", "injection",
    "susp", "suspension", "cream", "gel", "oint", "ointment", "drop", "drops", "lotion", "sachet",
}
BRAND_PREFIXES = {"tab", "tablet", "cap", "capsule", "syp", "syrup", "inj"}


def _words(s: str) -> list[str]:
    # NFKC turns ligatures like "ﬁ" into "fi" and odd hyphens/spaces into plain ones (seen in the Kaggle file).
    s = unicodedata.normalize("NFKC", s).lower().replace(".", "")
    s = re.sub(r"[^a-z0-9\s]", " ", s)
    return s.split()


# "Pantoprazole Sodium IP eq. to Pantoprazole": the part after "eq. to" is the active moiety.
EQUIVALENT_TO = re.compile(r"\b(?:eq(?:uivalent|uiv)?\.?\s*to|eqv\.?\s*to)\b", re.I)


def normalize_salt(raw: str) -> str:
    parts = EQUIVALENT_TO.split(raw)
    active = parts[-1] if len(parts) > 1 and parts[-1].strip() else raw
    w = [x for x in _words(active) if x not in PHARMACOPOEIA]
    joined = " ".join(w)
    if joined in SALT_SYNONYMS:
        return SALT_SYNONYMS[joined]
    while len(w) > 1 and w[-1] in SALT_FORM_SUFFIXES:
        w = w[:-1]
    name = " ".join(w)
    return SALT_SYNONYMS.get(name, name)


def format_number(n: float) -> str:
    """Same as formatNumber() in TypeScript: 650 → "650", 0.05 → "0.05"."""
    s = f"{n:.6f}"
    return s.rstrip("0").rstrip(".") if "." in s else s


def _round6(n: float) -> float:
    # Mirrors JavaScript Math.round (half up) rather than Python's banker's rounding.
    return math.floor(n * 1e6 + 0.5) / 1e6


def parse_strength(raw: str | None) -> tuple[float, str | None] | None:
    if not raw:
        return None
    compact = re.sub(r"\s+", "", unicodedata.normalize("NFKC", raw).lower()).replace(",", "")
    compact = re.sub(r"i\.u\.?", "iu", compact)                    # "75 I.U." → "75iu"
    compact = re.sub(r"^(\d+(?:\.\d+)?)miu$", r"\1millioniu", compact)  # "3miu" = 3 million IU
    q = re.search(r"%(w/w|w/v|v/v)$", compact)
    qualifier = q.group(1) if q else None
    if qualifier:
        compact = compact[: -len(qualifier)]
    big = re.fullmatch(r"(\d+(?:\.\d+)?)(million|billion)(.*)", compact)
    if big:
        factor = 1e6 if big.group(2) == "million" else 1e9
        compact = f"{format_number(float(big.group(1)) * factor)}{big.group(3)}"
    first, *rest = compact.split("/")
    m = re.fullmatch(r"(\d+(?:\.\d+)?)(mg|mcg|µg|ug|gm|g|ml|iu|units?|%)?", first)
    if not m:
        return None
    num = float(m.group(1))
    unit = m.group(2)
    if unit and unit in MASS_TO_MG:
        num = num * MASS_TO_MG[unit]
        unit = "mg"
    elif unit in ("unit", "units"):
        unit = "iu"
    num = _round6(num)
    if rest:
        unit = f"{unit or ''}/{'/'.join(rest)}"
    if qualifier and unit == "%":
        unit = f"%{qualifier}"
    return num, unit


def canonical_strength(raw: str | None) -> str:
    s = parse_strength(raw)
    return f"{format_number(s[0])}{s[1] or ''}" if s else "?"


def salt_key(ingredients: list[dict]) -> str:
    return "+".join(sorted({normalize_salt(i["salt"]) for i in ingredients} - {""}))


def composition_key(ingredients: list[dict]) -> str:
    parts = set()
    for i in ingredients:
        salt = normalize_salt(i["salt"])
        if salt:
            parts.add(f"{salt}:{canonical_strength(i.get('strength'))}")
    return "+".join(sorted(parts))


def _split_letters_digits(raw: str) -> str:
    raw = re.sub(r"([a-zA-Z])([0-9])", r"\1 \2", raw)
    return re.sub(r"([0-9])([a-zA-Z])", r"\1 \2", raw)


def normalize_brand(raw: str) -> str:
    w = _words(_split_letters_digits(raw))
    return " ".join(x for i, x in enumerate(w) if not (i == 0 and x in BRAND_PREFIXES))


UNIT_WORDS = {"mg", "mcg", "gm", "g", "ml", "iu"}


def normalize_medicine_name(raw: str) -> str:
    """Same as normalizeMedicineName(): keeps decimals ("12.5" never becomes "125"), drops a unit after a number."""
    tokens = re.findall(r"[0-9]+(?:\.[0-9]+)?|[a-z]+", unicodedata.normalize("NFKC", raw).lower())
    out: list[str] = []
    for t in tokens:
        if t in FORM_WORDS:
            continue
        if t in UNIT_WORDS and out and out[-1][0].isdigit():
            continue
        out.append(t)
    return " ".join(out)
