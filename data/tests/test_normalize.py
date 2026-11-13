"""Python side of the shared normalisation cases (the TypeScript side is lib/normalize.shared.test.ts).

Run from the nayan folder:  python -I -m unittest discover -s data/tests
"""

import json
import sys
import unittest
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(DATA))

from nayan_normalize import (  # noqa: E402
    canonical_strength,
    composition_key,
    normalize_brand,
    normalize_medicine_name,
    normalize_salt,
    salt_key,
)

CASES = json.loads((DATA / "normalize_cases.json").read_text(encoding="utf-8"))


class SharedCases(unittest.TestCase):
    def test_salt(self):
        for raw, out in CASES["salt"]:
            with self.subTest(raw=raw):
                self.assertEqual(normalize_salt(raw), out)

    def test_brand(self):
        for raw, out in CASES["brand"]:
            with self.subTest(raw=raw):
                self.assertEqual(normalize_brand(raw), out)

    def test_medicine_name(self):
        for raw, out in CASES["medicine_name"]:
            with self.subTest(raw=raw):
                self.assertEqual(normalize_medicine_name(raw), out)

    def test_strength(self):
        for raw, out in CASES["strength"]:
            with self.subTest(raw=raw):
                self.assertEqual(canonical_strength(raw), out)

    def test_composition(self):
        for case in CASES["composition"]:
            with self.subTest(key=case["composition_key"]):
                self.assertEqual(salt_key(case["ingredients"]), case["salt_key"])
                self.assertEqual(composition_key(case["ingredients"]), case["composition_key"])


if __name__ == "__main__":
    unittest.main()
