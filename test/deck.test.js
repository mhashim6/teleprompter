"use strict";
/* Tests for tools/deck.js — the .deck.md compiler used by the deck-author
   skill. The tool reuses the real Schema + Engine, so these tests also pin the
   round-trip contract (parse -> raw deck -> Schema.normalise) and assert the
   duration report matches Engine.totalsMs exactly (no drift from playback). */
const test = require("node:test");
const assert = require("node:assert");

global.window = global;
require("../src/constants.js");
require("../src/schema.js");
require("../src/engine.js");
const Schema = window.TP.Schema;
const Engine = window.TP.Engine;
const Const = window.TP.Const;

const deck = require("../tools/deck.js");

/* ---- parseDeckMd: frontmatter ---- */
test("parseDeckMd: reads flat frontmatter and strips inline comments", () => {
  const md = [
    "---",
    "title: My Talk",
    "id: my-talk   # stable id",
    "language: en-GB",
    "# a whole-line comment",
    "---",
    "",
    "## 1 · Intro",
    "",
    "Hello world.",
  ].join("\n");
  const { meta, slides } = deck.parseDeckMd(md);
  assert.strictEqual(meta.title, "My Talk");
  assert.strictEqual(meta.id, "my-talk");
  assert.strictEqual(meta.language, "en-GB");
  assert.strictEqual(slides.length, 1);
});

test("parseDeckMd: no frontmatter still parses slides", () => {
  const { meta, slides } = deck.parseDeckMd("## Intro\n\nHi there.");
  assert.deepStrictEqual(meta, {});
  assert.strictEqual(slides.length, 1);
  assert.strictEqual(slides[0].title, "Intro");
});

/* ---- parseDeckMd: heading number/title variants ---- */
test("parseDeckMd: heading variants (·, :, ., -, none)", () => {
  const md = [
    "## 1 · Dot Sep",
    "x.",
    "",
    "## 2: Colon Sep",
    "x.",
    "",
    "## 3. Period Sep",
    "x.",
    "",
    "## 4 - Dash Sep",
    "x.",
    "",
    "## No Number Here",
    "x.",
  ].join("\n");
  const { slides } = deck.parseDeckMd(md);
  assert.strictEqual(slides.length, 5);
  assert.deepStrictEqual(
    slides.map((s) => [s.number, s.title]),
    [
      [1, "Dot Sep"],
      [2, "Colon Sep"],
      [3, "Period Sep"],
      [4, "Dash Sep"],
      [null, "No Number Here"],
    ]
  );
});

test("parseDeckMd: a title that merely starts with digits is not a slide number", () => {
  const { slides } = deck.parseDeckMd("## 2024 Review\n\nbody.");
  assert.strictEqual(slides[0].number, null);
  assert.strictEqual(slides[0].title, "2024 Review");
});

/* ---- parseDeckMd: directives ---- */
test("parseDeckMd: captures type / on-screen / target directives", () => {
  const md = [
    "## 1 · Slide",
    "type: section-divider",
    "on-screen: What they see",
    "target: 2.5",
    "",
    "The narration.",
  ].join("\n");
  const s = deck.parseDeckMd(md).slides[0];
  assert.strictEqual(s.type, "section-divider");
  assert.strictEqual(s.onScreen, "What they see");
  assert.strictEqual(s.target, 2.5);
  assert.strictEqual(s.script, "The narration.");
});

test("parseDeckMd: a directive-looking line inside narration is not consumed", () => {
  // Directives only count before the first blank line / non-directive line.
  const md = ["## 1 · Slide", "", "type: this is prose, not a directive."].join(
    "\n"
  );
  const s = deck.parseDeckMd(md).slides[0];
  assert.strictEqual(s.type, undefined);
  assert.strictEqual(s.script, "type: this is prose, not a directive.");
});

/* ---- parseDeckMd: narration normalisation + pause preservation ---- */
test("parseDeckMd: soft-wrapped lines collapse to spaces within a paragraph", () => {
  const md = ["## 1 · Slide", "", "one two", "three four", "", "second para."].join(
    "\n"
  );
  const s = deck.parseDeckMd(md).slides[0];
  assert.strictEqual(s.script, "one two three four\n\nsecond para.");
});

test("parseDeckMd: pause tokens are preserved verbatim", () => {
  const md = "## 1 · Slide\n\nHold [[pause]] here [[pause:1.5]] and [[pause:500ms]].";
  const s = deck.parseDeckMd(md).slides[0];
  assert.match(s.script, /\[\[pause\]\]/);
  assert.match(s.script, /\[\[pause:1\.5\]\]/);
  assert.match(s.script, /\[\[pause:500ms\]\]/);
});

/* ---- buildRawDeck + Schema.normalise round-trip ---- */
test("buildRawDeck: produces a deck that normalises to the right shape", () => {
  const md = [
    "---",
    "title: Round Trip",
    "---",
    "",
    "## 1 · First",
    "type: content",
    "target: 1",
    "",
    "Alpha beta gamma. [[pause]] Delta.",
    "",
    "## 2 · Second",
    "",
    "Just three words here.",
  ].join("\n");
  const raw = deck.buildRawDeck(deck.parseDeckMd(md));
  assert.strictEqual(raw.meta.title, "Round Trip");
  assert.strictEqual(raw.meta.id, "round-trip"); // slug(title)
  assert.strictEqual(raw.slides.length, 2);
  assert.strictEqual(raw.slides[0].estimatedMinutes, 1);

  const norm = Schema.normalise(raw, raw.meta.title);
  assert.strictEqual(norm.slides.length, 2);
  // wordCount excludes the pause token: Alpha beta gamma. Delta. = 4 words
  assert.strictEqual(norm.slides[0].wordCount, 4);
  assert.strictEqual(norm.slides[1].wordCount, 4);
});

