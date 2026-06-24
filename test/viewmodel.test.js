"use strict";
/* Tests for TP.ViewModel (src/viewmodel.js) — the pure render-decision layer
   lifted out of the old paint()/renderSlide(). No DOM required. */
const test = require("node:test");
const assert = require("node:assert");

global.window = global;
require("../src/viewmodel.js");
const VM = window.TP.ViewModel;

/* ---- fmtTime ---- */
test("fmtTime: pads, rounds, clamps negatives", () => {
  assert.strictEqual(VM.fmtTime(0), "0:00");
  assert.strictEqual(VM.fmtTime(5), "0:05");
  assert.strictEqual(VM.fmtTime(65), "1:05");
  assert.strictEqual(VM.fmtTime(600), "10:00");
  assert.strictEqual(VM.fmtTime(-3), "0:00");
  assert.strictEqual(VM.fmtTime(1.4), "0:01");
});

/* ---- prettyType ---- */
test("prettyType: dashes/underscores to spaces; empty for nullish", () => {
  assert.strictEqual(VM.prettyType("deep-dive"), "deep dive");
  assert.strictEqual(VM.prettyType("call_to_action"), "call to action");
  assert.strictEqual(VM.prettyType(undefined), "");
  assert.strictEqual(VM.prettyType(null), "");
});

/* ---- tokenClasses ---- */
test("tokenClasses: done / cur / upcoming, with pause vs word base", () => {
  const kinds = ["word","pause","word"];
  assert.deepStrictEqual(VM.tokenClasses(0, kinds), ["w cur","pause","w"]);
  assert.deepStrictEqual(VM.tokenClasses(1, kinds), ["w done","pause cur","w"]);
  // word === total: everything done, nothing current
  assert.deepStrictEqual(VM.tokenClasses(3, kinds), ["w done","pause done","w done"]);
});

/* ---- progressPct ---- */
test("progressPct: ratio, clamp, and zero-length", () => {
  assert.strictEqual(VM.progressPct(1, 4), "25%");
  assert.strictEqual(VM.progressPct(0, 0), "0%");
  assert.strictEqual(VM.progressPct(5, 4), "100%");   // clamped
  assert.strictEqual(VM.progressPct(0, 2), "0%");
});

/* ---- clockText ---- */
test("clockText: elapsed / total, empty when no total", () => {
  const cum = [0, 1000, 3000];
  assert.strictEqual(VM.clockText(cum, 1, 2), "0:01 / 0:03");
  assert.strictEqual(VM.clockText(cum, 0, 2), "0:00 / 0:03");
  assert.strictEqual(VM.clockText(cum, 2, 2), "0:03 / 0:03");
  assert.strictEqual(VM.clockText(cum, 0, 0), "");
});

/* ---- slideMeta ---- */
test("slideMeta: full slide", () => {
  const m = VM.slideMeta({number:5, type:"deep-dive", estimatedMinutes:3, wordCount:120, onScreen:"a chart"});
  assert.deepStrictEqual(m, {
    num:"slide 5", type:"deep dive", est:"~3 min", words:"120 words",
    hasOnScreen:true, onScreen:" a chart"
  });
});

test("slideMeta: sparse slide uses dash + empty fields", () => {
  const m = VM.slideMeta({number:1});
  assert.strictEqual(m.num, "slide 1");
  assert.strictEqual(m.type, "—");
  assert.strictEqual(m.est, "");
  assert.strictEqual(m.words, "");
  assert.strictEqual(m.hasOnScreen, false);
  assert.strictEqual(m.onScreen, "");
});

/* ---- nextHint ---- */
test("nextHint: returns next-slide data mid-deck", () => {
  const deck = { slides:[{number:1},{number:2, title:"Two", type:"q-and-a"},{number:3}] };
  assert.deepStrictEqual(VM.nextHint(deck, 1), {kind:"next", number:3, title:undefined, type:""});
  assert.deepStrictEqual(VM.nextHint(deck, 0), {kind:"next", number:2, title:"Two", type:"q and a"});
});

test("nextHint: last slide", () => {
  const deck = { slides:[{number:1},{number:2}] };
  assert.deepStrictEqual(VM.nextHint(deck, 1), {kind:"last"});
});

/* ---- scrollTarget ---- */
test("scrollTarget: anchors a token within the reader height", () => {
  assert.strictEqual(VM.scrollTarget(1000, 30, 600, 0.22), 1000 - 600*0.22 + 15);
  assert.strictEqual(VM.scrollTarget(0, 40, 800, 0.5), 0 - 400 + 20);
});
