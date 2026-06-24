"use strict";
/* Tests for TP.Engine (src/engine.js) — the pure timing core. Loaded the same
   way as schema: alias window to the global, require the classic scripts in
   dependency order, then pull the public API off window.TP. */
const test = require("node:test");
const assert = require("node:assert");

global.window = global;
require("../src/constants.js");
require("../src/engine.js");
const E = window.TP.Engine;

const word = t => ({kind:"word", text:t});
const pause = ms => ({kind:"pause", ms});
const slideOf = (...paras) => ({paragraphs: paras.map(toks => ({tokens: toks}))});

/* ---- itemDuration ---- */
test("itemDuration: plain word = 60000/wpm", () => {
  assert.strictEqual(E.itemDuration(word("hello"), 120), 500);
  assert.strictEqual(E.itemDuration(word("hello"), 60), 1000);
});

test("itemDuration: sentence-final punctuation scales by 1.9", () => {
  for(const t of ["end.", "what?", "go!", "wait…"]){
    assert.strictEqual(E.itemDuration(word(t), 120), 500 * 1.9, t);
  }
});

test("itemDuration: clause punctuation scales by 1.4", () => {
  for(const t of ["first,", "next;", "then:"]){
    assert.strictEqual(E.itemDuration(word(t), 120), 500 * 1.4, t);
  }
});

test("itemDuration: ellipsis char \\u2026 is sentence-final", () => {
  assert.strictEqual(E.itemDuration(word("wait…"), 120), 500 * 1.9);
});

test("itemDuration: a pause is its absolute ms, never pace-scaled", () => {
  for(const wpm of [60, 120, 220]){
    assert.strictEqual(E.itemDuration(pause(1000), wpm), 1000, "wpm="+wpm);
    assert.strictEqual(E.itemDuration(pause(250), wpm), 250, "wpm="+wpm);
  }
});

test("itemDuration: missing item falls back to base", () => {
  assert.strictEqual(E.itemDuration(undefined, 120), 500);
});

test("itemDuration: custom multipliers are honoured", () => {
  assert.strictEqual(E.itemDuration(word("end."), 120, {sentence:3, clause:2}), 1500);
  assert.strictEqual(E.itemDuration(word("a,"),  120, {sentence:3, clause:2}), 1000);
});

/* ---- flatSeq ---- */
test("flatSeq: concatenates paragraph tokens in order", () => {
  const s = slideOf([word("a"), word("b")], [word("c")]);
  assert.deepStrictEqual(E.flatSeq(s).map(t=>t.text), ["a","b","c"]);
});

test("flatSeq: empty / null slide -> []", () => {
  assert.deepStrictEqual(E.flatSeq(null), []);
  assert.deepStrictEqual(E.flatSeq(slideOf()), []);
});

/* ---- totalsMs ---- */
test("totalsMs: cum[0] is 0 and length is seq+1", () => {
  const seq = [word("a"), word("b"), word("c")];
  const cum = E.totalsMs(seq, 120);
  assert.strictEqual(cum[0], 0);
  assert.strictEqual(cum.length, seq.length + 1);
});

test("totalsMs: monotonic non-decreasing", () => {
  const seq = [word("a"), pause(0), word("b."), word("c,")];
  const cum = E.totalsMs(seq, 120);
  for(let i=1;i<cum.length;i++) assert.ok(cum[i] >= cum[i-1], "i="+i);
});

test("totalsMs: exact cumulative arithmetic incl. pauses", () => {
  // wpm 120 -> base 500. word=500, sentence=950, pause=1000 (unscaled), clause=700
  const seq = [word("hi"), word("end."), pause(1000), word("a,")];
  assert.deepStrictEqual(E.totalsMs(seq, 120), [0, 500, 1450, 2450, 3150]);
});

test("totalsMs: recomputes at a different pace (pauses stay fixed)", () => {
  const seq = [word("hi"), pause(1000)];
  assert.deepStrictEqual(E.totalsMs(seq, 60),  [0, 1000, 2000]); // base 1000 + fixed 1000
  assert.deepStrictEqual(E.totalsMs(seq, 120), [0, 500, 1500]);  // base 500  + fixed 1000
});

test("totalsMs: empty sequence -> [0]", () => {
  assert.deepStrictEqual(E.totalsMs([], 120), [0]);
});

/* ---- clampPos ---- */
test("clampPos: bounds, in-range, overflow, underflow", () => {
  assert.strictEqual(E.clampPos(5, 0, 10), 5);
  assert.strictEqual(E.clampPos(-3, 0, 10), 0);
  assert.strictEqual(E.clampPos(99, 0, 10), 10);
  assert.strictEqual(E.clampPos(0, 0, 0), 0);
});

/* ---- paceFromSlide ---- */
test("paceFromSlide: rounds to step and clamps to bounds", () => {
  // 600 words / 4 min = 150 -> rounds to 150
  assert.strictEqual(E.paceFromSlide(600, 4), 150);
  // 1000 / 2 = 500 -> clamps to 220
  assert.strictEqual(E.paceFromSlide(1000, 2), 220);
  // 30 / 2 = 15 -> clamps to 60
  assert.strictEqual(E.paceFromSlide(30, 2), 60);
  // 153/1 = 153 -> rounds to 155 (nearest multiple of 5)
  assert.strictEqual(E.paceFromSlide(153, 1), 155);
});

test("paceFromSlide: missing data -> null", () => {
  assert.strictEqual(E.paceFromSlide(0, 4), null);
  assert.strictEqual(E.paceFromSlide(600, 0), null);
  assert.strictEqual(E.paceFromSlide(undefined, undefined), null);
});

test("paceFromSlide: custom bounds honoured", () => {
  assert.strictEqual(E.paceFromSlide(1000, 2, {min:10, max:300, step:10}), 300);
});
