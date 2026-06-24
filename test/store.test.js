"use strict";
/* Tests for TP.Store (src/store.js). We inject a fresh in-memory backend per
   test via Store.configure({backend}) so cases are isolated, and a throwing
   backend to exercise the error sink. */
const test = require("node:test");
const assert = require("node:assert");

global.window = global;
require("../src/store.js");
const Store = window.TP.Store;

function mapBackend(){
  const m = new Map();
  return {
    getItem:k=>m.has(k)?m.get(k):null,
    setItem:(k,v)=>m.set(k,String(v)),
    removeItem:k=>m.delete(k)
  };
}
// Reset to a clean store + capturing error sink before each case.
function setup(){
  const errs = [];
  Store.configure({ backend: mapBackend(), onError:(op,key,e)=>errs.push({op,key,e}) });
  return { errs };
}

test("getPrefs returns the defaults when nothing is stored", () => {
  setup();
  const p = Store.getPrefs();
  assert.strictEqual(p.theme, "day");
  assert.strictEqual(p.wpm, 130);
  assert.strictEqual(p.fontScale, 1);
  assert.strictEqual(p.lineHeight, 1.62);
  assert.strictEqual(p.guide, true);
});

test("setPrefs merges a patch over existing prefs", () => {
  setup();
  Store.setPrefs({wpm:170});
  Store.setPrefs({theme:"night"});
  const p = Store.getPrefs();
  assert.strictEqual(p.wpm, 170);     // preserved across the second patch
  assert.strictEqual(p.theme, "night");
});

test("saveDeck dedups by id and unshifts newest to front", () => {
  setup();
  Store.saveDeck({id:"a", name:"a", title:"A"}, {x:1});
  Store.saveDeck({id:"b", name:"b", title:"B"}, {x:2});
  assert.deepStrictEqual(Store.listDecks().map(d=>d.id), ["b","a"]);

  Store.saveDeck({id:"a", name:"a", title:"A2"}, {x:3});   // re-save existing
  const idx = Store.listDecks();
  assert.deepStrictEqual(idx.map(d=>d.id), ["a","b"]);     // moved to front, no dup
  assert.strictEqual(idx.length, 2);
  assert.strictEqual(idx[0].title, "A2");
  assert.deepStrictEqual(Store.getRaw("a"), {x:3});         // raw body updated
});

test("removeDeck clears index entry, raw, pos, and active", () => {
  setup();
  Store.saveDeck({id:"a", name:"a", title:"A"}, {x:1});
  Store.setPos("a", {slideIndex:2, word:5});
  Store.setActive("a");
  Store.removeDeck("a");
  assert.deepStrictEqual(Store.listDecks(), []);
  assert.strictEqual(Store.getRaw("a"), null);
  assert.deepStrictEqual(Store.getPos("a"), {slideIndex:0, word:0});
  assert.strictEqual(Store.getActive(), null);
});

test("getPos default, setPos round-trip, resetPos", () => {
  setup();
  assert.deepStrictEqual(Store.getPos("z"), {slideIndex:0, word:0});
  Store.setPos("z", {slideIndex:1, word:9});
  const p = Store.getPos("z");
  assert.strictEqual(p.slideIndex, 1);
  assert.strictEqual(p.word, 9);
  Store.resetPos("z");
  const r = Store.getPos("z");
  assert.strictEqual(r.slideIndex, 0);
  assert.strictEqual(r.word, 0);
});

test("setActive(null) deletes the active key", () => {
  setup();
  Store.setActive("a");
  assert.strictEqual(Store.getActive(), "a");
  Store.setActive(null);
  assert.strictEqual(Store.getActive(), null);
});

test("a write failure triggers onError and does not throw", () => {
  const errs = [];
  Store.configure({
    backend: { getItem:()=>null, setItem:()=>{ throw new Error("quota"); }, removeItem:()=>{} },
    onError:(op,key,e)=>errs.push({op,key,msg:e.message})
  });
  assert.doesNotThrow(()=> Store.setPos("a", {slideIndex:1, word:1}));
  assert.ok(errs.length >= 1, "onError was called");
  assert.strictEqual(errs[0].op, "set");
  assert.strictEqual(errs[0].msg, "quota");
});