test("buildRawDeck: explicit meta.id wins and is slugged", () => {
  const raw = deck.buildRawDeck(
    deck.parseDeckMd("---\ntitle: A Title\nid: Custom ID!\n---\n\n## 1 · S\n\nx.")
  );
  assert.strictEqual(raw.meta.id, "custom-id");
});

/* ---- report: timing parity with Engine (no drift) ---- */
test("report: per-slide ms equals Engine.totalsMs for the same tokens/wpm", () => {
  const raw = deck.buildRawDeck(
    deck.parseDeckMd("## 1 · S\n\none two three. [[pause:2]] four")
  );
  const wpm = 120;
  const rep = deck.report(raw, { wpm });

  const norm = Schema.normalise(raw, raw.meta && raw.meta.title);
  const seq = Engine.flatSeq(norm.slides[0]);
  const cum = Engine.totalsMs(seq, wpm);
  assert.strictEqual(rep.slides[0].ms, cum[cum.length - 1]);
  assert.strictEqual(rep.slides[0].words, 4);
  assert.strictEqual(rep.slides[0].pauses, 1);
  assert.strictEqual(rep.slides[0].pauseMs, 2000);
});

test("report: total ms is the sum of slide ms; pauses add absolute time", () => {
  const base = deck.buildRawDeck(deck.parseDeckMd("## 1 · S\n\nword word word"));
  const withPause = deck.buildRawDeck(
    deck.parseDeckMd("## 1 · S\n\nword word word [[pause:3]]")
  );
  const wpm = 130;
  const r1 = deck.report(base, { wpm });
  const r2 = deck.report(withPause, { wpm });
  assert.strictEqual(r2.totalMs - r1.totalMs, 3000);
  assert.strictEqual(r1.totalMs, r1.slides[0].ms);
});

test("report: target delta and implied wpm are computed", () => {
  // 130 words at a 1-minute target implies 130 wpm.
  const words = Array.from({ length: 130 }, () => "w").join(" ");
  const raw = deck.buildRawDeck(
    deck.parseDeckMd("## 1 · S\ntarget: 1\n\n" + words)
  );
  const rep = deck.report(raw, { wpm: 130 });
  assert.strictEqual(rep.slides[0].words, 130);
  assert.strictEqual(rep.slides[0].target, 1);
  assert.strictEqual(rep.slides[0].targetMs, 60000);
  assert.strictEqual(Math.round(rep.slides[0].impliedWpm), 130);
});

/* ---- id stability ---- */
test("report/id: same title yields the same deck id across runs", () => {
  const a = deck.report(
    deck.buildRawDeck(deck.parseDeckMd("---\ntitle: Stable\n---\n\n## 1 · S\n\nfoo bar"))
  );
  const b = deck.report(
    deck.buildRawDeck(
      deck.parseDeckMd("---\ntitle: Stable\n---\n\n## 1 · S\n\ntotally different prose")
    )
  );
  assert.strictEqual(a.id, b.id); // editing prose must not change the id
  assert.strictEqual(a.id, "stable");
});

/* ---- fillBeats ---- */
test("fillBeats: adds a pause to every paragraph except the last", () => {
  const out = deck.fillBeats("para one.\n\npara two.\n\npara three.");
  const paras = out.split(/\n\n/);
  assert.match(paras[0], /\[\[pause\]\]$/);
  assert.match(paras[1], /\[\[pause\]\]$/);
  assert.doesNotMatch(paras[2], /\[\[pause\]\]$/);
});

test("fillBeats: never duplicates an existing trailing pause", () => {
  const out = deck.fillBeats("already paused [[pause:1.5]]\n\nlast one.");
  const paras = out.split(/\n\n/);
  assert.strictEqual(paras[0], "already paused [[pause:1.5]]");
  assert.doesNotMatch(paras[1], /\[\[pause\]\]$/);
});

test("fillBeats: single-paragraph script is untouched", () => {
  assert.strictEqual(deck.fillBeats("only paragraph."), "only paragraph.");
});

/* ---- helpers ---- */
test("msToClock: formats m:ss and rounds to seconds", () => {
  assert.strictEqual(deck.msToClock(0), "0:00");
  assert.strictEqual(deck.msToClock(5000), "0:05");
  assert.strictEqual(deck.msToClock(65000), "1:05");
  assert.strictEqual(deck.msToClock(125400), "2:05");
});

test("defaultOut: maps .deck.md and .md to .json", () => {
  assert.strictEqual(deck.defaultOut("decks/talk.deck.md"), "decks/talk.json");
  assert.strictEqual(deck.defaultOut("notes.md"), "notes.json");
});

test("parseArgs: reads input, --wpm, --out, --fill-beats", () => {
  const a = deck.parseArgs(["in.deck.md", "--wpm", "150", "--fill-beats", "--out", "x.json"]);
  assert.strictEqual(a.input, "in.deck.md");
  assert.strictEqual(a.wpm, 150);
  assert.strictEqual(a.fillBeats, true);
  assert.strictEqual(a.out, "x.json");
});
