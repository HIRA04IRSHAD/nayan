"""Importer tests using real rows from the Kaggle file (copied verbatim, including odd spacing, quotes and a TAB).

Run from the nayan folder:  python -I -m unittest discover -s data/tests
"""

import csv
import io
import sys
import tempfile
import unittest
from decimal import Decimal
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(DATA))

from build_drugdb import convert_row, dosage_form, parse_composition_cell, parse_pack, read_rows, write_csv  # noqa: E402

HEADER = "id,name,price(₹),Is_discontinued,manufacturer_name,type,pack_size_label,short_composition1,short_composition2"
# Exact bytes as in the dataset: CRLF endings, quoted names, trailing/leading spaces inside compositions.
SAMPLE = "\r\n".join([
    HEADER,
    "1,Augmentin 625 Duo Tablet,223.42,FALSE,Glaxo SmithKline Pharmaceuticals Ltd,allopathy,strip of 10 tablets,Amoxycillin  (500mg) ,  Clavulanic Acid (125mg)",
    "3,Ascoril LS Syrup,118,FALSE,Glenmark Pharmaceuticals Ltd,allopathy,bottle of 100 ml Syrup,Ambroxol (30mg/5ml) , Levosalbutamol (1mg/5ml) ",
    "23,Altraday Capsule SR,128,FALSE,Sun Pharmaceutical Industries Ltd,allopathy,strip of 10 capsule sr,Aceclofenac (200mg) , Rabeprazole (20mg)",
    "26,Asthalin 100mcg Inhaler,157.85,FALSE,Cipla Ltd,allopathy,packet of 200 MDI Inhaler,Salbutamol (100mcg),",
    "13,Anovate Cream,134.2,FALSE,USV Ltd,allopathy,tube of 20 gm Cream,Phenylephrine (0.10% w/w) , Beclometasone (0.025% w/w) ",
    "150,Adrenaline Tartrate Injection,14.52,FALSE,Harson Laboratories,allopathy,vial of 1 ml Injection,Adrenaline (NA),",
    "95826,Gembin 1gm Injection,2660.12,FALSE,Biochem Pharmaceutical Industries,allopathy,vial of 1 Injection,Gemcitabine (1gm),",
    "32,Atarax Syrup,110.25,TRUE,Dr Reddy's Laboratories Ltd,allopathy,bottle of 100 ml Syrup,Hydroxyzine (10mg),",
    "253963,Zestrain 100mg/325mg/250mg Tablet MR,70,FALSE,Vesnik Molecules,allopathy,strip of 10 tablet mr,Aceclofenac (100mg) , Paracetamol (325mg) ",
    '12268,"Albacof-D Syrup No Alcohol, Sugar Free",85,FALSE,Aeon Pharma Pvt Ltd,allopathy,bottle of 100 ml Syrup,Phenylephrine (5mg/5ml) , Chlorpheniramine Maleate (2mg/5ml) ',
    '40054,"Cetrezol L\t Forte 10mg Tablet",77,FALSE,East West Pharma,allopathy,strip of 10 tablets,Levocetirizine (10mg),',
    "67,Akt 4 Kit,24.7,FALSE,Lupin Ltd,allopathy,packet of 1 Kit,Isoniazid (300mg) , Rifampicin (450mg) ",
    "99,Zero Price Tablet,0,FALSE,Test,allopathy,strip of 10 tablets,Paracetamol (500mg),",
]) + "\r\n"


def rows_by_id():
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "sample.csv"
        path.write_bytes(SAMPLE.encode("utf-8"))
        return {r["id"]: r for r in (convert_row(x) for x in read_rows(path))}


class ParseCells(unittest.TestCase):
    def test_composition_cell(self):
        self.assertEqual(parse_composition_cell("Amoxycillin  (500mg) "), {"salt": "Amoxycillin", "strength": "500mg"})
        self.assertEqual(parse_composition_cell("  Clavulanic Acid (125mg)"), {"salt": "Clavulanic Acid", "strength": "125mg"})
        self.assertEqual(parse_composition_cell("Adrenaline (NA)"), {"salt": "Adrenaline", "strength": None})
        self.assertEqual(
            parse_composition_cell("Vitamin B12 (Methylcobalamin) (500mcg)"),
            {"salt": "Vitamin B12 (Methylcobalamin)", "strength": "500mcg"},
        )
        self.assertIsNone(parse_composition_cell(""))
        self.assertIsNone(parse_composition_cell(None))

    def test_pack(self):
        self.assertEqual(parse_pack("strip of 10 tablets")[:2], (Decimal("10"), "tablet"))
        self.assertEqual(parse_pack("bottle of 100 ml Syrup")[:2], (Decimal("100"), "ml"))
        self.assertEqual(parse_pack("tube of 20 gm Cream")[:2], (Decimal("20"), "g"))
        self.assertEqual(parse_pack("packet of 200 MDI Inhaler")[:2], (Decimal("200"), "dose"))
        self.assertEqual(parse_pack("vial of 1 Injection")[:2], (Decimal("1"), "unit"))
        self.assertEqual(parse_pack("packet of 2.5 ml Respules")[:2], (Decimal("2.5"), "ml"))
        self.assertEqual(parse_pack("weird label")[:2], (None, None))
        self.assertEqual(parse_pack("pre-filled pen of 3 ml Solution for Injection")[:2], (Decimal("3"), "ml"))
        self.assertEqual(parse_pack("Roll-on bottle of 50 gm Gel")[:2], (Decimal("50"), "g"))
        self.assertEqual(parse_pack("bottle of 1 Ltr Solution")[:2], (Decimal("1000"), "ml"))


