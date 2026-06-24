"use strict";
window.TP = window.TP || {};

/* ==========================================================================
   Store  ->  store.js
   localStorage with an in-memory fallback (so a sandbox that blocks storage
   degrades instead of throwing). No DOM. Persists: prefs (global), a deck
   index, raw deck bodies, and per-deck reading positions.
   ========================================================================== */
TP.Store = (function(){
  const NS = "tp:";
  let backend, persistent = true;
  try {
    const k = NS+"__probe"; localStorage.setItem(k,"1"); localStorage.removeItem(k);
    backend = localStorage;
  } catch(e){
    persistent = false;
    const mem = new Map();
    backend = {
      getItem:k=>mem.has(k)?mem.get(k):null,
      setItem:(k,v)=>mem.set(k,String(v)),
      removeItem:k=>mem.delete(k)
    };
  }
  // Failures (e.g. a full quota on write) are caught so the app degrades instead
  // of throwing; the optional onError sink lets the UI surface them. Default no-op
  // keeps the original silent behaviour exactly.
  let onError = ()=>{};
  const get = (k,d)=>{ try{ const v=backend.getItem(NS+k); return v==null?d:JSON.parse(v); }catch(e){ onError("get",k,e); return d; } };
  const set = (k,v)=>{ try{ backend.setItem(NS+k, JSON.stringify(v)); }catch(e){ onError("set",k,e); } };
  const del = k=>{ try{ backend.removeItem(NS+k); }catch(e){ onError("del",k,e); } };

  const DEFAULT_PREFS = {theme:"day", wpm:130, fontScale:1, lineHeight:1.62,
                         mirror:false, flip:false,
                         guide:true, autoScroll:true, autoAdvance:false};
  return {
    persistent,
    // Optional wiring. onError(op,key,err): write/read failures. backend: a
    // {getItem,setItem,removeItem} seam, used by tests to inject a clean store.
    configure(opts){
      if(!opts) return;
      if(typeof opts.onError === "function") onError = opts.onError;
      if(opts.backend) backend = opts.backend;
    },
    getPrefs(){ return Object.assign({}, DEFAULT_PREFS, get("prefs",{})); },
    setPrefs(patch){ set("prefs", Object.assign(this.getPrefs(), patch)); },

    listDecks(){ return get("index", []); },
    saveDeck(meta, raw){                       // meta:{id,name,title,slideRange}
      const idx = this.listDecks().filter(d=>d.id!==meta.id);
      idx.unshift(Object.assign({addedAt:Date.now()}, meta, {updatedAt:Date.now()}));
      set("index", idx);
      set("raw:"+meta.id, raw);
    },
    getRaw(id){ return get("raw:"+id, null); },
    removeDeck(id){
      set("index", this.listDecks().filter(d=>d.id!==id));
      del("raw:"+id); del("pos:"+id);
      if (this.getActive()===id) this.setActive(null);
    },
    getPos(id){ return get("pos:"+id, {slideIndex:0, word:0}); },
    setPos(id,pos){ set("pos:"+id, Object.assign({updatedAt:Date.now()}, pos)); },
    resetPos(id){ set("pos:"+id, {slideIndex:0, word:0, updatedAt:Date.now()}); },

    getActive(){ return get("active", null); },
    setActive(id){ id==null ? del("active") : set("active", id); }
  };
})();
