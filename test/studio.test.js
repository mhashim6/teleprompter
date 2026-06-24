"use strict";
/* Tests for TP.Studio (src/studio.js) — the pure deck-editor core. No DOM.
   Loads the classic scripts into Node via the window shim, in dependency order
   (Const -> Schema -> Engine -> Studio). */
const test = require("node:test");
const assert = require("node:assert");

global.window = global;
require("../src/constants.js");
require("../src/schema.js");
require("../src/engine.js");
require("../src/studio.js");
const S = window.TP.Studio;
const Engine = window.TP.Engine;
const Schema = window.TP.Schema;

/* ---- blankSlide / blankDeck ---- */
test("blankSlide: empty fields, null estimate, given number", () => {
  assert.deepStrictEqual(S.blankSlide(3),
    { number:3, title:"", type:"", onScreen:"", script:"", estimatedMinutes:null });
  assert.strictEqual(S.blankSlide().number, 1);   // defaults to 1
});

test("blankDeck: one blank slide, empty id, default title", () => {
  const d = S.blankDeck();
  assert.strictEqual(d.meta.id, "");
  assert.strictEqual(d.meta.title, "Untitled deck");
  assert.strictEqual(d.slides.length, 1);
  assert.strictEqual(d.slides[0].number, 1);
});

/* ---- renumber ---- */
test("renumber: reindexes 1..n without mutating input", () => {
  const input = [{number:9,title:"a"},{number:4,title:"b"}];
  const out = S.renumber(input);
  assert.deepStrictEqual(out.map(s=>s.number), [1,2]);
  assert.strictEqual(out[0].title, "a");
  assert.strictEqual(input[0].number, 9);          // input untouched
});

/* ---- addSlide ---- */
test("addSlide: inserts a blank at index and renumbers", () => {
  const slides = [S.blankSlide(1), S.blankSlide(2)];
  slides[0].title = "first"; slides[1].title = "second";
  const out = S.addSlide(slides, 1);
  assert.strictEqual(out.length, 3);
  assert.deepStrictEqual(out.map(s=>s.title), ["first","","second"]);
  assert.deepStrictEqual(out.map(s=>s.number), [1,2,3]);
  assert.strictEqual(slides.length, 2);            // input untouched
});

test("addSlide: null index appends at the end", () => {
  const out = S.addSlide([S.blankSlide(1)], null);
  assert.strictEqual(out.length, 2);
  assert.strictEqual(out[1].number, 2);
});

/* ---- removeSlide ---- */
test("removeSlide: drops the index and renumbers", () => {
  const slides = S.renumber([{title:"a"},{title:"b"},{title:"c"}]);
  const out = S.removeSlide(slides, 1);
  assert.deepStrictEqual(out.map(s=>s.title), ["a","c"]);
  assert.deepStrictEqual(out.map(s=>s.number), [1,2]);
});

test("removeSlide: never empties the deck — last removal leaves one blank", () => {
  const out = S.removeSlide([S.blankSlide(1)], 0);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].title, "");
  assert.strictEqual(out[0].number, 1);
});

test("removeSlide: out-of-range index is a no-op copy", () => {
  const slides = S.renumber([{title:"a"},{title:"b"}]);
  assert.deepStrictEqual(S.removeSlide(slides, 9).map(s=>s.title), ["a","b"]);
  assert.deepStrictEqual(S.removeSlide(slides, -1).map(s=>s.title), ["a","b"]);
});

/* ---- duplicateSlide ---- */
test("duplicateSlide: inserts an independent deep copy after the source", () => {
  const slides = S.renumber([{title:"a", script:"x"},{title:"b"}]);
  const out = S.duplicateSlide(slides, 0);
  assert.deepStrictEqual(out.map(s=>s.title), ["a","a","b"]);
  assert.deepStrictEqual(out.map(s=>s.number), [1,2,3]);
  out[1].script = "changed";                       // mutate the copy
  assert.strictEqual(out[0].script, "x");          // original unaffected
  assert.strictEqual(slides[0].script, "x");
});

test("duplicateSlide: out-of-range is a no-op copy", () => {
  const slides = S.renumber([{title:"a"}]);
  assert.deepStrictEqual(S.duplicateSlide(slides, 5).map(s=>s.title), ["a"]);
});

/* ---- moveSlide ---- */
test("moveSlide: reorders and renumbers", () => {
  const slides = S.renumber([{title:"a"},{title:"b"},{title:"c"}]);
  assert.deepStrictEqual(S.moveSlide(slides, 0, 2).map(s=>s.title), ["b","c","a"]);
  assert.deepStrictEqual(S.moveSlide(slides, 2, 0).map(s=>s.title), ["c","a","b"]);
  assert.deepStrictEqual(S.moveSlide(slides, 0, 2).map(s=>s.number), [1,2,3]);
});

test("moveSlide: clamps target and no-ops on same / out-of-range", () => {
  const slides = S.renumber([{title:"a"},{title:"b"},{title:"c"}]);
  assert.deepStrictEqual(S.moveSlide(slides, 1, 1).map(s=>s.title), ["a","b","c"]);
  assert.deepStrictEqual(S.moveSlide(slides, 0, 9).map(s=>s.title), ["b","c","a"]); // clamped to last
  assert.deepStrictEqual(S.moveSlide(slides, 9, 0).map(s=>s.title), ["a","b","c"]); // bad source
});

