"use strict";
/* ==========================================================================
   deck.js  ->  tools/deck.js
   Compile a human-readable ".deck.md" authoring file into a teleprompter deck
   JSON (the section-3 contract in HANDOFF.md), and print an honest duration
   report.

   This tool is the deterministic half of the `deck-author` agent skill: the
   agent writes the prose + pause beats into a .deck.md; this tool parses it,
   assembles the JSON, and reports the timing.

   SINGLE SOURCE OF TRUTH: it reuses the real app code for parsing, word
   counting, and timing by aliasing window to the global and require()-ing the
   classic scripts in dependency order — exactly how test/*.test.js loads them.
   So the reported duration can never drift from playback.

   Pure, testable functions are exported (parseDeckMd, buildRawDeck, fillBeats,
   report, msToClock); the fs/argv shell runs only when invoked as a CLI.

   Usage:
     node tools/deck.js <input.deck.md> [--wpm 130] [--out path.json] [--fill-beats]
   ========================================================================== */

global.window = global.window || global;
require("../src/constants.js");
require("../src/schema.js");
require("../src/engine.js");
const { Schema, Engine, Const } = window.TP;

// ---- markdown authoring format -> intermediate parsed shape -----------------

// Recognises a slide heading: "## 1 · Title", "## 1: Title", "## 1. Title",
// "## 1 - Title", or "## Title" (no number -> auto-indexed later).
const HEADING_RE = /^##\s+(?:(\d+(?:\.\d+)?)\s*[·:.\-]\s+)?(.+?)\s*$/;
// A per-slide directive line directly under the heading.
const DIRECTIVE_RE = /^(type|on-screen|on\s?screen|onscreen|target)\s*:\s*(.*)$/i;
// A trailing "# comment" on a frontmatter line (only when whitespace-separated).
const TRAILING_COMMENT_RE = /\s+#.*$/;
// Does a paragraph already end on a pause beat?
const ENDS_WITH_PAUSE_RE = /\[\[\s*(?:pause|beat)\b[^\]]*\]\]\s*$/i;

// Split deck-level frontmatter (--- ... ---) from the body. Returns flat meta.
function parseFrontmatter(text) {
  const m = /^﻿?---\s*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(text);
  if (!m) return { meta: {}, body: text };
  const meta = {};
  m[1].split("\n").forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const idx = trimmed.indexOf(":");
    if (idx === -1) return;
    const key = trimmed.slice(0, idx).trim().toLowerCase();
    const value = trimmed.slice(idx + 1).replace(TRAILING_COMMENT_RE, "").trim();
    if (key) meta[key] = value;
  });
  return { meta, body: text.slice(m[0].length) };
}

