"use strict";
/* Tests for TP.Welcome (src/welcome.js) — the landing-session deck DATA. No DOM.
   Loads the classic scripts into Node via the window shim, in dependency order
   (Const -> Schema -> Engine -> Welcome). Guards that the welcome copy still
   normalises to a playable, pause-bearing deck as the text is edited. */
const test = require("node:test");
const assert = require("node:assert");

global.window = global;
require("../src/constants.js");
require("../src/schema.js");
require("../src/engine.js");
require("../src/welcome.js");
const Welcome = window.TP.Welcome;
const Schema = window.TP.Schema;
const Engine = window.TP.Engine;

test("RAW normalises to exactly one playable slide", () => {
  const deck = Schema.normalise(Welcome.RAW, "welcome");
  assert.strictEqual(deck.slides.length, 1);
  const s = deck.slides[0];
  assert.ok(s.wordCount > 0, "has words");
  assert.ok(s.total > 0, "has a position space");
  assert.ok(deck.title, "has a title");
});

test("the welcome slide includes at least one pause beat (total > wordCount)", () => {
  const s = Schema.normalise(Welcome.RAW, "welcome").slides[0];
  // total counts words + pauses; a gap proves the [[pause]] beats survive.
  assert.ok(s.total > s.wordCount, "pause tokens present");
});

test("the slide is playable: a positive total duration at a normal pace", () => {
  const s = Schema.normalise(Welcome.RAW, "welcome").slides[0];
  const ms = Engine.totalsMs(Engine.flatSeq(s), 130).at(-1);
  assert.ok(ms > 0, "non-zero spoken duration");
});

test("RAW is frozen (immutable data module)", () => {
  assert.ok(Object.isFrozen(Welcome));
});
