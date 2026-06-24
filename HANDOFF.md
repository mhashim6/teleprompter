# Teleprompter: handoff spec

A self-contained brief for continuing this work in another session, with another agent, or in Claude Code. An agent with this document and the repo should be able to extend the app without re-reading the original conversation.

## 1. What this is

A small, dependency-free teleprompter. It loads a JSON deck of presentation slides, each carrying a spoken-word script, and plays the script back word by word at a configurable pace. The word under the reading head is highlighted in an accent colour; text ahead stays readable; already-read text fades back. The deck author can insert pause beats. The app has day and night themes, adjustable pace and font size, a mirror mode for beam-splitter glass, and per-deck persistence so each deck remembers where you left off.

It is a prototype, now split into a small repo of plain HTML, CSS, and JavaScript with no build step. There is no speech recognition; timing is open-loop (section 10).

## 2. Repo layout

```
index.html          markup + font links + stylesheet link + ordered <script> tags
styles.css          design tokens, layout, the Timeless texture surface
src/constants.js    Const: frozen tunables (clamp bounds, pace multipliers, intervals) (pure)
src/schema.js       Schema: tolerant JSON normaliser (pure)
src/engine.js       Engine: pure timing core (token durations, cumulative totals, pace math)
src/store.js        Store: localStorage wrapper with an in-memory fallback + error sink
src/prompter.js     Prompter: playback shell over Engine (state, timer, callbacks)
src/viewmodel.js    ViewModel: pure render decisions (token classes, clock text, meta, hints)
src/studio.js       Studio: pure deck-editor core (build/reorder/serialise/estimate)
src/welcome.js      Welcome: pure data — TP.Welcome.RAW, the landing-session deck
src/ui.js           UI: all DOM (rendering, controls, keyboard) — the imperative shell
src/studio-ui.js    StudioUI: the deck-editor overlay (DOM shell over Studio)
src/app.js          boot
test/               node:test suites for the pure modules + the prompter shell
assets/             noise.png (day grain), noise-light.png (night grain)
decks/              sample deck JSON (+ <slug>.deck.md authoring sources)
tools/              build_teleprompter.py (legacy sample generator);
                    deck.js (.deck.md -> deck JSON compiler + duration report)
.claude/skills/     deck-author/ — the agent skill that authors a deck from a
                    PPT / PDF / screenshots / text (drives tools/deck.js)
README.md           quick start
HANDOFF.md          this file

favicon.svg         site icon (the §+t mark, dark-UI adaptive) — source for the PNG icons
favicon-16/32.png   classic favicon fallbacks   apple-touch-icon.png  iOS home-screen icon
icon-192/512.png    PWA manifest icons (any maskable)
og-image.svg/.png   social share card source + rendered 1200×630
site.webmanifest    PWA manifest    robots.txt / sitemap.xml  crawler allow + sitemap
```

Publishing metadata lives in `index.html`'s `<head>` (description, canonical, theme-color,
Open Graph, Twitter card). Canonical / OG / sitemap URLs target `https://teleprompter.mhashim6.me`.
PNG icons are rendered from the SVG sources with `qlmanage` + `sips` (no build step); the OG
square render is center-cropped to 1200×630.

