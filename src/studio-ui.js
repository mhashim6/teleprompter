"use strict";
window.TP = window.TP || {};

/* ==========================================================================
   StudioUI  ->  studio-ui.js
   The deck editor's imperative SHELL: a full-screen overlay for creating and
   editing decks. It holds an editing model, renders the slide cards, wires the
   inputs, and delegates ALL data work to the pure TP.Studio (build / reorder /
   serialise / estimate) and TP.Schema (validate). It never does timing math
   itself; the live duration readout is TP.Studio.estimateSlide, the same
   Schema -> Engine path the player uses, so what the author sees is the truth.

   Persistence and library/player refresh go through the existing seams:
   Store.saveDeck/getRaw and the thin TP.UI exports (toast/refreshLibrary/
   reloadActive/get-setWpm) — no duplicated behaviour. Deck strings reach the
   DOM only via .value / .textContent (form fields), never innerHTML.
   ========================================================================== */
TP.StudioUI = (function(){
  const Studio = TP.Studio, Store = TP.Store, Schema = TP.Schema,
        VM = TP.ViewModel, P = TP.Prompter, C = TP.Const;
  const UI = ()=>TP.UI;   // resolved lazily; ui.js defines it before this runs

  let model = null;       // editing model: { meta:{id,title}, slides:[{title,type,onScreen,script,estimatedMinutes}] }
  let openId = null;      // storage id being edited (null = brand-new deck)
  let wpm = 130;          // reference pace for the readout — the global slider value
  let built = false;
  const el = {};          // cached overlay elements
  let statsTimer = null;

  /* ---- editing model <-> raw deck ---- */
  // Turn a stored raw deck (any accepted shape) into the flat editing model.
  // `script` is the single editable body: prefer script, else join paragraphs,
  // else text. meta.id is pinned to the storage id so saving edits in place.
  function toModel(raw, id){
    const slidesRaw = Array.isArray(raw && raw.slides) ? raw.slides
                    : Array.isArray(raw) ? raw : [];
    const slides = slidesRaw.map(s=>{
      s = s || {};
      let script = "";
      if(typeof s.script === "string") script = s.script;
      else if(Array.isArray(s.paragraphs)) script = s.paragraphs.filter(p=>typeof p==="string").join("\n\n");
      else if(typeof s.text === "string") script = s.text;
      const est = (typeof s.estimatedMinutes==="number" && isFinite(s.estimatedMinutes)) ? s.estimatedMinutes : null;
      return {
        title:    s.title!=null ? String(s.title) : "",
        type:     s.type!=null ? String(s.type) : "",
        onScreen: s.onScreen!=null ? String(s.onScreen) : "",
        script:   script,
        estimatedMinutes: est
      };
    });
    if(!slides.length) slides.push(Studio.blankSlide(1));
    const meta = (raw && typeof raw==="object" && !Array.isArray(raw) && raw.meta) || {};
    return { meta:{ id:id, title: meta.title!=null ? String(meta.title) : "" }, slides:slides };
  }

  // Editing model -> clean raw deck, with a stable id assigned: an existing deck
  // keeps the id it was opened under (edit in place); a new deck gets a unique
  // slug of its title.
  function buildRaw(){
    const raw = Studio.serialize(model);
    if(openId){
      raw.meta.id = openId;
    } else {
      const existing = Store.listDecks().map(d=>d.id);
      raw.meta.id = Studio.ensureUniqueId(Schema.slug(raw.meta.title) || "deck", existing);
    }
    return raw;
  }

  /* ---- DOM construction (once) ---- */
  function btn(cls, label, aria){
    const b = document.createElement("button");
    b.className = cls; b.textContent = label;
    if(aria) b.setAttribute("aria-label", aria);
    return b;
  }
  function build(){
    if(built) return;
    const root = document.createElement("section");
    root.className = "studio"; root.id = "studio";
    root.setAttribute("aria-label", "deck studio");

    // header: title, pace, deck total, actions
    const head = document.createElement("div"); head.className = "studio-head";
    const left = document.createElement("div"); left.className = "studio-head-left";
    const title = document.createElement("input");
    title.className = "studio-title"; title.type = "text";
    title.setAttribute("aria-label","deck title"); title.placeholder = "deck title";
    title.oninput = ()=>{ model.meta.title = title.value; };
    left.appendChild(title);

    const right = document.createElement("div"); right.className = "studio-head-right";
    const pace = document.createElement("div"); pace.className = "studio-pace";
    const paceLabel = document.createElement("span"); paceLabel.className = "ctrl-label"; paceLabel.textContent = "pace";
    const paceIn = document.createElement("input");
    paceIn.type = "range"; paceIn.min = C.WPM_MIN; paceIn.max = C.WPM_MAX; paceIn.step = C.WPM_STEP;
    paceIn.setAttribute("aria-label","words per minute");
    paceIn.oninput = ()=> setRefWpm(+paceIn.value);
    const paceOut = document.createElement("span"); paceOut.className = "readout";
    pace.appendChild(paceLabel); pace.appendChild(paceIn); pace.appendChild(paceOut);

    const total = document.createElement("span"); total.className = "studio-total";

    const acts = document.createElement("div"); acts.className = "studio-acts";
    const save = btn("icon-btn small", "save");
    const saveClose = btn("play", "save & close");
    const download = btn("icon-btn small", "download");
    const close = btn("icon-btn small", "close");
    save.onclick = ()=> doSave(false);
    saveClose.onclick = ()=> doSave(true);
    download.onclick = doDownload;
    close.onclick = ()=> show(false);
    acts.appendChild(save); acts.appendChild(saveClose); acts.appendChild(download); acts.appendChild(close);

    right.appendChild(pace); right.appendChild(total); right.appendChild(acts);
    head.appendChild(left); head.appendChild(right);

    // body: authoring hint -> slide list -> add
    const body = document.createElement("div"); body.className = "studio-body";

    // A quiet pointer to the other authoring path: the tele-author skill, which
    // builds a deck from a PPT / PDF / notes in the Claude app. Text only (this is
    // a browser; the skill runs in the agent), with a link to the docs.
    const hint = document.createElement("div"); hint.className = "studio-hint";
    const hintMark = document.createElement("span"); hintMark.className = "studio-hint-mark"; hintMark.textContent = "§";
    const hintText = document.createElement("span");
    hintText.textContent = "starting from a slide deck? the tele-author skill turns a PowerPoint, PDF, or notes into a deck in the Claude app. ";
    const hintLink = document.createElement("a");
    hintLink.className = "studio-hint-link";
    hintLink.href = "https://github.com/mhashim6/teleprompter#authoring-a-deck";
    hintLink.target = "_blank"; hintLink.rel = "noopener noreferrer";
    hintLink.textContent = "how ↗";
    hint.appendChild(hintMark); hint.appendChild(hintText); hint.appendChild(hintLink);

    const list = document.createElement("div"); list.className = "studio-list"; list.id = "studioList";
    const addRow = document.createElement("div"); addRow.className = "studio-addrow";
    const add = btn("icon-btn", "+ add slide");
    add.onclick = ()=>{ const n = model.slides.length; model.slides = Studio.addSlide(model.slides, n); renderList('[data-i="'+n+'"] [data-f="title"]'); refreshTotal(); };
    addRow.appendChild(add);
    body.appendChild(hint); body.appendChild(list); body.appendChild(addRow);

    root.appendChild(head); root.appendChild(body);
    document.body.appendChild(root);

    // Keep player keyboard shortcuts (space=play, etc.) from firing while typing
    // in the studio: stop key events from bubbling to the document handler.
    root.addEventListener("keydown", e=>{ e.stopPropagation(); if(e.key==="Escape") show(false); });

    Object.assign(el, {root, title, paceIn, paceOut, total, list});
    built = true;
  }

  /* ---- rendering ---- */
  function render(){
    el.title.value = model.meta.title || "";
    el.paceIn.value = wpm; el.paceOut.textContent = wpm + " wpm";
    renderList();
    refreshTotal();
  }

  function renderList(focusSel){
    const slides = model.slides, n = slides.length;
    el.list.textContent = "";
    slides.forEach((s,i)=> el.list.appendChild(buildCard(s, i, n)));
    if(focusSel){ const t = el.list.querySelector(focusSel); if(t) t.focus(); }
  }

  function field(labelText, value, kind, onInput){
    const wrap = document.createElement("label"); wrap.className = "studio-field";
    const lab = document.createElement("span"); lab.className = "studio-field-label"; lab.textContent = labelText;
    const input = (kind==="number")
      ? Object.assign(document.createElement("input"), {type:"number", min:"0", step:"0.5"})
      : document.createElement("input");
    if(kind!=="number") input.type = "text";
    input.className = "studio-input";
    input.value = (value==null ? "" : value);
    input.oninput = ()=> onInput(input.value);
    wrap.appendChild(lab); wrap.appendChild(input);
    return {wrap, input};
  }

  function buildCard(slide, i, n){
    const card = document.createElement("div"); card.className = "studio-slide"; card.dataset.i = i;

    // head: number + reorder/duplicate/delete
    const head = document.createElement("div"); head.className = "studio-slide-head";
    const num = document.createElement("span"); num.className = "studio-slide-num"; num.textContent = "slide " + (i+1);
    const sacts = document.createElement("div"); sacts.className = "studio-slide-acts";
    const up = btn("icon-btn small", "↑", "move up");      up.dataset.act = "up";   up.disabled = (i===0);
    const down = btn("icon-btn small", "↓", "move down");  down.dataset.act = "down"; down.disabled = (i===n-1);
    const dup = btn("icon-btn small", "⧉", "duplicate");   dup.dataset.act = "dup";
    const del = btn("icon-btn small", "✕", "delete");      del.dataset.act = "del";
    up.onclick   = ()=>{ model.slides = Studio.moveSlide(model.slides, i, i-1); renderList('[data-i="'+(i-1)+'"] [data-act="up"]'); refreshTotal(); };
    down.onclick = ()=>{ model.slides = Studio.moveSlide(model.slides, i, i+1); renderList('[data-i="'+(i+1)+'"] [data-act="down"]'); refreshTotal(); };
    dup.onclick  = ()=>{ model.slides = Studio.duplicateSlide(model.slides, i); renderList('[data-i="'+(i+1)+'"] [data-f="title"]'); refreshTotal(); };
    del.onclick  = ()=>{ model.slides = Studio.removeSlide(model.slides, i); renderList('[data-i="'+Math.min(i, model.slides.length-1)+'"] [data-act="del"]'); refreshTotal(); };
    sacts.appendChild(up); sacts.appendChild(down); sacts.appendChild(dup); sacts.appendChild(del);
    head.appendChild(num); head.appendChild(sacts);

    // text fields
    const grid = document.createElement("div"); grid.className = "studio-grid";
    const fTitle = field("title", slide.title, "text", v=>{ slide.title = v; });
    const fType  = field("type",  slide.type,  "text", v=>{ slide.type = v; });
    const fScreen= field("on screen", slide.onScreen, "text", v=>{ slide.onScreen = v; });
    const fEst   = field("target min", slide.estimatedMinutes, "number", v=>{
      const x = parseFloat(v); slide.estimatedMinutes = (isFinite(x) && x>0) ? x : null; scheduleStats(i);
    });
    fTitle.input.dataset.f = "title"; fType.input.dataset.f = "type";
    fScreen.input.dataset.f = "onScreen"; fEst.input.dataset.f = "estimatedMinutes";
    grid.appendChild(fTitle.wrap); grid.appendChild(fType.wrap);
    grid.appendChild(fScreen.wrap); grid.appendChild(fEst.wrap);

    // script
    const ta = document.createElement("textarea");
    ta.className = "studio-script"; ta.dataset.f = "script"; ta.rows = 5;
    ta.placeholder = "script… use [[pause]] or [[pause:1.5]] for beats";
    ta.value = slide.script || "";
    ta.oninput = ()=>{ slide.script = ta.value; scheduleStats(i); };

    // foot: insert-pause + live readout
    const foot = document.createElement("div"); foot.className = "studio-slide-foot";
    const pauseBtn = btn("icon-btn small", "insert pause");
    pauseBtn.onclick = ()=> insertPause(ta, slide, i);
    const readout = document.createElement("span"); readout.className = "studio-readout";
    const target = document.createElement("span"); target.className = "studio-target";
    foot.appendChild(pauseBtn); foot.appendChild(readout); foot.appendChild(target);

    card.appendChild(head); card.appendChild(grid); card.appendChild(ta); card.appendChild(foot);
    paintCardStats(card, slide);
    return card;
  }

  /* ---- live estimates ---- */
  function paintCardStats(card, slide){
    const e = Studio.estimateSlide(slide, wpm);
    const readout = card.querySelector(".studio-readout");
    const target = card.querySelector(".studio-target");
    readout.textContent = e.words + (e.words===1?" word · ~":" words · ~") + VM.fmtTime(e.ms/1000);
    if(slide.estimatedMinutes){
      const over = (e.ms/1000) > (slide.estimatedMinutes*60);
      target.textContent = " · target " + VM.fmtTime(slide.estimatedMinutes*60) + (over ? " (over)" : " (ok)");
      target.className = "studio-target " + (over ? "over" : "under");
    } else {
      target.textContent = ""; target.className = "studio-target";
    }
  }
  function updateCardStats(i){
    const card = el.list.querySelector('[data-i="'+i+'"]');
    if(card) paintCardStats(card, model.slides[i]);
  }
  function refreshTotal(){
    const e = Studio.estimateDeck(model, wpm);
    el.total.textContent = e.words + " words · ~" + VM.fmtTime(e.ms/1000) + " @ " + wpm + " wpm";
  }
  function refreshAllStats(){
    model.slides.forEach((s,i)=> updateCardStats(i));
    refreshTotal();
  }
  // light debounce so big scripts don't recompute the deck total on every key
  function scheduleStats(i){
    clearTimeout(statsTimer);
    statsTimer = setTimeout(()=>{ updateCardStats(i); refreshTotal(); }, 120);
  }

  // pace is the GLOBAL setting (the player's slider); changing it here changes
  // it everywhere, and every readout recomputes — so "minutes vary with wpm".
  function setRefWpm(v){
    v = Math.max(C.WPM_MIN, Math.min(C.WPM_MAX, v));
    if(UI() && UI().setWpm) UI().setWpm(v);
    wpm = v;
    el.paceIn.value = v; el.paceOut.textContent = v + " wpm";
    refreshAllStats();
  }

  function insertPause(ta, slide, i){
    const v = ta.value, a = ta.selectionStart, b = ta.selectionEnd, ins = "[[pause]] ";
    ta.value = v.slice(0,a) + ins + v.slice(b);
    const caret = a + ins.length; ta.setSelectionRange(caret, caret);
    slide.script = ta.value; ta.focus();
    scheduleStats(i);
  }

  /* ---- save / download ---- */
  function doSave(close){
    const wasNew = !openId;
    const raw = buildRaw();
    const deck = Schema.normalise(raw, raw.meta.title);
    if(!deck.slides.length){ toast("add at least one slide"); return; }
    Store.saveDeck({id:deck.id, name:raw.meta.title, title:deck.title, slideRange:deck.slideRange}, raw);
    openId = deck.id; model.meta.id = deck.id;     // a new deck becomes edit-in-place after first save
    if(UI()){
      UI().refreshLibrary();
      // Creating your first deck (none active = welcome session) loads it so the
      // player exits the landing session; otherwise refresh the active deck only.
      if(wasNew && UI().getActive && !UI().getActive() && UI().loadById) UI().loadById(deck.id);
      else if(Store.getActive()===deck.id) UI().reloadActive();
    }
    toast(close ? "saved — "+deck.title : "saved");
    if(close) show(false);
  }
  function doDownload(){
    const raw = buildRaw();
    const blob = new Blob([JSON.stringify(raw, null, 2)], {type:"application/json"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = (Schema.slug(raw.meta.title) || "deck") + ".json";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=> URL.revokeObjectURL(url), 0);
  }
  function toast(msg){ if(UI() && UI().toast) UI().toast(msg); }

  /* ---- open / close ---- */
  function show(on){
    el.root.classList.toggle("open", on);
    document.body.classList.toggle("studio-open", on);
    if(on){ setTimeout(()=>{ try{ el.title.focus(); }catch(e){} }, 0); }
  }
  function open(id){
    build();
    if(P.position && P.position().playing) P.pause();   // don't edit a running deck
    openId = id || null;
    if(openId){
      const raw = Store.getRaw(openId);
      if(!raw){ toast("that deck is no longer stored"); return; }
      model = toModel(raw, openId);
    } else {
      model = Studio.blankDeck();
    }
    wpm = (UI() && UI().getWpm) ? UI().getWpm() : Store.getPrefs().wpm;
    render();
    show(true);
  }

  return { open };
})();