// Collapse a narration block into clean paragraphs: split on blank lines, then
// flatten soft-wrapped lines within a paragraph to single spaces. This matters
// because Schema.clean() strips newlines without inserting a space, so a
// soft-wrapped paragraph would otherwise glue two words together.
function normaliseNarration(block) {
  return block
    .split(/\n[ \t]*\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n\n");
}

function num(v) {
  if (v == null || v === "") return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

// parseDeckMd(text) -> { meta, slides:[{number,title,type,onScreen,target,script}] }
function parseDeckMd(text) {
  const { meta, body } = parseFrontmatter(String(text == null ? "" : text));
  const lines = body.split("\n");

  // Find slide heading boundaries.
  const starts = [];
  for (let i = 0; i < lines.length; i++) {
    if (HEADING_RE.test(lines[i])) starts.push(i);
  }

  const slides = [];
  for (let s = 0; s < starts.length; s++) {
    const from = starts[s];
    const to = s + 1 < starts.length ? starts[s + 1] : lines.length;
    const block = lines.slice(from, to);

    const head = HEADING_RE.exec(block[0]);
    const number = head && head[1] != null ? num(head[1]) : null;
    const title = head ? head[2].trim() : "";

    // Consume directive lines that sit directly under the heading, before any
    // blank line or narration text.
    const slide = { number, title, script: "" };
    let i = 1;
    for (; i < block.length; i++) {
      if (block[i].trim() === "") break;
      const d = DIRECTIVE_RE.exec(block[i]);
      if (!d) break;
      const key = d[1].toLowerCase().replace(/\s/g, "");
      const val = d[2].trim();
      if (key === "type") slide.type = val;
      else if (key === "onscreen" || key === "on-screen") slide.onScreen = val;
      else if (key === "target") slide.target = num(val);
    }

    slide.script = normaliseNarration(block.slice(i).join("\n"));
    slides.push(slide);
  }

  return { meta, slides };
}

// ---- optional structural pause net (3A, opt-in via --fill-beats) ------------

// Append a [[pause]] to every paragraph that lacks one, except a slide's last
// paragraph. Never duplicates an existing trailing pause. Operates on a script
// whose paragraphs are separated by blank lines.
function fillBeats(script) {
  const paras = String(script == null ? "" : script).split(/\n[ \t]*\n/);
  return paras
    .map((p, i) => {
      if (i === paras.length - 1) return p;
      if (ENDS_WITH_PAUSE_RE.test(p)) return p;
      if (p.trim() === "") return p;
      return p.replace(/\s*$/, "") + " [[pause]]";
    })
    .join("\n\n");
}

// ---- intermediate -> raw deck JSON (the contract the app consumes) ----------

function buildRawDeck(parsed) {
  const m = (parsed && parsed.meta) || {};
  const meta = {};
  if (m.title) meta.title = m.title;
  // Stable id: explicit meta.id, else slug(title). Keeps saved position across
  // re-compiles (HANDOFF §3.3). Omitted only when there's nothing to seed it.
  const id = Schema.slug(m.id) || Schema.slug(m.title);
  if (id) meta.id = id;
  if (m.section) meta.section = m.section;
  if (m.slideRange || m.sliderange) meta.slideRange = m.slideRange || m.sliderange;
  if (m.voice) meta.voice = m.voice;
  if (m.language) meta.language = m.language;

  const slides = (parsed.slides || []).map((s, i) => {
    const slide = { number: s.number != null ? s.number : i + 1 };
    slide.title = s.title || "Slide " + slide.number;
    if (s.type) slide.type = s.type;
    if (s.onScreen) slide.onScreen = s.onScreen;
    if (s.target != null) slide.estimatedMinutes = s.target;
    slide.script = s.script || "";
    return slide;
  });

  return { meta, slides };
}

// ---- duration report (reuses Engine, so it matches playback exactly) --------

function msToClock(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const sec = total % 60;
  return m + ":" + String(sec).padStart(2, "0");
}

// report(rawDeck, {wpm}) -> structured, fully derived from the normalised deck.
function report(rawDeck, opts) {
  const options = opts || {};
  const wpm = options.wpm || 130;
  const deck = Schema.normalise(rawDeck, rawDeck && rawDeck.meta && rawDeck.meta.title);

  const slides = deck.slides.map((s) => {
    const seq = Engine.flatSeq(s);
    const cum = Engine.totalsMs(seq, wpm);
    const ms = cum[cum.length - 1];
    const pauseTokens = seq.filter((t) => t.kind === "pause");
    const pauseMs = pauseTokens.reduce((a, t) => a + t.ms, 0);
    const target = s.estimatedMinutes;
    const targetMs = target != null ? target * 60000 : null;
    return {
      number: s.number,
      title: s.title,
      words: s.wordCount,
      pauses: pauseTokens.length,
      pauseMs,
      ms,
      target,
      targetMs,
      deltaMs: targetMs != null ? ms - targetMs : null,
      // Pace a slide implies from its own words/target, and whether that pace
      // is reachable on the 60-220 slider.
      impliedWpm: target ? s.wordCount / target : null,
    };
  });

  const totalMs = slides.reduce((a, s) => a + s.ms, 0);
  const totalWords = slides.reduce((a, s) => a + s.words, 0);
  const totalPauses = slides.reduce((a, s) => a + s.pauses, 0);

  return {
    id: deck.id,
    title: deck.title,
    slideRange: deck.slideRange,
    wpm,
    slides,
    totalMs,
    totalWords,
    totalPauses,
  };
}

// Pretty-print the report for the CLI / the agent to show the user.
function formatReport(rep) {
  const lines = [];
  lines.push(
    'deck "' + rep.title + '"  (id: ' + rep.id + ")  @ " + rep.wpm + " wpm"
  );
  lines.push("");
  rep.slides.forEach((s) => {
    let row =
      "  " +
      String(s.number).padStart(3) +
      "  " +
      msToClock(s.ms).padStart(6) +
      "  " +
      String(s.words).padStart(4) +
      "w  " +
      String(s.pauses).padStart(2) +
      "p(+" +
      (s.pauseMs / 1000).toFixed(1) +
      "s)  " +
      s.title;
    if (s.target != null) {
      const sign = s.deltaMs >= 0 ? "+" : "-";
      row +=
        "  [target " +
        msToClock(s.targetMs) +
        ", " +
        sign +
        msToClock(Math.abs(s.deltaMs)) +
        "]";
      const lo = Const.WPM_MIN,
        hi = Const.WPM_MAX;
      if (s.impliedWpm != null && (s.impliedWpm < lo || s.impliedWpm > hi)) {
        row +=
          " (implied " +
          Math.round(s.impliedWpm) +
          " wpm out of " +
          lo +
          "-" +
          hi +
          ")";
      }
    }
    lines.push(row);
  });
  lines.push("");
  lines.push(
    "  total " +
      msToClock(rep.totalMs) +
      "  (" +
      rep.totalWords +
      " words, " +
      rep.totalPauses +
      " pauses)"
  );
  return lines.join("\n");
}

// ---- CLI shell --------------------------------------------------------------

function parseArgs(argv) {
  const out = { wpm: 130, fillBeats: false, input: null, out: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--wpm") out.wpm = parseFloat(argv[++i]) || out.wpm;
    else if (a === "--out") out.out = argv[++i];
    else if (a === "--fill-beats") out.fillBeats = true;
    else if (a === "--help" || a === "-h") out.help = true;
    else if (!out.input) out.input = a;
  }
  return out;
}

function defaultOut(inputPath) {
  return inputPath.replace(/\.deck\.md$/i, "").replace(/\.md$/i, "") + ".json";
}

function main(argv) {
  const fs = require("fs");
  const args = parseArgs(argv);
  if (args.help || !args.input) {
    process.stdout.write(
      "Usage: node tools/deck.js <input.deck.md> [--wpm 130] [--out file.json] [--fill-beats]\n"
    );
    process.exit(args.input ? 0 : 1);
    return;
  }

  const text = fs.readFileSync(args.input, "utf8");
  const parsed = parseDeckMd(text);
  if (args.fillBeats) {
    parsed.slides.forEach((s) => {
      s.script = fillBeats(s.script);
    });
  }

  const raw = buildRawDeck(parsed);
  const rep = report(raw, { wpm: args.wpm });

  // Enrich the output slides with the computed wordCount (display only; matches
  // the existing sample deck's shape). Order is preserved by Schema.normalise.
  raw.slides.forEach((slide, i) => {
    if (rep.slides[i]) slide.wordCount = rep.slides[i].words;
  });

  const outPath = args.out || defaultOut(args.input);
  fs.writeFileSync(outPath, JSON.stringify(raw, null, 2) + "\n", "utf8");

  process.stdout.write(formatReport(rep) + "\n\n");
  process.stdout.write("wrote " + outPath + "\n");
}

module.exports = {
  parseFrontmatter,
  parseDeckMd,
  normaliseNarration,
  fillBeats,
  buildRawDeck,
  report,
  formatReport,
  msToClock,
  defaultOut,
  parseArgs,
};

if (require.main === module) main(process.argv.slice(2));
