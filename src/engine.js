"use strict";
window.TP = window.TP || {};

/* ==========================================================================
   Engine  ->  engine.js
   The pure timing core. No state, no DOM, no timers — just data in, value
   out, so every rule can be unit-tested in isolation. The Prompter is the
   stateful shell that drives these functions.

   Multipliers/bounds default to TP.Const but are accepted as arguments so the
   behaviour is explicit and testable with custom values.
   ========================================================================== */
TP.Engine = (function(){
  const C = TP.Const;

  function clampPos(n, lo, hi){ return Math.max(lo, Math.min(hi, n)); }

  // Index of the next non-hidden slide strictly past `from` in direction dir (+1/-1).
  // Returns -1 if none found.
  function nextVisible(slides, from, dir){
    for(let i=from+dir; i>=0 && i<slides.length; i+=dir){ if(!slides[i].hidden) return i; }
    return -1;
  }
  // `from` if visible, else nearest visible forward, else backward; -1 only if ALL hidden.
  function firstVisible(slides, from){
    if(slides[from] && !slides[from].hidden) return from;
    const f = nextVisible(slides, from, 1); if(f !== -1) return f;
    return nextVisible(slides, from, -1);
  }

  // A slide's tokens, flattened across paragraphs into one position sequence.
  function flatSeq(slide){
    if(!slide) return [];
    return slide.paragraphs.reduce((a,p)=>a.concat(p.tokens), []);
  }

  // Duration in ms of one token at a given pace. A pause is its absolute ms,
  // never pace-scaled; a word is base = BASE_MS_PER_MIN/wpm, multiplied after
  // sentence-final (. ? ! …) or clause (, ; :) punctuation.
  function itemDuration(item, wpm, mults){
    const m = mults || {sentence:C.MULT_SENTENCE, clause:C.MULT_CLAUSE};
    const base = C.BASE_MS_PER_MIN / wpm;
    if(!item) return base;
    if(item.kind === "pause") return item.ms;
    const last = item.text[item.text.length-1];
    if(/[.?!…]/.test(last)) return base * m.sentence;
    if(/[,;:]/.test(last))       return base * m.clause;
    return base;
  }

  // Cumulative ms to reach each index at a given pace, including pauses.
  // cum[0] === 0; cum.length === seq.length + 1.
  function totalsMs(seq, wpm, mults){
    let acc = 0; const cum = [0];
    for(let i=0;i<seq.length;i++){ acc += itemDuration(seq[i], wpm, mults); cum.push(acc); }
    return cum;
  }

  // Borrow a slide's own pace: words/minute rounded to the slider step and
  // clamped to the slider's bounds. Returns null if the slide lacks the data.
  function paceFromSlide(wordCount, estMin, bounds){
    if(!wordCount || !estMin) return null;
    const b = bounds || {min:C.WPM_MIN, max:C.WPM_MAX, step:C.WPM_STEP};
    const stepped = Math.round((wordCount/estMin) / b.step) * b.step;
    return Math.max(b.min, Math.min(b.max, stepped));
  }

  return {clampPos, flatSeq, itemDuration, totalsMs, paceFromSlide, nextVisible, firstVisible};
})();
