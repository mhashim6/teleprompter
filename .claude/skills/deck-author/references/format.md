# Reference: the `.deck.md` format and source ingestion

## The `.deck.md` authoring format

This is the contract between you (the agent) and `tools/deck.js`. Write the
file, then compile it. The compiler is tolerant but predictable.

```markdown
---
title: My Talk
id: my-talk            # optional; defaults to slug(title). Stable id => recompiles update in place.
section: Module 3      # optional, informational
slideRange: 1-6        # optional; else derived from slide numbers
voice: conversational  # optional, informational
language: en-GB        # optional
---

## 1 · Slide Title
type: content
on-screen: What the audience sees on the slide
target: 3

First narration paragraph. Speak it as one beat. [[pause]]

Second paragraph, a longer hold before the reveal. [[pause:1.5]]

## 2 · Next Slide
type: section-divider
on-screen: "A quoted cue"
target: 2

The narration for slide two.
```

### Rules

- **Frontmatter** is the `--- … ---` block at the very top: flat `key: value`
  lines only (no nesting). Whole-line `#` comments and trailing ` # comment`
  after a value are stripped. Keys consumed: `title`, `id`, `section`,
  `slideRange`, `voice`, `language`.
- **A slide starts** at a `##` heading. Accepted forms:
  `## 1 · Title`, `## 1: Title`, `## 1. Title`, `## 1 - Title`, or `## Title`
  (no number → auto-indexed from position). A heading whose text merely *starts*
  with digits (e.g. `## 2024 Review`) is treated as a title, not a number.
- **Directives** are optional lines directly under the heading, before any blank
  line: `type:`, `on-screen:` (alias `onscreen`), and `target:` (estimated
  minutes, a number). The first blank line or non-directive line ends the
  directive block; everything after is narration.
- **Narration** is the rest of the slide block. Paragraphs are separated by blank
  lines; soft-wrapped lines inside a paragraph are joined with a single space, so
  wrap freely. Inline `[[pause]]` / `[[pause:N]]` / `[[pause:Nms]]` / `[[beat]]`
  beats are preserved verbatim.

### Pause beats (timing)

- `[[pause]]` = 1000 ms, `[[pause:1.5]]` = 1.5 s, `[[pause:500ms]]` = 500 ms,
  `[[beat]]` = alias for `[[pause]]`.
- Pauses are **absolute** time — they do **not** scale with reading pace. They
  are excluded from word counts and never spoken. Spend them deliberately.

## Compiling

```
node tools/deck.js decks/<slug>.deck.md [--wpm 130] [--out file.json] [--fill-beats]
```

- Writes `decks/<slug>.json` (default: input path with the extension swapped to
  `.json`) and prints the duration report.
- `--wpm` sets the reference pace for the report (default 130). Report it at the
  pace the user actually reads.
- `--fill-beats` (opt-in) appends a `[[pause]]` to paragraphs that lack a
  trailing beat, except a slide's last paragraph, and never duplicates one.

Reading the report: each row is `number  m:ss  words  pauses(+added s)  title`
followed, when a `target` is set, by `[target m:ss, ±delta]` and an
`(implied N wpm out of 60-220)` warning when the slide's words/target pace falls
outside the slider range — a sign the slide is too dense or too thin for its
target.

## Extracting a `.pptx` (generate, run, inspect, delete — do not commit)

PowerPoint files are zip archives of XML. Use this dependency-free `python3`
stdlib extractor. Write it to a temp path (e.g. under the job tmp dir), run it,
read the JSON it prints, confirm it looks right, then remove the script.

```python
# pptx_extract.py — print per-slide text + speaker notes from a .pptx (stdlib only)
import sys, json, zipfile, re
import xml.etree.ElementTree as ET

T = "{http://schemas.openxmlformats.org/drawingml/2006/main}t"  # <a:t> text runs

# Office Open XML parts never declare a DOCTYPE or entities. Reject any that do
# before parsing — this is the stdlib-only defence against XXE / billion-laughs
# entity-expansion attacks (ElementTree/expat would otherwise be vulnerable).
# Avoids adding a defusedxml dependency, keeping the extractor dependency-free.
def texts(xml_bytes):
    if b"<!DOCTYPE" in xml_bytes or b"<!ENTITY" in xml_bytes:
        raise ValueError("refusing XML with a DOCTYPE/ENTITY declaration")
    root = ET.fromstring(xml_bytes)
    return [e.text for e in root.iter(T) if e.text and e.text.strip()]

def num(name):  # ".../slide12.xml" -> 12, for ordering
    m = re.search(r"(\d+)\.xml$", name)
    return int(m.group(1)) if m else 0

with zipfile.ZipFile(sys.argv[1]) as z:
    names = z.namelist()
    slides = sorted((n for n in names if re.match(r"ppt/slides/slide\d+\.xml$", n)), key=num)
    out = []
    for s in slides:
        sn = num(s)
        body = " ".join(texts(z.read(s)))
        notes = ""
        # find this slide's notesSlide via its rels (correct pairing)
        rels = "ppt/slides/_rels/%s.rels" % s.split("/")[-1]
        if rels in names:
            for m in re.finditer(r'Target="([^"]*notesSlide\d+\.xml)"', z.read(rels).decode("utf-8", "ignore")):
                tgt = "ppt/" + m.group(1).replace("../", "")
                if tgt in names:
                    notes = " ".join(texts(z.read(tgt)))
        out.append({"number": sn, "text": body, "notes": notes})
    print(json.dumps(out, ensure_ascii=False, indent=2))
```

Run: `python3 pptx_extract.py deck.pptx`. Each entry gives the slide's on-slide
text and its speaker notes. Draft narration primarily from `notes`, using `text`
for the `on-screen` cue and titles. Delete the script when done.
