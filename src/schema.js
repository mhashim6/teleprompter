"use strict";
window.TP = window.TP || {};

/* ==========================================================================
   Schema  ->  schema.js
   Tolerant normaliser. Accepts the current shape and degrades gracefully so
   the JSON can evolve. Produces a stable id (filename slug, or meta.id, else
   a content hash) so a deck keeps its saved position across text edits.

   Decks are treated as UNTRUSTED input: every string is run through clean()
   (String-coerce, strip control chars, trim, length-cap), every number is
   coerced with Number.isFinite guards, and pathological decks are capped
   (MAX_SLIDES, MAX_TOKENS per slide). The UI renders deck strings with
   textContent only, so this is belt-and-suspenders, not the sole defence.
   ========================================================================== */
TP.Schema = (function(){
  // Caps for pathological / hostile decks.
  var MAX_SLIDES = 2000;      // slides beyond this are dropped
  var MAX_TOKENS = 60000;     // tokens (words + pauses) kept per slide
  var MAX_STR    = 4000;      // default string length cap (short label fields)
  var MAX_TITLE  = 200;       // tighter cap for very short label fields
  var MAX_BODY   = 2000000;   // generous cap for paragraph/script body text

  function hash(str){                       // djb2 -> base36, deterministic
    let h = 5381;
    for (let i=0;i<str.length;i++) h = ((h<<5)+h + str.charCodeAt(i)) >>> 0;
    return h.toString(36);
  }
  // Sanitise an untrusted string: coerce, strip control chars, trim, length-cap.
  function clean(v, maxLen){
    if (v==null) return "";
    // strip C0 control chars (incl. tab/newline) and DEL, then trim and length-cap
    var s = String(v).replace(/[\x00-\x1F\x7F]/g, "").trim();
    var cap = maxLen || MAX_STR;
    return s.length > cap ? s.slice(0, cap) : s;
  }
  // slug: lowercase, non-alphanumerics -> '-', collapse/trim dashes. "" if empty.
  function slug(v){
    if (v==null) return "";
    return String(v).toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, MAX_TITLE);
  }
  function num(v){ return (typeof v==="number" && Number.isFinite(v)) ? v : null; }

  function toParagraphs(slide){
    // body text: strip control chars + trim, but don't apply the short label cap
    // (a long script is legitimate; pathological size is bounded by MAX_TOKENS).
    if (Array.isArray(slide.paragraphs) && slide.paragraphs.length)
      return slide.paragraphs.map(s=>clean(s, MAX_BODY)).filter(Boolean);
    const blob = typeof slide.script==="string" ? slide.script
               : typeof slide.text==="string"   ? slide.text : "";
    return blob.split(/\n\s*\n/).map(s=>clean(s, MAX_BODY)).filter(Boolean);
  }
  // Pause tokens in the script: [[pause]] = 1s, [[pause:N]] = N seconds, [[pause:Nms]] = N ms.
  var PAUSE_RE = /\[\[\s*(?:pause|beat)\b\s*[:= ]?\s*([0-9]*\.?[0-9]+)?\s*(ms|s|sec|secs)?\s*\]\]/ig;
  function pauseMs(num, unit){
    if (num==null) return 1000;
    var n = parseFloat(num); if (isNaN(n)) return 1000;
    return (unit && unit.toLowerCase()==="ms") ? Math.max(0,n) : Math.max(0, n*1000);
  }
  function parseParagraph(text){            // -> [{kind:'word',text} | {kind:'pause',ms}]
    var tokens=[], last=0, m; PAUSE_RE.lastIndex=0;
    while ((m = PAUSE_RE.exec(text))){
      text.slice(last,m.index).split(/\s+/).filter(Boolean).forEach(function(w){ tokens.push({kind:"word",text:w}); });
      tokens.push({kind:"pause", ms:pauseMs(m[1],m[2])});
      last = m.index + m[0].length;
    }
    text.slice(last).split(/\s+/).filter(Boolean).forEach(function(w){ tokens.push({kind:"word",text:w}); });
    return tokens;
  }
  function tokenise(paras){                 // paragraphs -> [{tokens:[..]}], + word/seq counts
    var words=0, seq=0;
    var structured = [];
    for (var i=0;i<paras.length;i++){
      var tokens = parseParagraph(paras[i]);
      var kept = [];
      for (var j=0;j<tokens.length;j++){
        if (seq >= MAX_TOKENS) break;       // cap pathological slides
        var t = tokens[j]; kept.push(t); seq++; if(t.kind==="word") words++;
      }
      if (kept.length) structured.push({tokens:kept});
      if (seq >= MAX_TOKENS) break;
    }
    return {structured:structured, words:words, seq:seq};
  }
  function normalise(raw, fallbackName){
    const all = Array.isArray(raw && raw.slides) ? raw.slides
              : Array.isArray(raw) ? raw : [];
    const list = all.slice(0, MAX_SLIDES);
    const slides = list.map((s,i)=>{
      s = s || {};
      const paras = toParagraphs(s);
      const {structured, words, seq} = tokenise(paras);
      const number = num(s.number)!=null ? s.number : i+1;
      return {
        number,
        title: clean(s.title, MAX_TITLE) || ("Slide "+number),
        type:  clean(s.type, MAX_TITLE),
        onScreen: clean(s.onScreen),
        estimatedMinutes: num(s.estimatedMinutes),
        wordCount: num(s.wordCount)!=null ? s.wordCount : words,
        paragraphs: structured,
        total: seq                  // position space: words + pauses
      };
    });
    const meta = (raw && typeof raw==="object" && !Array.isArray(raw) && raw.meta) || {};
    const first = slides[0], last = slides[slides.length-1];
    const range = clean(meta.slideRange, MAX_TITLE) ||
      (slides.length ? (first.number + (last!==first ? "-"+last.number : "")) : "");
    // id: filename slug, or meta.id, else content hash (keeps old hash-id decks valid).
    const metaId = slug(meta.id);
    const nameId = slug(fallbackName);
    const seed = (clean(meta.title, MAX_TITLE)||clean(fallbackName, MAX_TITLE)||"") + "|" + slides.length + "|" +
      (first ? first.paragraphs.map(p=>p.tokens.filter(t=>t.kind==="word").slice(0,6).map(t=>t.text).join(" ")).join(" ").slice(0,80) : "");
    return {
      id: metaId || nameId || hash(seed || JSON.stringify(raw).slice(0,200)),
      title: clean(meta.title, MAX_TITLE) || clean(fallbackName, MAX_TITLE) || "Untitled deck",
      slideRange: range,
      voice: clean(meta.voice, MAX_TITLE),
      slides
    };
  }
  return {normalise, slug, clean};
})();
