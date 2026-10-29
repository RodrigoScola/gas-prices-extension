"""Turn the "Siemens FTL Fuel Surcharge Scale" PDF into the .xlsx the extension reads.

    pip install pypdf openpyxl
    python scripts/fuel-scale-pdf-to-xlsx.py "private/Siemens FTL Fuel Surcharge Scale 2026.pdf"

Writes the .xlsx next to the PDF (same name): one row per diesel price bracket, with
Diesel From, Diesel To (blank on the last, "& Above" row) and Surcharge Per Mile.
"""
import re
import sys
from pathlib import Path

from openpyxl import Workbook
from pypdf import PdfReader

BRACKET = re.compile(r"\$(\d+\.\d{3})\s+\$(\d+\.\d{3})\s+\$(\d+\.\d{2})")
TOP = re.compile(r"\$(\d+\.\d{3})\s*&\s*Above\s+\$(\d+\.\d{2})", re.I)


def read_brackets(pdf):
    text = "\n".join(page.extract_text() or "" for page in PdfReader(pdf).pages)
    rows = [(float(a), float(b), float(c)) for a, b, c in BRACKET.findall(text)]
    rows += [(float(a), None, float(c)) for a, c in TOP.findall(text)]
    rows.sort(key=lambda r: r[0])
    if not rows:
        sys.exit(f"No price brackets found in {pdf}.")
    # Each bracket must start right after the one before it, or the PDF was misread.
    for prev, cur in zip(rows, rows[1:]):
        if prev[1] is None or round(cur[0] - prev[1], 3) != 0.001:
            sys.exit(f"Gap or overlap between ${prev[0]:.3f} and ${cur[0]:.3f}; check the PDF text.")
    return rows


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    pdf = Path(sys.argv[1])
    rows = read_brackets(pdf)
    wb = Workbook()
    ws = wb.active
    ws.title = "Fuel Surcharge Scale"
    ws.append(["Diesel From", "Diesel To", "Surcharge Per Mile"])
    for row in rows:
        ws.append(list(row))
    out = pdf.with_suffix(".xlsx")
    wb.save(out)
    print(f"{len(rows)} brackets, ${rows[0][0]:.3f} to ${rows[-1][0]:.3f} and above -> {out}")


if __name__ == "__main__":
    main()
