"use strict";
window.TP = window.TP || {};

/* ==========================================================================
   Prompter  ->  prompter.js
   The playback engine's stateful SHELL. Holds deck + position + play state and
   advances the highlight word-by-word at a words-per-minute pace, with small
   natural pauses after punctuation. All timing math is delegated to the pure
   TP.Engine; this file owns only the state, the timer, and the callback fan-out.

   Talks to the world only through callbacks: onTick (word moved), onSlide
   (slide changed), onState (play/pause), onComplete (slide finished). A fifth,
   onError, receives any exception thrown by the others so a faulty render can
   never break the timer chain — the prompter keeps running.
   ========================================================================== */
TP.Prompter = (function(){
  const E = TP.Engine;
  const S = {
    deck:null, si:0, word:0, playing:false, timer:null, wpm:130,
    cb:{onTick(){}, onSlide(){}, onState(){}, onComplete(){}, onError(){}}
  };

  // Timer seam: defaults to the real timers; tests inject a deterministic one
  // via setScheduler(). Behaviour is identical in the browser.
  const sched = { set:(fn,ms)=>setTimeout(fn,ms), clear:id=>clearTimeout(id) };

  // Fire a callback defensively: a throwing listener is routed to onError and
  // swallowed, so the chained setTimeout in step() always continues.
  function fire(name, arg){
    try{ S.cb[name](arg); }
    catch(e){ try{ S.cb.onError(e); }catch(_){} }
  }

  const slide = ()=> S.deck ? S.deck.slides[S.si] : null;
  const total = ()=>{ const s=slide(); return s ? s.total : 0; };
  function clearTimer(){ if(S.timer){ sched.clear(S.timer); S.timer=null; } }
  function step(){
    if(!S.playing) return;
    if(S.word >= total()){ S.playing=false; fire("onState"); fire("onComplete"); return; }
    const dur = E.itemDuration(E.flatSeq(slide())[S.word], S.wpm);
    S.timer = sched.set(()=>{ S.word++; fire("onTick"); step(); }, dur);
  }
  function totalsMs(){ return E.totalsMs(E.flatSeq(slide()), S.wpm); }

  return {
    position(){ return {si:S.si, word:S.word, playing:S.playing, wpm:S.wpm}; },
    deck(){ return S.deck; },
    slide, total, totalsMs,
    configure({wpm}){ if(wpm){ S.wpm=wpm; if(S.playing){ clearTimer(); step(); } } },
    bind(cb){ Object.assign(S.cb, cb); },
    setScheduler(s){ if(s&&s.set) sched.set=s.set; if(s&&s.clear) sched.clear=s.clear; },
    load(deck, pos){
      this.pause(); S.deck=deck;
      const clamped = E.clampPos(pos&&pos.slideIndex||0, 0, deck.slides.length-1);
      // snap to nearest visible slide so a saved position on a hidden slide still works
      const snapped = E.firstVisible(deck.slides, clamped);
      S.si = snapped !== -1 ? snapped : clamped; // fall back to clamped if all hidden (degenerate)
      S.word = E.clampPos(pos&&pos.word||0, 0, total());
      fire("onSlide"); fire("onTick");
    },
    play(){ if(!S.deck) return; if(S.word>=total()) S.word=0; S.playing=true; fire("onState"); fire("onTick"); step(); },
    pause(){ S.playing=false; clearTimer(); fire("onState"); },
    toggle(){ S.playing ? this.pause() : this.play(); },
    seek(i){ S.word = E.clampPos(i,0,total()); if(S.playing){ clearTimer(); fire("onTick"); step(); } else fire("onTick"); },
    restartSlide(){ this.pause(); this.seek(0); },
    gotoSlide(i){
      if(!S.deck) return;
      const wasPlaying = S.playing;   // Edit 2: preserve play state across navigation
      this.pause();
      const clamped = E.clampPos(i,0,S.deck.slides.length-1);
      // snap to nearest visible slide; fall back to clamped if the deck is all hidden
      const snapped = E.firstVisible(S.deck.slides, clamped);
      S.si = snapped !== -1 ? snapped : clamped;
      S.word=0;
      fire("onSlide"); fire("onTick");
      if(wasPlaying) this.play();     // Edit 2: resume if we were playing before the jump
    },
    next(){
      if(!S.deck) return;
      const nv = E.nextVisible(S.deck.slides, S.si, 1);
      if(nv !== -1) this.gotoSlide(nv);
    },
    prev(){
      if(!S.deck) return;
      const nv = E.nextVisible(S.deck.slides, S.si, -1);
      if(nv !== -1) this.gotoSlide(nv);
    }
  };
})();