/* ---- ensureUniqueId ---- */
test("ensureUniqueId: stable when free, suffixed on collision", () => {
  assert.strictEqual(S.ensureUniqueId("talk", []), "talk");
  assert.strictEqual(S.ensureUniqueId("talk", ["other"]), "talk");
  assert.strictEqual(S.ensureUniqueId("talk", ["talk"]), "talk-2");
  assert.strictEqual(S.ensureUniqueId("talk", ["talk","talk-2"]), "talk-3");
  assert.strictEqual(S.ensureUniqueId("", ["deck"]), "deck-2");   // empty -> "deck"
});

/* ---- serialize ---- */
test("serialize: drops empty optionals, keeps script, renumbers, carries id", () => {
  const form = {
    meta:{ id:"my-talk", title:"  My Talk  " },
    slides:[
      { title:" Intro ", type:"", onScreen:"", script:" Hello world. ", estimatedMinutes:3 },
      { title:"", type:"q-and-a", onScreen:"a chart", script:"", estimatedMinutes:0 }
    ]
  };
  const raw = S.serialize(form);
  assert.strictEqual(raw.meta.id, "my-talk");
  assert.strictEqual(raw.meta.title, "My Talk");          // trimmed
  assert.deepStrictEqual(raw.slides[0], { number:1, title:"Intro", script:"Hello world.", estimatedMinutes:3 });
  // slide 2: no title/script, est 0 dropped, type + onScreen kept
  assert.deepStrictEqual(raw.slides[1], { number:2, type:"q-and-a", onScreen:"a chart" });
  assert.ok(!("paragraphs" in raw.slides[0]));            // never emits paragraphs
});

test("serialize: blank title and no id default cleanly", () => {
  const raw = S.serialize({ meta:{ title:"  " }, slides:[ S.blankSlide(1) ] });
  assert.strictEqual(raw.meta.title, "Untitled deck");
  assert.ok(!("id" in raw.meta));
  assert.deepStrictEqual(raw.slides[0], { number:1 });    // everything empty dropped
});

test("serialize: keeps internal paragraph breaks in script", () => {
  const raw = S.serialize({ meta:{title:"t"}, slides:[{ script:"  a\n\nb  " }] });
  assert.strictEqual(raw.slides[0].script, "a\n\nb");     // ends trimmed, middle kept
});

test("serialize round-trips through Schema.normalise with a stable id (edit-in-place)", () => {
  const form = { meta:{ id:"keep-me", title:"Keep" }, slides:[ {script:"one two"}, {script:"three"} ] };
  const raw = S.serialize(form);
  const a = Schema.normalise(raw);
  const b = Schema.normalise(S.serialize(form));
  assert.strictEqual(a.id, "keep-me");
  assert.strictEqual(a.id, b.id);                         // id stable across re-serialise
  assert.strictEqual(a.slides.length, 2);
});

/* ---- estimateSlide / estimateDeck ---- */
test("estimateSlide: words exclude pauses; ms includes pauses + punctuation", () => {
  // base @120 = 500ms; "two." sentence-final ×1.9 = 950; pause 500 absolute.
  const e = S.estimateSlide({ script:"one two. [[pause:0.5]] three" }, 120);
  assert.strictEqual(e.words, 3);
  assert.strictEqual(e.ms, 500 + 950 + 500 + 500);        // 2450
});

test("estimateSlide: pause ms constant across wpm, words unchanged", () => {
  const slide = { script:"one two. [[pause:0.5]] three" };
  const slow = S.estimateSlide(slide, 60);                // base 1000
  assert.strictEqual(slow.words, 3);
  assert.strictEqual(slow.ms, 1000 + 1900 + 500 + 1000);  // 4400; pause still 500
});

test("estimateSlide: matches Engine.totalsMs on the normalised slide (golden)", () => {
  const raw = { script:"alpha, beta gamma." };
  const got = S.estimateSlide(raw, 130);
  const norm = Schema.normalise({ slides:[raw] }).slides[0];
  const cum = Engine.totalsMs(Engine.flatSeq(norm), 130);
  assert.strictEqual(got.ms, cum[cum.length-1]);
  assert.strictEqual(got.words, norm.wordCount);
});

test("estimateSlide: empty slide is zero", () => {
  assert.deepStrictEqual(S.estimateSlide({}, 130), { words:0, ms:0 });
  assert.deepStrictEqual(S.estimateSlide({script:"   "}, 130), { words:0, ms:0 });
});

test("estimateDeck: sums words and ms across slides", () => {
  const deck = { slides:[ {script:"one two"}, {script:"three four five"} ] };
  const e = S.estimateDeck(deck, 120);
  assert.strictEqual(e.words, 5);
  assert.strictEqual(e.ms, 5 * 500);                       // 5 plain words @500ms
});

test("estimateDeck: empty deck is zero", () => {
  assert.deepStrictEqual(S.estimateDeck({slides:[]}, 130), { words:0, ms:0 });
  assert.deepStrictEqual(S.estimateDeck(null, 130), { words:0, ms:0 });
});
