"use strict";
window.TP = window.TP || {};

/* ==========================================================================
   ViewModel  ->  viewmodel.js
   Pure render decisions: given engine/slide data, produce the strings, class
   names, and numbers the UI needs — but touch no DOM. The UI shell applies
   these (always via textContent, never innerHTML, so deck content stays inert).
   Extracting these makes the highest-risk display logic unit-testable.
   ========================================================================== */
TP.ViewModel = (function(){
  const E = TP.Engine;   // slide-structure helpers (nextVisible) — same dep as studio.js
  function fmtTime(sec){ sec=Math.max(0,Math.round(sec)); const m=Math.floor(sec/60); const s=sec%60; return m+":"+String(s).padStart(2,"0"); }
  function prettyType(t){ return (t||"").replace(/[-_]/g," "); }

  // Faint label for a pause beat's duration: 1000→"1s", 2500→"2.5s", 500→"0.5s".
  function pauseLabel(ms){ return (Math.round((ms/1000)*10)/10) + "s"; }

  // Class string for each token given the highlight index: index < word is
  // done, === word is current, > word is upcoming. kinds[i] is "word"|"pause".
  function tokenClasses(word, kinds){
    return kinds.map((kind, i)=>{
      const base = kind === "pause" ? "pause" : "w";
      return i < word ? base+" done" : (i === word ? base+" cur" : base);
    });
  }

  // Progress-bar width as a percentage string; "0%" when there is no length.
  function progressPct(word, total){
    return total ? (Math.min(word,total)/total*100)+"%" : "0%";
  }

  // "m:ss / m:ss" elapsed-over-total at the current pace; "" when no total.
  function clockText(cum, word, total){
    if(!total) return "";
    return fmtTime((cum[Math.min(word,total)]||0)/1000)+" / "+fmtTime((cum[total]||0)/1000);
  }

  // Meta-strip strings for one slide.
  function slideMeta(slide){
    return {
      num: "slide "+slide.number,
      type: prettyType(slide.type) || "—",
      est: slide.estimatedMinutes!=null ? "~"+slide.estimatedMinutes+" min" : "",
      words: slide.wordCount ? (slide.wordCount+" words") : "",
      hasOnScreen: !!slide.onScreen,
      onScreen: slide.onScreen ? (" "+slide.onScreen) : ""
    };
  }

  // Data for the next-slide hint; the UI turns it into spans.
  // Hidden slides are skipped: finds the next visible slide past `si`.
  function nextHint(deck, si){
    const nv = E.nextVisible(deck.slides, si, 1);
    if(nv !== -1){
      const n = deck.slides[nv];
      return { kind:"next", number:n.number, title:n.title, type: n.type ? prettyType(n.type) : "" };
    }
    return { kind:"last" };
  }

  // Scroll position that places a token at the reading anchor (a fraction of
  // the reader's visible height).
  function scrollTarget(offsetTop, offsetHeight, clientHeight, anchor){
    return offsetTop - clientHeight*anchor + offsetHeight/2;
  }

  return {fmtTime, prettyType, tokenClasses, progressPct, clockText, slideMeta, nextHint, scrollTarget, pauseLabel};
})();