class DosageForms(unittest.TestCase):
    def test_liquids_that_are_syrups(self):
        for label in ("Expectorant", "Linctus", "Oral Liquid", "Liquid"):
            with self.subTest(label=label):
                self.assertEqual(dosage_form(label, "x")[0], "syrup")
        self.assertEqual(dosage_form("Oral Solution", "x")[0], "solution")
        self.assertEqual(dosage_form("Granules", "x")[0], "powder")


class ConvertRows(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.rows = rows_by_id()

    def test_reads_every_row(self):
        self.assertEqual(len(self.rows), 13)

    def test_combination_tablet(self):
        r = self.rows[1]
        self.assertEqual(r["name_norm"], "augmentin 625 duo")
        self.assertEqual(r["salt_key"], "amoxicillin+clavulanic acid")
        self.assertEqual(r["composition_key"], "amoxicillin:500mg+clavulanic acid:125mg")
        self.assertEqual((r["dosage_form"], r["form_variant"], r["pack_quantity"], r["pack_unit"]), ("tablet", None, Decimal("10"), "tablet"))
        self.assertEqual(r["price_2022"], Decimal("223.42"))
        self.assertEqual(r["salt_count"], 2)
        self.assertTrue(r["composition_complete"])
        self.assertFalse(r["is_discontinued"])

    def test_syrup_is_priced_per_ml(self):
        r = self.rows[3]
        self.assertEqual((r["dosage_form"], r["pack_quantity"], r["pack_unit"]), ("syrup", Decimal("100"), "ml"))
        self.assertEqual(r["composition_key"], "ambroxol:30mg/5ml+levosalbutamol:1mg/5ml")

    def test_release_type_is_kept(self):
        self.assertEqual((self.rows[23]["dosage_form"], self.rows[23]["form_variant"]), ("capsule", "sr"))
        self.assertEqual((self.rows[253963]["dosage_form"], self.rows[253963]["form_variant"]), ("tablet", "mr"))

    def test_other_forms(self):
        self.assertEqual(self.rows[26]["dosage_form"], "inhaler")
        self.assertEqual(self.rows[26]["composition_key"], "salbutamol:0.1mg")
        self.assertEqual(self.rows[13]["dosage_form"], "cream")
        self.assertEqual(self.rows[13]["composition_key"], "beclometasone:0.025%w/w+phenylephrine:0.1%w/w")
        self.assertEqual(self.rows[150]["composition_key"], "adrenaline:?")
        self.assertEqual(self.rows[95826]["composition_key"], "gemcitabine:1000mg")
        self.assertEqual(self.rows[95826]["pack_unit"], "unit")

    def test_quoted_names_and_tabs(self):
        self.assertEqual(self.rows[12268]["name"], "Albacof-D Syrup No Alcohol, Sugar Free")
        self.assertEqual(self.rows[40054]["name"], "Cetrezol L Forte 10mg Tablet")
        self.assertEqual(self.rows[40054]["name_norm"], "cetrezol l forte 10")

    def test_flags(self):
        self.assertTrue(self.rows[32]["is_discontinued"])
        self.assertFalse(self.rows[253963]["composition_complete"], "3 strengths in the name but only 2 salts")
        self.assertFalse(self.rows[67]["composition_complete"], "kits list only 2 of their drugs")
        self.assertIsNone(self.rows[99]["price_2022"], "a price of 0 is not a real price")

    def test_output_csv(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "out.csv"
            write_csv(list(self.rows.values()), out)
            text = out.read_text(encoding="utf-8")
        rows = list(csv.DictReader(io.StringIO(text)))
        self.assertEqual(len(rows), 13)
        first = next(r for r in rows if r["id"] == "1")
        self.assertEqual(first["is_discontinued"], "false")
        self.assertEqual(first["composition_complete"], "true")
        self.assertEqual(first["form_variant"], "")


if __name__ == "__main__":
    unittest.main()
