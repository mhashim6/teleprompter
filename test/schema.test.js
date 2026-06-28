"use strict";
/* Tests for TP.Schema (src/schema.js). The classic script attaches to a global
   `window`, so we stub it, require the file, and pull the public API off it. */
const test = require("node:test");
const assert = require("node:assert");

// The classic script does `window.TP = window.TP || {}` then references bare `TP`.
// In a browser those are the same global object; in Node we make `window` alias the
// global object so the bare `TP` reference inside the IIFE resolves the same way.
global.window = global;
require("../src/schema.js");
const { normalise, slug, clean } = window.TP.Schema;

// helper: collect words of a slide as a flat string
function words(slide){
  return slide.paragraphs
    .map(p => p.tokens.filter(t => t.kind === "word").map(t => t.text).join(" "))
    .join(" | ");
}
function pauses(slide){
  return slide.paragraphs.flatMap(p => p.tokens).filter(t => t.kind === "pause").map(t => t.ms);
}

/* ---- content source fallback: paragraphs -> script -> text ---- */

test("uses paragraphs when present", () => {
  const d = normalise({ slides: [{ paragraphs: ["alpha beta", "gamma"] }] }, "f");
  assert.equal(d.slides.length, 1);
  assert.equal(d.slides[0].paragraphs.length, 2);
  assert.equal(words(d.slides[0]), "alpha beta | gamma");
});

test("falls back to script (blank-line split) when no paragraphs", () => {
  const d = normalise({ slides: [{ script: "one two\n\nthree four" }] }, "f");
  assert.equal(d.slides[0].paragraphs.length, 2);
  assert.equal(words(d.slides[0]), "one two | three four");
});

test("falls back to text when neither paragraphs nor script", () => {
  const d = normalise({ slides: [{ text: "solo line" }] }, "f");
  assert.equal(words(d.slides[0]), "solo line");
});

test("paragraphs precedence over script and text", () => {
  const d = normalise({ slides: [{ paragraphs: ["P"], script: "S", text: "T" }] }, "f");
  assert.equal(words(d.slides[0]), "P");
});

/* ---- pause forms and ms/seconds rules ---- */

test("[[pause]] defaults to 1000ms and is not a word", () => {
  const d = normalise({ slides: [{ text: "a [[pause]] b" }] }, "f");
  assert.deepEqual(pauses(d.slides[0]), [1000]);
  assert.equal(words(d.slides[0]), "a b");
});

test("[[pause:1.5]] is 1.5 seconds = 1500ms", () => {
  const d = normalise({ slides: [{ text: "x [[pause:1.5]] y" }] }, "f");
  assert.deepEqual(pauses(d.slides[0]), [1500]);
});

test("[[pause:500ms]] is 500ms", () => {
  const d = normalise({ slides: [{ text: "x [[pause:500ms]] y" }] }, "f");
  assert.deepEqual(pauses(d.slides[0]), [500]);
});

test("[[beat]] is an alias for [[pause]] (1000ms)", () => {
  const d = normalise({ slides: [{ text: "x [[beat]] y" }] }, "f");
  assert.deepEqual(pauses(d.slides[0]), [1000]);
});

test("bare number is seconds: [[pause:2]] = 2000ms", () => {
  const d = normalise({ slides: [{ text: "[[pause:2]]" }] }, "f");
  assert.deepEqual(pauses(d.slides[0]), [2000]);
});

test("explicit s unit is seconds: [[pause:3s]] = 3000ms", () => {
  const d = normalise({ slides: [{ text: "[[pause:3s]]" }] }, "f");
  assert.deepEqual(pauses(d.slides[0]), [3000]);
});

/* ---- wordCount excludes pauses ---- */

test("computed wordCount excludes pause tokens", () => {
  const d = normalise({ slides: [{ text: "one [[pause]] two three [[beat]]" }] }, "f");
  assert.equal(d.slides[0].wordCount, 3);
  assert.equal(d.slides[0].total, 5); // 3 words + 2 pauses (position space)
});

test("declared wordCount is honoured over computed", () => {
  const d = normalise({ slides: [{ text: "a b c", wordCount: 99 }] }, "f");
  assert.equal(d.slides[0].wordCount, 99);
});

/* ---- id derivation ---- */

test("id comes from the filename slug", () => {
  const d = normalise({ slides: [{ text: "hi" }] }, "My Deck 64-69");
  assert.equal(d.id, "my-deck-64-69");
});

test("meta.id takes precedence over filename", () => {
  const d = normalise({ meta: { id: "Stable ID!" }, slides: [{ text: "hi" }] }, "filename");
  assert.equal(d.id, "stable-id");
});

test("falls back to a content hash when no name and no meta.id", () => {
  const d = normalise({ slides: [{ text: "hello world" }] }, "");
  assert.ok(d.id && d.id.length > 0);
  assert.ok(!/[^a-z0-9]/.test(d.id)); // hash is base36
});

test("same filename -> same id (position survives text edits)", () => {
  const a = normalise({ slides: [{ text: "version one" }] }, "talk");
  const b = normalise({ slides: [{ text: "version two, edited" }] }, "talk");
  assert.equal(a.id, b.id);
});

/* ---- title derivation ---- */

test("title is meta.title, else filename, else Untitled deck", () => {
  assert.equal(normalise({ meta: { title: "T" }, slides: [{ text: "x" }] }, "fn").title, "T");
  assert.equal(normalise({ slides: [{ text: "x" }] }, "fn").title, "fn");
  assert.equal(normalise({ slides: [{ text: "x" }] }, "").title, "Untitled deck");
});

/* ---- shape tolerance ---- */

