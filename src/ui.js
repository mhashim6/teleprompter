"use strict";
window.TP = window.TP || {};

/* ==========================================================================
   UI  ->  ui.js
   The imperative DOM shell. Renders the meta strip, the reading column (one
   span per token), the next-slide hint, the control bar and the library
   drawer; wires inputs and keyboard; reacts to Prompter callbacks. All display
   *decisions* live in the pure TP.ViewModel; all tunable numbers in TP.Const.
   Deck strings are written with textContent only — never innerHTML.
   ========================================================================== */
TP.UI = (function(){
  const P = TP.Prompter, Store = TP.Store, Schema = TP.Schema,
        E = TP.Engine, VM = TP.ViewModel, C = TP.Const;
  const $ = id => document.getElementById(id);
  const el = {};
  ["deckName","themeBtn","libBtn","meta","mNum","mType","mEst","mWords","mScreen","mScreenTxt","progress",
   "reader","readerWrap","readerInner","empty","emptyDrop","emptyPick","hint","next","cue","timeleft","controls",
   "prevBtn","playBtn","nextBtn","restartBtn","wpm","wpmOut","fontDown","fontUp","leadDown","leadUp","usePace",
   "mirrorBtn","flipBtn",
   "scrim","drawer","drawerClose","drop","pick","newDeckBtn","deckList","guideBtn","scrollBtn","advanceBtn",
   "file","toast"].forEach(id=>el[id]=$(id));

  let prefs = Store.getPrefs();
  let activeId = null;
  let welcomeMode = false;   // the ephemeral landing deck is loaded (never persisted)
  let coachMarks = [];       // active coach-mark entries {node,target,off} (welcome mode)
  let seqEls = [];           // span elements (words + pauses) for the current slide
  let lastSave = 0;
  let storageWarned = false; // warn once if a write fails (e.g. quota)
  const reduceMotion = matchMedia("(prefers-reduced-motion:reduce)").matches;
  const PRESENT_MODE = false;  // presentation/camera-strip mode disabled for now (code + CSS kept)

  /* ---- helpers ---- */
  function readAnchor(){   // reading-head position as a fraction of reader height (CSS-driven)
    const v = getComputedStyle(document.documentElement).getPropertyValue("--read-anchor");
    const n = parseFloat(v); return (isFinite(n) && n>0) ? n/100 : C.DEFAULT_READ_ANCHOR;
  }
  function toast(msg){ el.toast.textContent=msg; el.toast.classList.add("show"); clearTimeout(toast._t); toast._t=setTimeout(()=>el.toast.classList.remove("show"), C.TOAST_MS); }
  function setPressed(node,on,onText,offText){ node.setAttribute("aria-pressed",on?"true":"false"); if(onText!=null) node.textContent = on?onText:offText; }

  /* ---- prefs application ---- */
  function applyPrefs(){
    document.documentElement.className = "theme-"+prefs.theme;
    el.themeBtn.innerHTML = prefs.theme==="night" ? "&#9790;" : "&#9728;"; // moon / sun
    document.documentElement.style.setProperty("--reader-size", (C.READER_SIZE_BASE*prefs.fontScale).toFixed(1)+"px");
    document.documentElement.style.setProperty("--reader-leading", (+prefs.lineHeight).toFixed(2));
    document.body.classList.toggle("guide", !!prefs.guide);
    document.body.classList.toggle("mirror", !!prefs.mirror);
    document.body.classList.toggle("flip", !!prefs.flip);
    el.wpm.value = prefs.wpm; el.wpmOut.textContent = prefs.wpm;
    setPressed(el.mirrorBtn, prefs.mirror, "on", "off");
    setPressed(el.flipBtn, prefs.flip, "on", "off");
    setPressed(el.guideBtn, prefs.guide, "on", "off");
    setPressed(el.scrollBtn, prefs.autoScroll, "on", "off");
    setPressed(el.advanceBtn, prefs.autoAdvance, "on", "off");
  }
  function savePrefs(patch){ prefs=Object.assign(prefs,patch); Store.setPrefs(patch); }

  /* ---- deck loading ---- */
  function showEmpty(on){
    el.empty.classList.toggle("hidden", !on);
    ["meta","readerWrap","hint","controls"].forEach(k=>el[k].classList.toggle("hidden", on));
  }
  function loadById(id){
    clearWelcome();                     // a real deck supersedes the landing session
    const raw = Store.getRaw(id);
    if(!raw){ toast("that deck is no longer stored"); renderLibrary(); return; }
    // Re-normalise with the persisted filename so id/title match the original import.
    const entry = Store.listDecks().find(d=>d.id===id);
    const deck = Schema.normalise(raw, entry && entry.name);
    deck.id = id;                       // stored id always wins (covers old hash-id decks too)
    activeId = id; Store.setActive(activeId);
    el.deckName.textContent = deck.title + (deck.slideRange? "  ·  "+deck.slideRange : "");
    P.load(deck, Store.getPos(activeId));
    showEmpty(false); renderLibrary();
  }
  function ingest(rawText, name){
    let raw;
    try{ raw = JSON.parse(rawText); }
    catch(e){ toast("could not read that file as JSON"); return; }
    const fileName = name.replace(/\.json$/i,"");
    const deck = Schema.normalise(raw, fileName);
    if(!deck.slides.length){ toast("no slides found in that file"); return; }
    Store.saveDeck({id:deck.id, name:fileName, title:deck.title, slideRange:deck.slideRange}, raw);
    loadById(deck.id);
    closeDrawer();
    toast("loaded "+deck.title);
  }
  function readFile(file){
    if(!file) return;
    const r = new FileReader();
    r.onload = ()=> ingest(String(r.result), file.name);
    r.onerror = ()=> toast("could not open that file");
    r.readAsText(file);
  }

  /* ---- welcome mode (the self-running landing session) ----
     An ephemeral deck built from TP.Welcome.RAW and played through the real
     pipeline. It is NEVER persisted: activeId stays null, so saveNow() no-ops
     and it never reaches Store.saveDeck / the library. Presentation mode is
     suppressed (see enterPresenting) so the controls stay visible for the
     coach-marks. A real deck (loadById / a new deck in the studio) replaces it. */
  function loadWelcome(){
    try{
      if(!TP.Welcome) { showEmpty(true); return; }
      const deck = Schema.normalise(TP.Welcome.RAW, "welcome");
      if(!deck.slides.length){ showEmpty(true); return; }
      activeId = null;                     // keep it un-persisted
      welcomeMode = true;
      document.body.classList.add("welcome");
      el.deckName.textContent = deck.title;
      P.load(deck, null);
      showEmpty(false);
      renderLibrary();
      buildCoachMarks();
      P.play();                            // auto-start; the highlight is the demo
    } catch(e){
      welcomeMode = false; document.body.classList.remove("welcome");
      showEmpty(true); el.deckName.textContent = "no deck loaded";
      if(typeof console!=="undefined") console.error("welcome session failed:", e);
    }
  }
  function clearWelcome(){
    if(!welcomeMode) return;
    welcomeMode = false;
    document.body.classList.remove("welcome");
    removeCoachMarks();
  }
  // Three coach-marks, each anchored inside its control's .group via CSS so they
  // track the buttons on resize without any getBoundingClientRect math. The align
  // hint (start/center/end) keeps the edge ones (play, menu) from spilling off
  // screen. Each marker dismisses on its OWN — only when its control is clicked,
  // independently of the others; the intro finishing does not retire them.
  function buildCoachMarks(){
    removeCoachMarks();
    const specs = [
      [el.playBtn, "press space to play / pause", "start"],
      [el.wpm,     "drag to set your pace",       "center"],
      [el.libBtn,  "menu — load or create decks", "end"]
    ];
    specs.forEach(([target, text, align])=>{
      const group = target && target.closest && target.closest(".group");
      if(!group) return;
      const tip = spanWith("coach coach-"+align, text);
      group.appendChild(tip);
      const entry = { node:tip, target:target, off:null };
      entry.off = ()=> hideCoach(entry);
      target.addEventListener("pointerdown", entry.off);
      coachMarks.push(entry);
    });
  }
  function hideCoach(entry){               // fade out one marker, then drop it
    const i = coachMarks.indexOf(entry); if(i===-1) return;
    coachMarks.splice(i,1);
    entry.target.removeEventListener("pointerdown", entry.off);
    entry.node.classList.add("is-hiding");
    const node = entry.node;
    setTimeout(()=> node.remove(), reduceMotion ? 0 : 240);
  }
  function removeCoachMarks(){             // immediate teardown of any remaining
    coachMarks.forEach(e=>{ e.target.removeEventListener("pointerdown", e.off); e.node.remove(); });
    coachMarks = [];
  }

  /* ---- rendering ---- */
  // small DOM builders so no deck-derived string ever reaches innerHTML
  function spanWith(cls, text){ const s=document.createElement("span"); s.className=cls; s.textContent=text; return s; }
  function labelSpan(text){ return spanWith("label", text); }

  function renderSlide(){
    const s = P.slide(); if(!s) return;
    const m = VM.slideMeta(s);
    el.mNum.textContent = m.num;
    el.mType.textContent = m.type;
    el.mEst.textContent = m.est;
    el.mWords.textContent = m.words;
    if(m.hasOnScreen){ el.mScreen.classList.remove("hidden"); el.mScreenTxt.textContent = m.onScreen; }
    else el.mScreen.classList.add("hidden");

    // build tokens (textContent only — no HTML injection from deck content)
    const inner = el.readerInner;
    inner.textContent = "";
    seqEls = [];
    let gi = 0;
    s.paragraphs.forEach(p=>{
      const para = document.createElement("p");
      p.tokens.forEach(tok=>{
        const span = document.createElement("span");
        span.dataset.i = gi++;
        if(tok.kind === "pause"){
          span.className = "pause"; span.dataset.kind = "pause";
          span.setAttribute("aria-hidden","true");
          span.title = (tok.ms/1000)+"s pause";
          span.textContent = "···";       // ··· hold marker
        } else {
          span.className = "w"; span.dataset.kind = "word"; span.textContent = tok.text;
        }
        para.appendChild(span);
        para.appendChild(document.createTextNode(" "));
        seqEls.push(span);
      });
      inner.appendChild(para);
    });
    el.readerInner.scrollTop = 0;

    renderNextHint();
    el.cue.classList.add("hidden");
    paint();
  }

  // next-slide hint (DOM only — no deck-derived string reaches innerHTML)
  function renderNextHint(){
    const hint = VM.nextHint(P.deck(), P.position().si);
    el.next.textContent = "";
    if(hint.kind === "next"){
      el.next.appendChild(labelSpan("next"));
      el.next.appendChild(document.createTextNode(" "));
      el.next.appendChild(spanWith("arrow", "→"));
      el.next.appendChild(document.createTextNode(" slide "+hint.number+" · "));
      const b = document.createElement("b"); b.textContent = hint.title; el.next.appendChild(b);
      if(hint.type){ el.next.appendChild(document.createTextNode(" ")); el.next.appendChild(labelSpan(hint.type)); }
    } else {
      el.next.appendChild(labelSpan("last slide"));
    }
  }

  function paint(){                    // update token states + progress + scroll + clock
    const pos = P.position(), w = pos.word, n = P.total();
    const classes = VM.tokenClasses(w, seqEls.map(s=>s.dataset.kind));
    for(let i=0;i<seqEls.length;i++){ if(seqEls[i].className!==classes[i]) seqEls[i].className=classes[i]; }
    el.progress.style.width = VM.progressPct(w, n);
    el.timeleft.textContent = VM.clockText(P.totalsMs(), w, n);

    // auto-scroll to keep the current token at the reading anchor (top-ish, near the lens)
    if(prefs.autoScroll && seqEls.length){
      const span = seqEls[Math.min(w, seqEls.length-1)];
      const target = VM.scrollTarget(span.offsetTop, span.offsetHeight, el.readerInner.clientHeight, readAnchor());
      if(reduceMotion) el.readerInner.scrollTop = target;
      else el.readerInner.scrollTo({top:target, behavior:"smooth"});
    }
    throttledSave();
  }

  function throttledSave(){
    const now = Date.now();
    if(now - lastSave < C.SAVE_THROTTLE_MS) return;
    lastSave = now;
    saveNow();
  }
  function saveNow(){ if(activeId){ const pos=P.position(); Store.setPos(activeId, {slideIndex:pos.si, word:pos.word}); } }

  /* ---- library ---- */
  function renderLibrary(){
    const decks = Store.listDecks();
    el.deckList.innerHTML = "";
    if(!decks.length){
      const empty = document.createElement("div");
      empty.className="deck-sub"; empty.style.padding="4px 16px 12px";
      empty.textContent="no decks yet — add one above.";
      el.deckList.appendChild(empty); return;
    }
    decks.forEach(d=>{
      const pos = Store.getPos(d.id);
      const row = document.createElement("div");
      row.className = "deck"+(d.id===activeId?" active":"");

      const main = document.createElement("button");
      main.className="deck-main";
      const dTitle = document.createElement("div"); dTitle.className="deck-title"; dTitle.textContent = d.title;
      const dSub = document.createElement("div"); dSub.className="deck-sub";
      dSub.textContent = (d.slideRange? ("slides "+d.slideRange+" · ") : "") + "at slide "+((pos.slideIndex||0)+1);
      main.appendChild(dTitle); main.appendChild(dSub);
      main.onclick = ()=>{ if(d.id!==activeId){ saveNow(); loadById(d.id); } closeDrawer(); };

      const acts = document.createElement("div"); acts.className="deck-acts";
      const edit = document.createElement("button");
      edit.className="icon-btn small"; edit.setAttribute("aria-label","edit deck"); edit.innerHTML="&#9998;"; // pencil
      edit.onclick = (e)=>{ e.stopPropagation(); closeDrawer(); if(TP.StudioUI) TP.StudioUI.open(d.id); };
      const reset = document.createElement("button");
      reset.className="icon-btn small"; reset.setAttribute("aria-label","reset position"); reset.innerHTML="&#8635;";
      reset.onclick = (e)=>{ e.stopPropagation(); Store.resetPos(d.id); if(d.id===activeId) P.gotoSlide(0); renderLibrary(); toast("position reset"); };
      const remove = document.createElement("button");
      remove.className="icon-btn small"; remove.setAttribute("aria-label","remove deck"); remove.innerHTML="&#10005;";
      remove.onclick = (e)=>{ e.stopPropagation(); Store.removeDeck(d.id);
        if(d.id===activeId){ activeId=null; const rest=Store.listDecks(); rest.length? loadById(rest[0].id):loadWelcome(); }
        renderLibrary(); };
      acts.appendChild(edit); acts.appendChild(reset); acts.appendChild(remove);

      row.appendChild(main); row.appendChild(acts);
      el.deckList.appendChild(row);
    });
  }
  function openDrawer(){ renderLibrary(); el.drawer.classList.add("open"); el.scrim.classList.add("open"); }
  function closeDrawer(){ el.drawer.classList.remove("open"); el.scrim.classList.remove("open"); }

  /* ---- presentation mode (camera-strip layout while playing) ---- */
  function enterPresenting(){
    if(!PRESENT_MODE) return;            // disabled for now; keep full chrome always
    if(document.body.classList.contains("presenting")) return;
    document.body.classList.add("presenting");
    closeDrawer();
    paint();              // re-run auto-scroll math with the tightened anchor
  }
  function exitPresenting(){
    if(!document.body.classList.contains("presenting")) return;
    document.body.classList.remove("presenting");
    paint();
  }

  /* ---- control actions (shared by buttons and keyboard) ---- */
  // Pace: clamp, reflect on the slider, persist, reconfigure the engine, repaint.
  function setWpm(v){
    v = Math.max(C.WPM_MIN, Math.min(C.WPM_MAX, v));
    el.wpm.value = v; el.wpmOut.textContent = v;
    savePrefs({wpm:v}); P.configure({wpm:v}); paint();
  }
  // Stepper specs drive the font-size and line-spacing +/- pairs (was 4 handlers).
  const STEPPERS = {
    font: {pref:"fontScale",  min:C.FONT_MIN, max:C.FONT_MAX, step:C.FONT_STEP},
    lead: {pref:"lineHeight", min:C.LEAD_MIN, max:C.LEAD_MAX, step:C.LEAD_STEP}
  };
  function step(spec, dir){
    const next = +(prefs[spec.pref] + dir*spec.step).toFixed(2);
    savePrefs({[spec.pref]: Math.max(spec.min, Math.min(spec.max, next))});
    applyPrefs(); paint();
  }
  // Boolean drawer toggles (was 5 near-identical handlers). Theme is a string
  // flip, handled explicitly rather than forced into the table.
  const TOGGLES = [
    {btn:"mirrorBtn", pref:"mirror"},
    {btn:"flipBtn",   pref:"flip"},
    {btn:"guideBtn",  pref:"guide"},
    {btn:"scrollBtn", pref:"autoScroll"},
    {btn:"advanceBtn",pref:"autoAdvance"}
  ];
  function togglePref(pref){ savePrefs({[pref]: !prefs[pref]}); applyPrefs(); }
  function toggleTheme(){ savePrefs({theme: prefs.theme==="night"?"day":"night"}); applyPrefs(); }
  function borrowPace(){
    const s = P.slide(); if(!s) return toast("this slide has no pace to borrow");
    const pace = E.paceFromSlide(s.wordCount, s.estimatedMinutes);
    if(pace==null) return toast("this slide has no pace to borrow");
    setWpm(pace); toast("pace set to "+pace+" wpm");
  }
  function toggleDrawer(){ el.drawer.classList.contains("open") ? closeDrawer() : openDrawer(); }
  function onEscape(){
    if(P.position().playing) P.pause();      // pause exits presentation mode (via onState)
    else if(document.body.classList.contains("presenting")) exitPresenting();
    closeDrawer();
  }

  // One name -> action map, used by both the control bar and the keymap so a
  // key never re-invokes a button's handler (which was fragile).
  const ACT = {
    toggle:   ()=>P.toggle(),
    next:     ()=>P.next(),
    prev:     ()=>P.prev(),
    restart:  ()=>P.restartSlide(),
    nudgeFwd: ()=>P.seek(P.position().word+1),
    nudgeBack:()=>P.seek(P.position().word-1),
    wpmUp:    ()=>setWpm(+el.wpm.value + C.WPM_STEP),
    wpmDown:  ()=>setWpm(+el.wpm.value - C.WPM_STEP),
    fontUp:   ()=>step(STEPPERS.font, +1),
    fontDown: ()=>step(STEPPERS.font, -1),
    mirror:   ()=>togglePref("mirror"),
    flip:     ()=>togglePref("flip"),
    theme:    toggleTheme,
    drawer:   toggleDrawer,
    escape:   onEscape
  };

  /* ---- Prompter callbacks ---- */
  P.bind({
    onTick(){ paint(); },
    onSlide(){ renderSlide(); saveNow(); },
    onState(){
      const playing = P.position().playing;
      setPressed(el.playBtn, playing, "pause", "play");
      if(playing) enterPresenting(); else exitPresenting();
    },
    onComplete(){
      saveNow();
      const last = P.position().si >= P.deck().slides.length-1;
      el.cue.textContent = last ? "end of deck" : "end of slide § advance when ready";
      el.cue.classList.remove("hidden");
      if(prefs.autoAdvance && !last) setTimeout(()=>P.next(), C.AUTOADVANCE_MS);
    },
    // A throwing render callback can't break playback; just log it.
    onError(e){ if(typeof console!=="undefined") console.error("teleprompter render error:", e); }
  });

  /* ---- events ---- */
  function wire(){
    el.playBtn.onclick   = ACT.toggle;
    el.prevBtn.onclick   = ACT.prev;
    el.nextBtn.onclick   = ACT.next;
    el.restartBtn.onclick= ACT.restart;

    el.wpm.oninput   = ()=>setWpm(+el.wpm.value);
    el.usePace.onclick = borrowPace;
    el.fontUp.onclick   = ACT.fontUp;
    el.fontDown.onclick = ACT.fontDown;
    el.leadUp.onclick   = ()=>step(STEPPERS.lead, +1);
    el.leadDown.onclick = ()=>step(STEPPERS.lead, -1);

    el.themeBtn.onclick  = toggleTheme;
    TOGGLES.forEach(t=>{ el[t.btn].onclick = ()=>togglePref(t.pref); });

    el.libBtn.onclick    = openDrawer;
    el.drawerClose.onclick = closeDrawer;
    el.scrim.onclick     = closeDrawer;

    // open the deck studio on a fresh blank deck
    if(el.newDeckBtn) el.newDeckBtn.onclick = ()=>{ closeDrawer(); if(TP.StudioUI) TP.StudioUI.open(null); };

    // seek by clicking a word
    el.reader.addEventListener("click", e=>{
      const t = e.target.closest(".w,.pause"); if(t) P.seek(+t.dataset.i);
    });

    // file pickers + drag/drop
    el.pick.onclick = el.emptyPick.onclick = ()=>el.file.click();
    el.file.onchange = ()=>{ readFile(el.file.files[0]); el.file.value=""; };
    [el.drop, el.emptyDrop].forEach(zone=>{
      zone.addEventListener("dragover", e=>{ e.preventDefault(); zone.classList.add("drag"); });
      zone.addEventListener("dragleave", ()=>zone.classList.remove("drag"));
      zone.addEventListener("drop", e=>{ e.preventDefault(); zone.classList.remove("drag");
        const f=e.dataTransfer.files[0]; if(f) readFile(f); });
    });
    window.addEventListener("dragover", e=>e.preventDefault());
    window.addEventListener("drop", e=>e.preventDefault());

    // keyboard — keys call the SAME action functions the buttons do
    const KEYMAP = {
      "ArrowRight":ACT.next, "ArrowLeft":ACT.prev,
      ".":ACT.nudgeFwd, ">":ACT.nudgeFwd, ",":ACT.nudgeBack, "<":ACT.nudgeBack,
      "]":ACT.wpmUp, "[":ACT.wpmDown,
      "+":ACT.fontUp, "=":ACT.fontUp, "-":ACT.fontDown, "_":ACT.fontDown,
      "r":ACT.restart, "R":ACT.restart, "m":ACT.mirror, "M":ACT.mirror,
      "f":ACT.flip, "F":ACT.flip, "t":ACT.theme, "T":ACT.theme,
      "l":ACT.drawer, "L":ACT.drawer, "Escape":ACT.escape
    };
    document.addEventListener("keydown", e=>{
      // space toggles play/pause from anywhere; never let a focused button swallow it
      if(e.key===" " || e.code==="Space"){
        e.preventDefault();
        const a=document.activeElement; if(a && a.tagName==="BUTTON") a.blur();
        P.toggle(); return;
      }
      if(e.target.matches("input,textarea")) return;
      const fn = KEYMAP[e.key]; if(fn) fn();
    });

    // persist position on the way out / when hidden
    window.addEventListener("beforeunload", saveNow);
    document.addEventListener("visibilitychange", ()=>{ if(document.hidden){ P.pause(); saveNow(); } });

    // keep keyboard working in embedded/iframe contexts: focus the app when a
    // reading area is clicked (controls keep their own focus so the slider still drags)
    const appEl = document.getElementById("app");
    [el.reader, el.meta, el.hint, el.empty].forEach(z=> z && z.addEventListener("pointerdown", ()=>{ try{ appEl.focus({preventScroll:true}); }catch(e){} }));
  }

  function init(){
    // Surface a storage write failure (e.g. full quota) once, instead of silently.
    Store.configure({ onError(op){ if(op==="set" && !storageWarned){ storageWarned=true; toast("couldn't save — storage may be full"); } } });
    applyPrefs();
    P.configure({wpm:prefs.wpm});
    wire();
    renderLibrary();
    const decks = Store.listDecks();
    const active = Store.getActive();
    if(active && decks.some(d=>d.id===active)) loadById(active);
    else if(decks.length) loadById(decks[0].id);
    else loadWelcome();
    if(!Store.persistent) toast("storage unavailable here — decks won't persist");
    try{ document.getElementById("app").focus({preventScroll:true}); }catch(e){}
  }

  // Thin exports so the deck studio (studio-ui.js) reuses these behaviours
  // instead of duplicating them: a toast, a library refresh, and a reload of
  // the active deck (used after an edit so the open deck reflects the changes).
  function reloadActive(){ if(activeId) loadById(activeId); }
  return { init, toast, refreshLibrary: renderLibrary, reloadActive,
           loadById, getActive: ()=>activeId,
           setWpm, getWpm: ()=>prefs.wpm };
})();
