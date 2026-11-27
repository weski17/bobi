#!/usr/bin/env python3
"""Structural checks of bobi-deck.pptx without PowerPoint or LibreOffice (Python 3.9+, standard library only):
zip integrity, every XML part parses, every relationship target exists, 20 slides each with speaker notes,
only the fonts and colours of the deck, no secrets in text or notes, and a text dump per slide (--dump)."""
import os
import posixpath
import re
import sys
import zipfile
from xml.dom import minidom

HERE = os.path.dirname(os.path.abspath(__file__))
PATH = sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith("--") else os.path.join(HERE, "bobi-deck.pptx")
problems = []

z = zipfile.ZipFile(PATH)
bad = z.testzip()
if bad:
    problems.append(f"corrupt zip entry: {bad}")
names = set(z.namelist())

docs = {}
for n in names:
    if n.endswith(".xml") or n.endswith(".rels"):
        try:
            docs[n] = minidom.parseString(z.read(n))
        except Exception as e:  # noqa: BLE001
            problems.append(f"{n}: not well-formed XML ({e})")

for n, d in docs.items():
    if not n.endswith(".rels"):
        continue
    base = posixpath.dirname(posixpath.dirname(n))
    for rel in d.getElementsByTagName("Relationship"):
        if rel.getAttribute("TargetMode") == "External":
            continue
        target = rel.getAttribute("Target")
        full = posixpath.normpath(posixpath.join(base, target)) if not target.startswith("/") else target.lstrip("/")
        if full not in names:
            problems.append(f"{n}: missing target {target}")

slides = sorted((n for n in names if re.fullmatch(r"ppt/slides/slide\d+\.xml", n)), key=lambda s: int(re.findall(r"\d+", s)[0]))
notes = sorted(n for n in names if re.fullmatch(r"ppt/notesSlides/notesSlide\d+\.xml", n))
if len(slides) != 20:
    problems.append(f"expected 20 slides, found {len(slides)}")
if len(notes) != len(slides):
    problems.append(f"{len(notes)} notes pages for {len(slides)} slides")


def texts(doc):
    return ["".join(t.firstChild.data if t.firstChild else "" for t in p.getElementsByTagName("a:t")) for p in doc.getElementsByTagName("a:p")]


fonts, colours = set(), set()
for s in slides:
    xml = z.read(s).decode("utf8")
    fonts.update(re.findall(r'typeface="([^"]+)"', xml))
    colours.update(re.findall(r'srgbClr val="([0-9A-Fa-f]{6})"', xml))
    if re.search(r'srgbClr val="#', xml):
        problems.append(f"{s}: colour with #")

allowed_fonts = {"Arial", "Courier New"}
extra = {f for f in fonts if f not in allowed_fonts and not f.startswith("+")}
if extra:
    problems.append(f"unexpected fonts: {sorted(extra)}")

# Secrets: never the demo password, never obvious key material.
secret_values = []
env = os.path.expanduser("~/.bobi-demo.env")
if os.path.exists(env):
    for line in open(env):
        if line.startswith("DEMO_PASSWORD="):
            secret_values.append(line.split("=", 1)[1].strip())
blob = " ".join(" ".join(texts(docs[n])) for n in list(slides) + notes if n in docs)
for value in secret_values:
    if value and value in blob:
        problems.append("the demo password appears in the deck text")
if re.search(r"BEGIN [A-Z ]*PRIVATE KEY|sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}", blob):
    problems.append("key-like text found")
for n in names:
    if n.startswith("ppt/media/") or n.startswith("docProps/"):
        data = z.read(n)
        for value in secret_values:
            if value and value.encode() in data:
                problems.append(f"the demo password appears in {n}")

print(f"slides: {len(slides)}, notes: {len(notes)}, media: {sum(1 for n in names if n.startswith('ppt/media/'))}, fonts: {sorted(fonts)}")
if "--dump" in sys.argv:
    for i, s in enumerate(slides, 1):
        print(f"\n--- Folie {i}")
        for t in texts(docs[s]):
            if t.strip():
                print("  ", t)
        nn = f"ppt/notesSlides/notesSlide{i}.xml"
        if nn in docs:
            print("   [Notiz]", " ".join(t for t in texts(docs[nn]) if t.strip() and not t.strip().isdigit()))

if problems:
    print("PROBLEMS:")
    for p in problems:
        print(" -", p)
    sys.exit(1)
print("ok: no structural problems found")