test("accepts a bare array of slides", () => {
  const d = normalise([{ text: "a b" }, { text: "c" }], "f");
  assert.equal(d.slides.length, 2);
  assert.equal(words(d.slides[0]), "a b");
});

test("empty input yields zero slides", () => {
  assert.equal(normalise({}, "f").slides.length, 0);
  assert.equal(normalise(null, "f").slides.length, 0);
  assert.equal(normalise([], "f").slides.length, 0);
});

test("garbage input yields zero slides without throwing", () => {
  assert.equal(normalise("not a deck", "f").slides.length, 0);
  assert.equal(normalise(42, "f").slides.length, 0);
  assert.equal(normalise(true, "f").slides.length, 0);
});

test("slide number defaults to index+1, declared number honoured", () => {
  const d = normalise({ slides: [{ text: "a" }, { number: 64, text: "b" }] }, "f");
  assert.equal(d.slides[0].number, 1);
  assert.equal(d.slides[1].number, 64);
});

/* ---- clean(): control-char stripping, coercion, caps ---- */

test("clean strips control characters", () => {
  assert.equal(clean("a\x00b\x07c\x1Fd"), "abcd");  // NUL, BEL, US stripped
  assert.equal(clean("line\tbreak"), "linebreak");  // tab stripped
  assert.equal(clean("mid\bdle"), "middle");        // backspace stripped
  assert.equal(clean("keep©"), "keep©");  // non-control char preserved
});

test("clean coerces non-strings", () => {
  assert.equal(clean(123), "123");
  assert.equal(clean(null), "");
  assert.equal(clean(undefined), "");
  assert.equal(clean(true), "true");
});

test("clean trims surrounding whitespace", () => {
  assert.equal(clean("  hi  "), "hi");
});

test("clean caps length", () => {
  assert.equal(clean("abcdef", 3), "abc");
  assert.equal(clean("abc", 10), "abc");
});

test("deck strings are cleaned through normalise (control chars removed)", () => {
  const d = normalise({
    meta: { title: "Ti\x00tle" },
    slides: [{ title: "Hel\x07lo", type: "sec\x1Ftion", onScreen: "scr\teen", text: "body" }]
  }, "f");
  assert.equal(d.title, "Title");
  assert.equal(d.slides[0].title, "Hello");
  assert.equal(d.slides[0].type, "section");
  assert.equal(d.slides[0].onScreen, "screen");
});

test("HTML in deck strings is preserved as literal text (no markup interpreted)", () => {
  const d = normalise({ slides: [{ title: "<img src=x onerror=alert(1)>", text: "a" }] }, "f");
  // clean() only strips control chars; the angle brackets stay as literal text,
  // and the UI renders this via textContent so nothing executes.
  assert.equal(d.slides[0].title, "<img src=x onerror=alert(1)>");
});

test("slide title length is capped", () => {
  const long = "x".repeat(500);
  const d = normalise({ slides: [{ title: long, text: "a" }] }, "f");
  assert.equal(d.slides[0].title.length, 200); // MAX_TITLE
});

/* ---- numeric coercion ---- */

test("non-finite numerics coerce to null/computed", () => {
  const d = normalise({
    slides: [{ estimatedMinutes: NaN, wordCount: Infinity, text: "a b" }]
  }, "f");
  assert.equal(d.slides[0].estimatedMinutes, null);
  assert.equal(d.slides[0].wordCount, 2); // falls back to computed
});

test("string numerics are not accepted as numbers", () => {
  const d = normalise({ slides: [{ estimatedMinutes: "6", text: "a" }] }, "f");
  assert.equal(d.slides[0].estimatedMinutes, null);
});

/* ---- caps on pathological decks ---- */

test("slide count is capped at MAX_SLIDES", () => {
  const many = Array.from({ length: 3000 }, () => ({ text: "a" }));
  const d = normalise({ slides: many }, "f");
  assert.equal(d.slides.length, 2000); // MAX_SLIDES
});

test("tokens per slide are capped at MAX_TOKENS", () => {
  const huge = Array.from({ length: 70000 }, () => "w").join(" ");
  const d = normalise({ slides: [{ text: huge }] }, "f");
  assert.equal(d.slides[0].total, 60000); // MAX_TOKENS
});

/* ---- slug() helper ---- */

test("slug lowercases, dashes non-alphanumerics, trims", () => {
  assert.equal(slug("Hello, World!"), "hello-world");
  assert.equal(slug("  --Foo__Bar--  "), "foo-bar");
  assert.equal(slug(""), "");
  assert.equal(slug(null), "");
  assert.equal(slug("***"), "");
});

/* ---- hidden field (Edit 1) ---- */

test("hidden normalises to true only for literal true", () => {
  const d = normalise({ slides: [{ text:"a", hidden:true }] }, "f");
  assert.strictEqual(d.slides[0].hidden, true);
});

test("hidden is false for absent, false, junk values", () => {
  const cases = [
    { text:"a" },              // absent
    { text:"a", hidden:false },
    { text:"a", hidden:1 },    // junk
    { text:"a", hidden:"true" },
    { text:"a", hidden:null },
  ];
  const d = normalise({ slides: cases }, "f");
  d.slides.forEach((s, i) => assert.strictEqual(s.hidden, false, "case "+i));
});

/* ---- slideRange ---- */

test("slideRange uses meta when given, else derives from numbers", () => {
  assert.equal(normalise({ meta: { slideRange: "64-69" }, slides: [{ text: "a" }] }, "f").slideRange, "64-69");
  const d = normalise({ slides: [{ number: 10, text: "a" }, { number: 12, text: "b" }] }, "f");
  assert.equal(d.slideRange, "10-12");
});
