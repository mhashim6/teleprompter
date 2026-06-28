"use strict";
window.TP = window.TP || {};

/* ==========================================================================
   Studio  ->  studio.js
   The deck-editor's PURE core. Every function is data->data: inputs as args,
   a new value out, no DOM, no module state, no Date.now()/Math.random() (the
   shell supplies ids and timestamps). It builds and transforms the RAW deck
   shape the Store persists and Schema.normalise consumes —

     { meta:{id,title}, slides:[ {number,title,type,onScreen,script,estimatedMinutes} ] }

   — so the editor round-trips through the exact same boundary the player uses.
   Structural ops (add/remove/duplicate/move) return NEW arrays and never
   mutate their input; the live estimate is computed through Schema + Engine so
   it always matches what the player will actually do.
   ========================================================================== */
TP.Studio = (function(){
  const Schema = TP.Schema, Engine = TP.Engine;

  /* ---- construction ---- */
  function blankSlide(number){
    return { number: number||1, title:"", type:"", onScreen:"", script:"", estimatedMinutes:null };
  }
  function blankDeck(){
    return { meta:{ id:"", title:"Untitled deck" }, slides:[ blankSlide(1) ] };
  }
  // deep, independent copy of a flat slide object (plain JSON data only)
  function cloneSlide(s){ return JSON.parse(JSON.stringify(s || {})); }

  /* ---- ordering / structure (immutable; always renumbered 1..n) ---- */
  // position IS the slide number, so every structural op renumbers afterwards.
  function renumber(slides){ return slides.map((s,i)=>Object.assign({}, s, {number:i+1})); }

  function addSlide(slides, atIndex){
    const next = slides.slice();
    const i = (atIndex==null) ? next.length : Math.max(0, Math.min(next.length, atIndex));
    next.splice(i, 0, blankSlide(i+1));
    return renumber(next);
  }
  function removeSlide(slides, i){
    if(i<0 || i>=slides.length) return slides.slice();
    const next = slides.slice(); next.splice(i, 1);
    if(!next.length) next.push(blankSlide(1));   // never leave the deck empty
    return renumber(next);
  }
  function duplicateSlide(slides, i){
    if(i<0 || i>=slides.length) return slides.slice();
    const next = slides.slice();
    next.splice(i+1, 0, cloneSlide(slides[i]));
    return renumber(next);
  }
  function moveSlide(slides, from, to){
    if(from<0 || from>=slides.length) return slides.slice();
    to = Math.max(0, Math.min(slides.length-1, to));
    if(from===to) return slides.slice();
    const next = slides.slice();
    const item = next.splice(from, 1)[0];
    next.splice(to, 0, item);
    return renumber(next);
  }

  /* ---- identity ---- */
  // Append -2, -3, … until the candidate id is free. Pure: existing ids in.
  function ensureUniqueId(candidate, existingIds){
    const base = candidate || "deck";
    const taken = existingIds || [];
    if(taken.indexOf(base) === -1) return base;
    let n = 2;
    while(taken.indexOf(base+"-"+n) !== -1) n++;
    return base+"-"+n;
  }

  /* ---- serialise: editing model -> clean raw deck for Store/download ---- */
  // Drops empty optional fields, emits `script` only (the author's text is the
  // single source — never `paragraphs`), keeps a finite positive
  // estimatedMinutes target, carries meta.id, and renumbers slides 1..n.
  function serialize(form){
    form = form || {};
    const fm = form.meta || {};
    const meta = { title: (fm.title||"").trim() || "Untitled deck" };
    if(fm.id) meta.id = fm.id;
    const slides = (form.slides||[]).map((s,i)=>{
      s = s || {};
      const out = { number: i+1 };
      const title    = (s.title||"").trim();
      const type     = (s.type||"").trim();
      const onScreen = (s.onScreen||"").trim();
      const script   = (s.script||"").trim();   // trims ends; internal newlines kept
      const est      = Number(s.estimatedMinutes);
      if(title)    out.title = title;
      if(type)     out.type = type;
      if(onScreen) out.onScreen = onScreen;
      if(script)   out.script = script;
      if(Number.isFinite(est) && est > 0) out.estimatedMinutes = est;
      if(s.hidden) out.hidden = true;   // Edit 1: emit only when true — keeps JSON clean
      return out;
    });
    return { meta, slides };
  }

  /* ---- live estimate (the honest readout): words + spoken ms ---- */
  // Counts real words (pauses excluded) and total ms (pauses + punctuation
  // scaling INCLUDED) by running the same Schema -> Engine path the player uses.
  function estimateNorm(slide, wpm){
    const cum = Engine.totalsMs(Engine.flatSeq(slide), wpm);
    return { words: slide.wordCount, ms: cum[cum.length-1] };
  }
  function estimateSlide(rawSlide, wpm){
    const deck = Schema.normalise({ slides:[ rawSlide || {} ] });
    return deck.slides.length ? estimateNorm(deck.slides[0], wpm) : { words:0, ms:0 };
  }
  function estimateDeck(rawDeck, wpm){
    const deck = Schema.normalise(rawDeck || { slides:[] });
    return deck.slides.reduce((a,s)=>{
      if(s.hidden) return a;          // Edit 1: hidden slides are excluded from the total
      const e = estimateNorm(s, wpm);
      return { words: a.words + e.words, ms: a.ms + e.ms };
    }, { words:0, ms:0 });
  }

  return {
    blankSlide, blankDeck, cloneSlide, renumber,
    addSlide, removeSlide, duplicateSlide, moveSlide,
    ensureUniqueId, serialize,
    estimateSlide, estimateDeck
  };
})();
