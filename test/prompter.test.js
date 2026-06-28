"use strict";
/* Tests for TP.Prompter (src/prompter.js) — the stateful shell. We inject a
   deterministic scheduler (the timer seam) so playback can be advanced one
   token at a time without real time passing. Node 18 has no mock.timers, hence
   the seam. */
const test = require("node:test");
const assert = require("node:assert");

global.window = global;
require("../src/constants.js");
require("../src/engine.js");
require("../src/prompter.js");
const P = window.TP.Prompter;

const word = t => ({kind:"word", text:t});
// Build a deck of slides; each slide is an array of tokens.
function deckOf(...slides){
  return { slides: slides.map(toks => ({ total: toks.length, paragraphs:[{tokens:toks}] })) };
}
// Build a deck where each element is {tokens, hidden}
function deckOfSlides(...descs){
  return { slides: descs.map(d => ({ total: d.tokens.length, paragraphs:[{tokens:d.tokens}], hidden: !!d.hidden })) };
}

// A fake scheduler: holds at most one pending timer (the prompter chains one at
// a time). fireNext() runs it, which advances a word and schedules the next.
function makeFake(){
  let id = 0; const pending = new Map();
  return {
    scheduler: { set:(fn,ms)=>{ const i=++id; pending.set(i,fn); return i; }, clear:i=>pending.delete(i) },
    fireNext(){ const e = pending.entries().next().value; if(!e) return false; pending.delete(e[0]); e[1](); return true; },
    runTicks(n){ let c=0; while(c<n && this.fireNext()) c++; return c; },
    get size(){ return pending.size; }
  };
}

// Fresh state for each test: inject the fake, bind counting callbacks, load.
function fresh(deck, pos){
  const fake = makeFake();
  P.setScheduler(fake.scheduler);
  const calls = {onTick:0,onSlide:0,onState:0,onComplete:0,onError:0, order:[], errs:[]};
  calls.reset = ()=>{ calls.onTick=calls.onSlide=calls.onState=calls.onComplete=calls.onError=0; calls.order.length=0; calls.errs.length=0; };
  P.bind({
    onTick(){ calls.onTick++; calls.order.push("onTick"); },
    onSlide(){ calls.onSlide++; calls.order.push("onSlide"); },
    onState(){ calls.onState++; calls.order.push("onState"); },
    onComplete(){ calls.onComplete++; calls.order.push("onComplete"); },
    onError(e){ calls.onError++; calls.errs.push(e); }
  });
  P.load(deck, pos);
  return {fake, calls};
}

test("tick advances word and fires onTick", () => {
  const {fake, calls} = fresh(deckOf([word("a"),word("b"),word("c")]), {word:0});
  calls.reset();
  P.play();
  assert.strictEqual(P.position().word, 0);
  fake.fireNext();
  assert.strictEqual(P.position().word, 1);
  assert.ok(calls.onTick >= 1);
});

test("playback stops at total, firing onState + onComplete exactly once", () => {
  const {fake, calls} = fresh(deckOf([word("a"),word("b")]), {word:0});
  calls.reset();
  P.play();                 // word 0, schedules
  fake.runTicks(10);        // advance to the end and beyond
  assert.strictEqual(P.position().word, 2);
  assert.strictEqual(P.position().playing, false);
  assert.strictEqual(calls.onComplete, 1);
  // onState fired once on play() and once on completion
  assert.strictEqual(calls.onState, 2);
  assert.strictEqual(fake.size, 0);   // no dangling timer
});

test("play() at the end replays from 0", () => {
  const {fake} = fresh(deckOf([word("a"),word("b")]), {word:0});
  P.play(); fake.runTicks(10);
  assert.strictEqual(P.position().word, 2);   // at end
  P.play();
  assert.strictEqual(P.position().word, 0);   // reset
  assert.strictEqual(P.position().playing, true);
});

test("seek clamps to [0,total]", () => {
  fresh(deckOf([word("a"),word("b"),word("c")]), {word:0});
  P.seek(99); assert.strictEqual(P.position().word, 3);
  P.seek(-5); assert.strictEqual(P.position().word, 0);
  P.seek(2);  assert.strictEqual(P.position().word, 2);
});

test("seek re-arms the timer only while playing", () => {
  const {fake} = fresh(deckOf([word("a"),word("b"),word("c")]), {word:0});
  P.seek(1);
  assert.strictEqual(fake.size, 0);   // paused: no timer armed
  P.play();
  assert.ok(fake.size >= 1);          // playing: timer armed
  P.seek(0);
  assert.strictEqual(fake.size, 1);   // still exactly one pending timer
});

test("restartSlide pauses and seeks to 0", () => {
  const {fake} = fresh(deckOf([word("a"),word("b"),word("c")]), {word:0});
  P.seek(2); P.play();
  P.restartSlide();
  assert.strictEqual(P.position().word, 0);
  assert.strictEqual(P.position().playing, false);
  assert.strictEqual(fake.size, 0);
});

test("gotoSlide / next / prev respect bounds and reset word", () => {
  fresh(deckOf([word("a")],[word("b")],[word("c")]), {slideIndex:1, word:0});
  P.seek(1);
  P.next(); assert.strictEqual(P.position().si, 2); assert.strictEqual(P.position().word, 0);
  P.next(); assert.strictEqual(P.position().si, 2);     // clamped at last
  P.prev(); assert.strictEqual(P.position().si, 1);
  P.gotoSlide(99); assert.strictEqual(P.position().si, 2);
  P.gotoSlide(-1); assert.strictEqual(P.position().si, 0);
  P.prev(); assert.strictEqual(P.position().si, 0);     // clamped at first
});

