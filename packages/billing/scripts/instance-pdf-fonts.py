#!/usr/bin/env python3
"""Derives the static font instances that server-generated PDFs embed.

Chromium cannot embed a *variable* font in a PDF: SkPDF falls back to Type 3
glyph procedures (one font object per text run, encoding "Custom", no text
extraction), which is the rough print the bundled fonts were meant to fix. A
static instance of the same font is embedded as a subset CID TrueType. So the
app's variable Inter / JetBrains Mono are pinned here to the weights the
document templates ask for, and packages/billing/src/lib/pdf-fonts inlines the
results.

Inputs:  server/src/app/fonts/{InterVariable,InterVariable-Italic,JetBrainsMono}.woff2
Outputs: server/src/app/fonts/pdf/*.woff2  (checked in; nothing builds them in CI)

The instances inherit their sources' SIL Open Font License 1.1 — see
server/src/app/fonts/LICENSE-Inter.txt and LICENSE-JetBrainsMono.txt.

Needs fontTools:
    python3 -m venv /tmp/fonttools-venv
    /tmp/fonttools-venv/bin/pip install fonttools brotli
    /tmp/fonttools-venv/bin/python packages/billing/scripts/instance-pdf-fonts.py

Re-run after changing a font binary, then regenerate the inlined CSS with
`npm run generate:pdf-fonts --prefix packages/billing`.
"""
from pathlib import Path

from fontTools import ttLib
from fontTools.varLib import instancer

REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
FONT_DIRECTORY = REPOSITORY_ROOT / "server/src/app/fonts"
OUTPUT_DIRECTORY = FONT_DIRECTORY / "pdf"

# (source, output stem, family, style name, pinned axes). The weights are the ones the
# renderers and the repo-owned templates use: 400 body, 600 table headers, 700 headings,
# 800 label identifiers (mono). CSS font matching maps anything else to the nearest of these.
INSTANCES = [
    ("InterVariable.woff2", "Inter-Regular", "Inter", "Regular", {"opsz": 14, "wght": 400}),
    ("InterVariable.woff2", "Inter-SemiBold", "Inter", "SemiBold", {"opsz": 14, "wght": 600}),
    ("InterVariable.woff2", "Inter-Bold", "Inter", "Bold", {"opsz": 14, "wght": 700}),
    ("InterVariable-Italic.woff2", "Inter-Italic", "Inter", "Italic", {"opsz": 14, "wght": 400}),
    ("JetBrainsMono.woff2", "JetBrainsMono-Regular", "JetBrains Mono", "Regular", {"wght": 400}),
    ("JetBrainsMono.woff2", "JetBrainsMono-ExtraBold", "JetBrains Mono", "ExtraBold", {"wght": 800}),
]


def rename(font: ttLib.TTFont, family: str, style: str, postscript_name: str) -> None:
    """A PDF reports the embedded font's PostScript name, so the instances say what they are."""
    name = font["name"]
    for name_id, value in (
        (1, family if style in ("Regular", "Bold", "Italic") else f"{family} {style}"),
        (2, "Italic" if style == "Italic" else "Regular" if style != "Bold" else "Bold"),
        (4, f"{family} {style}"),
        (6, postscript_name),
        (16, family),
        (17, style),
    ):
        # Every platform record, not just the Windows one: readers (and the PDF
        # writer) pick whichever they find first.
        platforms = {(r.platformID, r.platEncID, r.langID) for r in name.names if r.nameID == name_id}
        for platform_id, encoding_id, language_id in platforms | {(3, 1, 0x409)}:
            name.setName(value, name_id, platform_id, encoding_id, language_id)


def main() -> None:
    OUTPUT_DIRECTORY.mkdir(parents=True, exist_ok=True)
    for source, stem, family, style, axes in INSTANCES:
        font = ttLib.TTFont(FONT_DIRECTORY / source)
        instancer.instantiateVariableFont(font, axes, inplace=True, updateFontNames=False)
        rename(font, family, style, stem)
        output = OUTPUT_DIRECTORY / f"{stem}.woff2"
        font.flavor = "woff2"
        font.save(output)
        print(f"{output.relative_to(REPOSITORY_ROOT)} ({output.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
