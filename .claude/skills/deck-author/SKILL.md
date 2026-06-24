---
name: deck-author
description: >-
  Author a teleprompter deck from raw source material — a PowerPoint (.pptx),
  PDF, screenshots/images, or pasted text/notes. Use this when the user asks to
  "author a deck", "make a teleprompter from this PPT / these slides / these
  notes", "turn this deck into a teleprompter script", "write the narration for
  my slides", or "build a teleprompter deck". Interviews the user, drafts the
  spoken narration with smart pause beats, compiles it to the deck JSON via
  tools/deck.js, and confirms the expected duration and metadata before handing
  off decks/<slug>.json.
user-invocable: true
argument-hint: '[path to a .pptx / .pdf / image, or describe the source]'
---

# Author a teleprompter deck

Turn raw source material into a finished, well-timed teleprompter deck. You (the
agent) do the soft work — interview, ingest, write the prose, place rhetorical
pauses. A deterministic committed tool (`tools/deck.js`) does the hard contract
work — parse, count words, estimate exact duration, assemble the JSON, stamp a
stable id. Never hand-write the deck JSON; always compile it through the tool so
the contract and the duration report are machine-guaranteed.

Read `references/format.md` for the exact `.deck.md` authoring format and the
pptx-extraction recipe before you start writing.

## Workflow

### 1. Gather the source

Ask what the source is, then ingest it:

- **Pasted text / notes** — use it directly.
- **Images / screenshots** — read the image files yourself (vision). No script.
- **PDF** — read it yourself with the Read tool (native PDF support). No script.
- **PowerPoint (.pptx)** — generate a throwaway `python3` stdlib extractor on the
  user's machine (see `references/format.md` → "Extracting a .pptx"), run it to
  capture per-slide text **and speaker notes**, inspect the output to confirm it
  looks right, then delete the extractor. Do not commit it.

Speaker notes are the best raw material for narration — prefer them over the
on-slide bullets when both exist.

### 2. Confirm intent and metadata (ask, do not assume)

Propose a per-slide skeleton from the source — number, title, `type`
(e.g. `content`, `section-divider`), the `on-screen` cue (what the audience sees),
and a rough `target` minutes per slide — and confirm it. Also ask:

- **Total target duration** for the talk (drives per-slide targets).
- **Audience / purpose** (tunes register and depth).
- **Speaking style / voice.** Offer the user's own `blacktree-voice` skill if they
  want it in their personal blog voice, or a register: conversational, formal,
  energetic, or neutral. Apply that voice when you draft.
- **Language** (default en-GB to match the repo's existing decks).

Use `AskUserQuestion` for these branching choices rather than guessing.

### 3. Draft the narration

Write the spoken script per slide in the chosen voice. Place pause beats where
the rhetoric calls for them — after a reveal, before a list, at a hard topic
change — using `[[pause]]` (1s) or `[[pause:1.5]]` (custom). This semantic
placement is *your* job; the tool only validates and reports.

Write it all to `decks/<slug>.deck.md` in the format from `references/format.md`.
Keep each paragraph as one logical beat (the tool collapses soft wrapping).

### 4. Compile

```
node tools/deck.js decks/<slug>.deck.md --wpm 130
```

This writes `decks/<slug>.json` and prints a duration report: per slide the
words, pause count and added seconds, estimated `m:ss` at the reference pace, the
implied wpm vs the 60–220 range, and the delta against each slide's target; plus
the deck total. Use `--wpm <n>` to report at the pace the user actually reads at.

Optional: `--fill-beats` inserts a structural `[[pause]]` at paragraph ends that
lack one (never the last paragraph of a slide, never duplicating an existing
beat). Off by default — only use it if the user wants automatic breathing room
on top of your authored beats.

### 5. Confirm duration and iterate

Show the user the report. If a slide runs over or under its target, revise the
prose (tighten or expand) or adjust pauses, then recompile. Repeat until the
timing fits. The deck id is stable (seeded from the title / `meta.id`), so
recompiling updates the same deck in place rather than spawning duplicates.

### 6. Hand off

Confirm the final deck and tell the user:

- The compiled deck is at `decks/<slug>.json`; the editable source is
  `decks/<slug>.deck.md` (re-runnable any time).
- To use it: open the app → menu (bottom-right) → **choose file** and pick the
  JSON, or drag the `.json` onto the drop zone. `decks/` is **not** auto-listed,
  so it must be loaded once; thereafter it persists on that device and remembers
  its position.

## Guardrails

- The deck JSON is always produced by `tools/deck.js`, never typed by hand.
- All deck text reaches the app via `textContent`/`.value`; still, keep scripts
  free of control characters (the tool and `Schema` sanitise, but stay clean).
- Don't commit the pptx extractor; generate, run, inspect, delete.
- Pause beats are absolute time (not pace-scaled); spend them deliberately.