The codebase follows a pure-core / imperative-shell split: `constants`, `schema`,
`engine`, `viewmodel`, and `studio` are pure (data in, value out — no DOM, no state,
no timers) and are unit-tested with `node --test`; `prompter` is a thin stateful shell
over `engine` (it owns the position, the timer, and the callback fan-out, with an
`onError` callback so a faulty render can't break the timer chain); `store`, `ui`, and
`studio-ui` are the side-effecting shells. The deck editor (`studio` + `studio-ui`)
round-trips through the same boundary the player uses — it serialises to the **raw**
deck JSON that `Store.saveDeck` persists and `Schema.normalise` validates, so it cannot
change playback behaviour. `studio-ui` reuses thin `TP.UI` exports (`toast`,
`refreshLibrary`, `reloadActive`, `setWpm`/`getWpm`) rather than duplicating them.
Scripts load in dependency order: `constants → schema → engine → store → prompter →
viewmodel → studio → ui → studio-ui → app`.

Run by opening `index.html` directly or by serving the folder (see README). Both work, because the scripts are classic scripts and assets use relative paths.

**Authoring from source (the `deck-author` skill).** A third authoring path lives at
`.claude/skills/deck-author/`. The agent ingests a PPT / PDF / screenshots / text,
writes the narration with pause beats into a human-readable `decks/<slug>.deck.md`
(format in the skill's `references/format.md`), and compiles it with `tools/deck.js`.
That compiler is the deterministic half: it `require()`s the app's own
`src/schema.js` + `src/engine.js` (the same `global.window=global` pattern as `test/`),
so word counts, the pause model, and the **duration report cannot drift from
playback**. It emits the same raw deck JSON the player consumes (§3), stamps a stable
`meta.id` from the title (§3.3), and is unit-tested in `test/deck.test.js`. PPTX text +
speaker notes are pulled by a throwaway stdlib extractor generated at run time (not
committed), which rejects XML carrying a DOCTYPE/ENTITY declaration as an
XXE / entity-expansion guard.

## 3. The JSON contract

This is the interop surface. Keep it stable, or evolve it through the tolerant normaliser (section 4), not by special-casing the UI.

### Shape

```jsonc
{
  "meta": {                      // optional, all fields optional
    "title": "string",           // shown in the top bar, used in the deck id seed
    "section": "string",         // informational
    "slideRange": "64-69",       // shown next to the title; else derived from slide numbers
    "voice": "string",           // informational
    "language": "en-GB",         // informational
    "schema": { }                // informational, self-describing
  },
  "slides": [
    {
      "id": "slide-64",          // informational only; NOT used for dedup (see 3.3)
      "number": 64,              // shown as "slide 64"; defaults to array index + 1
      "title": "Bootcamps",      // shown in meta and in the "next" hint
      "type": "section-divider", // free text; hyphens shown as spaces (this is the meta label)
      "estimatedMinutes": 6,     // number; used by the "slide pace" button and the clock baseline
      "onScreen": "string",      // what the audience sees; shown under the meta line
      "wordCount": 550,          // number; display only; MUST exclude pause tokens
      "script": "string",        // full narration, paragraphs separated by blank lines
      "paragraphs": ["string"]   // same narration split into advance/scroll units
    }
  ]
}
```

### 3.1 Which fields the app consumes

`paragraphs` is the primary content. If absent, the app falls back to `script` split on blank lines, then to `text`. `number`, `title`, `type`, `onScreen`, `estimatedMinutes` drive the meta strip and the next-slide hint. `wordCount` is display only; if absent it is computed (words, excluding pauses). `meta.title` and `meta.slideRange` label the deck. Everything in `meta.schema` and `slide.id` is informational.

### 3.2 Pause tokens

Pauses are inline tokens inside paragraph or script text. They are stripped before word counting, never rendered as text, and never spoken. The prompter dwells on them for an absolute duration that does not scale with pace.

- `[[pause]]` holds for 1000 ms.
- `[[pause:1.5]]` holds for 1.5 seconds. Bare numbers are seconds.
- `[[pause:500ms]]` holds for 500 ms.
- `[[beat]]` is an alias for `[[pause]]`.

Recognising regex (case-insensitive, global):

```
/\[\[\s*(?:pause|beat)\b\s*[:= ]?\s*([0-9]*\.?[0-9]+)?\s*(ms|s|sec|secs)?\s*\]\]/ig
```

Default when no number is given: 1000 ms. Unit `ms` is milliseconds; anything else, or no unit, is seconds.

### 3.3 Deck identity (important behaviour)

The app derives a deck id by hashing the content (djb2 over `meta.title` plus slide count plus the first slide's opening words). Editing the script therefore produces a new id, which the library treats as a new deck and starts at slide one. The old entry stays in storage until removed via the drawer.

This is the main rough edge for an iterative authoring loop, and the top item in section 11. The normaliser already honours a stable id from the JSON (`meta.id`, slugged) and falls back to the content hash only when absent, so a deck keeps its position across text edits. The in-app **Deck Studio** (section 6) leans on this: editing an existing deck pins `meta.id` to the deck's storage id before saving, so the edit updates in place rather than spawning a duplicate; a new deck gets a unique slug of its title. Hand-authored decks should set a stable `meta.id` for the same reason.

## 4. Normalisation (tolerance rules)

`Schema.normalise(raw, fallbackName)` is pure and defensive so the JSON can change without breaking the UI:

- `slides` may be the `slides` array, or `raw` may itself be a bare array of slides.
- A slide may provide `paragraphs`, or only `script`, or only `text`. Blank-line splitting yields paragraphs; whitespace splitting yields words; the pause regex extracts pause tokens.
- `wordCount` uses the declared value if present, otherwise the computed word count (pauses excluded).
- Empty or unrecognised input yields zero slides; the app shows its empty state rather than erroring.

Treat the normaliser as the single place to absorb schema drift.

## 5. Internal model (post-normalisation)

Each paragraph is a list of tokens, each token either a word or a pause.

```jsonc
Deck = { id, title, slideRange, voice, slides: [ Slide ] }

Slide = {
  number, title, type, onScreen,
  estimatedMinutes,            // number | null
  wordCount,                   // words only (display)
  paragraphs: [ { tokens: [ Token ] } ],
  total                        // sequence length = words + pauses; the POSITION SPACE
}

Token = { kind: "word", text } | { kind: "pause", ms }
```

## 6. Architecture

Pure-core / imperative-shell, organised as a pure layer (`constants`, `schema`, `engine`, `viewmodel`, `studio`) and a side-effecting layer (`store`, `prompter`, `ui`, `studio-ui`), plus a boot file. Each `src/*.js` is a classic script that attaches to the shared global `window.TP`. They are loaded in dependency order by `index.html` at the end of the body, after the DOM exists.

```
<script src="src/constants.js"></script>
<script src="src/schema.js"></script>
<script src="src/engine.js"></script>
<script src="src/store.js"></script>
<script src="src/prompter.js"></script>
<script src="src/viewmodel.js"></script>
<script src="src/studio.js"></script>
<script src="src/welcome.js"></script>
<script src="src/ui.js"></script>
<script src="src/studio-ui.js"></script>
<script src="src/app.js"></script>
```

Classic scripts, not ES modules, were chosen deliberately: ES module loading is blocked over `file://` in browsers, which would stop the app opening by double-click. Classic scripts work both from `file://` and over http, with no bundler.

- **Const** (pure). One frozen object of every tunable number: clamp bounds (wpm/font/leading), pace multipliers, and timing intervals. The single source so no magic numbers live in the logic.
- **Schema** (pure, no DOM, no storage). `normalise(raw, fallbackName) -> Deck`. Produces the id and the token model in section 5.
- **Engine** (pure, no state, no timers). The timing core: `itemDuration`, `flatSeq`, `totalsMs`, `clampPos`, `paceFromSlide`. Data in, value out — every pace rule is unit-tested in isolation.
- **Store** (no DOM). A `localStorage` wrapper with an in-memory fallback so a sandbox that blocks storage degrades instead of throwing. Persists global preferences, a deck index, raw deck bodies, per-deck positions, and the active deck id. It stores the raw JSON, not the normalised form, and re-normalises on load, so changing the schema does not invalidate saved decks. An optional `onError` sink surfaces write failures (e.g. full quota); a backend seam lets tests inject a mock.
- **Prompter** (stateful shell over Engine, no DOM). Holds the deck, the position, the play state, and the pace. Advances with a chained timer (`setTimeout` by default; a `setScheduler` seam lets tests drive it deterministically) using per-token durations from the Engine. Communicates outward only through callbacks: `onTick`, `onSlide`, `onState`, `onComplete`, and `onError` (a callback that throws is routed here and swallowed, so a faulty render can never break the timer chain). Exposes `position()`, `deck()`, `slide()`, `total()`, and `totalsMs()`.
- **ViewModel** (pure). Render decisions lifted out of the UI: `tokenClasses`, `progressPct`, `clockText`, `slideMeta`, `nextHint`, `scrollTarget`. The UI applies these to the DOM (always via textContent), so deck content stays inert.
- **Welcome** (pure data, no logic). `TP.Welcome.RAW` — the raw deck for the self-running landing session. The UI normalises it and plays it through the real pipeline when no deck is loaded; it is never persisted.
- **Studio** (pure, no DOM, no state). The deck-editor core: `blankSlide`/`blankDeck`, immutable `addSlide`/`removeSlide`/`duplicateSlide`/`moveSlide` (each renumbers 1..n; removing the last slide leaves one blank), `renumber`, `ensureUniqueId`, `serialize` (editing model → clean raw deck; emits `script` only, drops empty optionals, keeps a finite positive `estimatedMinutes` target, carries `meta.id`), and `estimateSlide`/`estimateDeck` (words + spoken ms via the same `Schema → Engine` path the player uses — the honest live readout).
- **UI** (all DOM, the imperative shell). Renders the meta strip, the reader (one span per token), the next-slide hint, the control bar, and the library and settings drawer. Buttons and the keymap call one shared action layer. Reacts to the Prompter callbacks. Exposes thin reuse hooks for the editor: `toast`, `refreshLibrary`, `reloadActive`, `loadById`, `getActive`, `setWpm`/`getWpm`.
  - **Welcome mode.** When no deck is loaded (first run, or after the last deck is removed) the UI builds an ephemeral deck from `TP.Welcome.RAW`, plays it auto-started, and shows three coach-marks (play / pace / menu, edge-aware so they stay on screen). It keeps `activeId = null` so position-saving no-ops (`saveNow` is already guarded), never calls `Store.saveDeck`, and is never listed in the library. Each coach-mark dismisses on its own — only when its control is clicked (`pointerdown` on that target), independently of the others; the intro finishing does not retire them. Loading a real deck (`loadById`/`ingest`) or saving a new deck in the studio clears welcome mode and removes any remaining marks.
  - **Presentation mode** (camera-strip while playing) is currently **disabled** via the `PRESENT_MODE` flag in `ui.js` — `enterPresenting` early-returns, so playback stays in full chrome. The code and the `.presenting` CSS are kept intact; flip the flag to re-enable.
- **StudioUI** (all DOM, the imperative shell). The full-screen editor overlay, opened from the drawer's "new deck" button or a library row's edit (pencil) action. Holds the editing model, renders one card per slide (title/type/on-screen/target-minutes fields, a script textarea with an "insert pause" helper, reorder/duplicate/delete buttons), and shows a live `words · ~m:ss` readout per slide and for the deck. The pace control is the global slider (`setWpm`/`getWpm`), so the durations are reality at the current wpm and a per-slide `target` minutes is shown beside it. Saves through `Store.saveDeck` and offers a JSON download (Blob). All deck text reaches the DOM via `.value`/`.textContent` only.

Data flow is one-directional: UI loads a deck via Store and Schema, hands it to the Prompter, and binds callbacks. The Prompter never touches the DOM; the UI reads Prompter state only through the read accessors (`position()`, `deck()`, `slide()`), never a mutable handle. The editor writes raw decks back through Store (validated by Schema), then asks the UI to refresh the library and reload the active deck — it never drives the Prompter directly. Everything is on `window.TP` for inspection in the console.

## 7. Playback semantics and invariants

Preserve these when editing.

- **Position**. `TP.Prompter.position().word` is an index into the flat token sequence of the current slide. The name is historical; it indexes words and pauses alike. Range is `[0, total]`.
- **Highlight states**. Index `< word` is done (faded to `--read-opacity`), `=== word` is current (accent), `> word` is upcoming (readable). At `word === total` the slide is complete and nothing is current.
- **Per-token duration** (`itemDuration`): a word is `base = 60000 / wpm` ms, multiplied by `1.9` if it ends in sentence-final punctuation (`. ? ! …`) or by `1.4` if it ends in clause punctuation (`, ; :`); a pause is its absolute `ms`, not scaled by pace.
- **Clock**. `totalsMs()` returns the cumulative duration to reach each index at the current pace, including pauses, so the elapsed-over-total readout is exact.
- **Progress bar**. `word / total` over the sequence, so pause slots count.
- **Slide boundaries**. The engine does not cross slides on its own. `onComplete` fires at the end; the speaker advances manually, unless `autoAdvance` is on, in which case the UI calls `next()` after a short delay. Pressing play at the end replays the slide.
- **Persistence cadence**. Position saves throttled while playing (about every 1.2 s) and immediately on pause, slide change, seek, page hide, and unload.

## 8. Controls, keyboard, persisted state

Controls: play and pause, previous and next slide, restart slide, pace slider (60 to 220 wpm), font smaller and larger, theme toggle, "slide pace" (sets wpm from `wordCount / estimatedMinutes`), mirror. The drawer holds the deck library (switch, reset position, remove), file upload and drag-and-drop, and settings: centre guide line, auto-scroll, auto-advance, reset this deck.

Keyboard: space toggles play and pause and is intercepted globally (it blurs any focused button so a just-clicked control cannot swallow it); left and right change slides; comma and full stop nudge one token; left and right square brackets change pace by 5 wpm; plus and minus change font by 0.1; `r` restarts the slide; `m` mirror; `t` theme; `l` library; Escape closes the drawer. Clicking a word or pause seeks to it.

Storage keys are namespaced `tp:` — `prefs`, `index`, `raw:<id>`, `pos:<id>`, `active`. Preferences: `theme` (day or night), `wpm`, `fontScale`, `mirror`, `guide`, `autoScroll`, `autoAdvance`. Positions are `{ slideIndex, word }`.

## 9. Design system and texture surface

The look is a restrained reading of the author's Timeless system. Do not "modernise" these choices; they are intentional.

- One typeface: JetBrains Mono, from Google Fonts, with a monospace fallback. Hierarchy comes from size, weight, case, and letter-spacing, not a second family.
- Two themes share one token set. Day is ink on parchment; night is candlelight on a dark board. Core values: day `--parchment #e8dcc2`, `--ink #2b2418`, `--rule #8a7652`, accent oxblood `#6e2a1e`; night `#1a1611`, `#d9c9a7`, `#6e5c3e`, accent gilt `#c8a14a`.
- Sharp corners, hairline rules, no shadows. The thorn glyph (the crossed mark) is the only ornament.
- **Texture surface.** The page background is the Timeless parchment: a 48 px tiling noise grain over the base colour, lit by faint radial "foxing" spots, and drifting very slowly (a 60 s loop, about 1.6 px per second, the grain layer only). Day uses `assets/noise.png` with oxblood foxing; night uses `assets/noise-light.png` with gilt foxing. The drift is disabled under `prefers-reduced-motion`. Tuned by `--texture-tile` (48 px). The control bar and meta areas are transparent so the texture reads as one continuous surface; the drawer stays solid for legibility.
- A faint centre guide line marks the reading position. Reading measure is fixed at `40ch`, so line length is constant across font sizes.
- Two tuning tokens worth knowing: `--reader-size` (driven by the font control) and `--read-opacity` (opacity of already-read words, default `.4`).

Deliberate departures from the full Timeless brand, made because this is a tool rather than a chronicle: the interface copy is plain and functional rather than the brand's archaic, scribal voice; there is no decorative motion beyond the slow parchment drift and short colour and opacity transitions, all disabled under reduced-motion. If the source design system is available it lives at `/mnt/skills/user/timeless-design`; the values above are otherwise sufficient.

## 10. Known limitations and non-goals

- Timing is open-loop. There is no speech tracking, so real delivery will drift from the highlight. Correction is manual: click a word, or nudge with comma and full stop. This is by design for the prototype.
- The content-hash deck id resets saved position on any text edit (section 3.3).
- Smooth auto-scroll can lag behind at very high pace on long slides; it falls back to instant scrolling under reduced-motion.
- One deck is active at a time. There is no export, print, or PDF output. Browser storage may be unavailable in a sandboxed preview, in which case the app runs without persistence and says so.

## 11. Recommended next steps

In rough priority order:

1. Adopt a stable deck id from the JSON (`meta.id`), falling back to the content hash, so positions survive edits. This is the one change that most improves the authoring loop.
2. Add deck validation feedback in the UI (token counts, any unparsed pause-like tokens) rather than silent tolerance, for authoring confidence.
3. Optional features, each independent: per-slide pace override; configurable punctuation multipliers; tap or click to advance the reading head by a whole line; a printable or PDF export of a deck; vertical flip to complement mirror for certain rigs; a compact countdown of time remaining across the whole deck.
4. If a build step is ever wanted, the modules convert cleanly to ES modules (one `export` per file, imports in dependency order, `app.js` as the entry), at the cost of needing a server or bundler. The current classic-script form is the no-build default.

## 12. Quick start for an agent

Open `index.html` (or serve the folder). Open the drawer, then drag in or choose a `.json` deck conforming to section 3. Press space to start.

To change behaviour, edit the relevant `src` file: `schema.js` for parsing and the deck id, `store.js` for persistence, `prompter.js` for pace and pause timing, `ui.js` for rendering, controls, and keyboard, `styles.css` for the look and the texture surface. When editing the engine, preserve the invariants in section 7. When changing the JSON, route it through the normaliser in section 4 rather than the UI.