test("configure({wpm}) updates pace and re-arms while playing", () => {
  const {fake} = fresh(deckOf([word("a"),word("b")]), {word:0});
  P.configure({wpm:90}); assert.strictEqual(P.position().wpm, 90);
  P.play();
  const before = fake.size;
  P.configure({wpm:200});
  assert.strictEqual(P.position().wpm, 200);
  assert.strictEqual(fake.size, before);   // still one pending timer, re-armed
});

test("load fires onSlide before onTick", () => {
  const {calls} = fresh(deckOf([word("a"),word("b")]), {word:0});
  const iSlide = calls.order.indexOf("onSlide");
  const iTick  = calls.order.indexOf("onTick");
  assert.ok(iSlide >= 0 && iTick >= 0);
  assert.ok(iSlide < iTick, "onSlide must precede onTick on load");
  assert.strictEqual(calls.order[calls.order.length-1], "onTick");
});

/* ---- Edit 1: hidden-slide skip in next/prev/load/gotoSlide ---- */

test("next() skips hidden slides", () => {
  // deck: visible, hidden, visible
  fresh(deckOfSlides({tokens:[word("a")]}, {tokens:[word("b")], hidden:true}, {tokens:[word("c")]}), {slideIndex:0});
  P.next();
  assert.strictEqual(P.position().si, 2, "should skip the hidden slide at index 1");
});

test("prev() skips hidden slides", () => {
  fresh(deckOfSlides({tokens:[word("a")]}, {tokens:[word("b")], hidden:true}, {tokens:[word("c")]}), {slideIndex:2});
  P.prev();
  assert.strictEqual(P.position().si, 0, "should skip the hidden slide at index 1");
});

test("next() no-ops when no further visible slides", () => {
  fresh(deckOfSlides({tokens:[word("a")]}, {tokens:[word("b")], hidden:true}), {slideIndex:0});
  P.next();
  assert.strictEqual(P.position().si, 0, "no visible slide ahead, should stay put");
});

test("prev() no-ops when no earlier visible slides", () => {
  fresh(deckOfSlides({tokens:[word("a")], hidden:true}, {tokens:[word("b")]}), {slideIndex:1});
  P.prev();
  assert.strictEqual(P.position().si, 1, "no visible slide behind, should stay put");
});

test("load snaps a saved position on a hidden slide to the nearest visible", () => {
  const deck = deckOfSlides({tokens:[word("a")]}, {tokens:[word("b")], hidden:true}, {tokens:[word("c")]});
  const {calls} = fresh(deck, {slideIndex:1});  // position saved on the hidden slide
  // firstVisible from index 1 should jump to index 2 (forward) or 0 (backward); 2 is tried first
  assert.strictEqual(P.position().si, 2, "should snap forward past the hidden slide");
  assert.ok(calls.onSlide > 0, "onSlide fired");
});

test("load snaps backward when only backward visible slides exist", () => {
  const deck = deckOfSlides({tokens:[word("a")]}, {tokens:[word("b")], hidden:true});
  fresh(deck, {slideIndex:1});  // saved on hidden, no forward visible
  assert.strictEqual(P.position().si, 0, "should snap backward to index 0");
});

test("gotoSlide snaps hidden target to nearest visible", () => {
  fresh(deckOfSlides({tokens:[word("a")]}, {tokens:[word("b")], hidden:true}, {tokens:[word("c")]}), {slideIndex:0});
  P.gotoSlide(1);   // target is hidden
  assert.strictEqual(P.position().si, 2, "should snap forward to index 2");
});

/* ---- Edit 2: play-state preservation through gotoSlide ---- */

test("gotoSlide resumes playback when wasPlaying=true", () => {
  const {fake} = fresh(deckOf([word("a"),word("b")],[word("c")]), {slideIndex:0});
  P.play();
  assert.strictEqual(P.position().playing, true);
  P.gotoSlide(1);   // jump while playing
  assert.strictEqual(P.position().si, 1);
  assert.strictEqual(P.position().playing, true, "should be playing on the new slide");
  assert.ok(fake.size >= 1, "timer should be armed");
});

test("gotoSlide stays paused when wasPlaying=false", () => {
  fresh(deckOf([word("a"),word("b")],[word("c")]), {slideIndex:0});
  // do NOT call P.play()
  assert.strictEqual(P.position().playing, false);
  P.gotoSlide(1);
  assert.strictEqual(P.position().si, 1);
  assert.strictEqual(P.position().playing, false, "should remain paused");
});

test("a throwing onTick does not stop the chain and reaches onError", () => {
  const fake = makeFake();
  P.setScheduler(fake.scheduler);
  let ticks = 0, errs = 0;
  P.bind({
    onTick(){ ticks++; throw new Error("render boom"); },
    onSlide(){}, onState(){}, onComplete(){},
    onError(){ errs++; }
  });
  P.load(deckOf([word("a"),word("b"),word("c")]), {word:0});  // load's onTick throws too
  P.play();
  fake.runTicks(10);                  // must reach the end despite every onTick throwing
  assert.strictEqual(P.position().word, 3);
  assert.strictEqual(P.position().playing, false);
  assert.ok(ticks >= 3, "onTick kept being called");
  assert.ok(errs  >= 3, "onError received each throw");
});
