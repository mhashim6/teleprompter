"use strict";
/* Boot. Classic scripts share the global window.TP namespace and load in
   dependency order (schema, store, prompter, ui) before this file.
   UI.init() reads prefs, applies them, binds the engine callbacks, and
   restores the active deck. */
window.TP = window.TP || {};

TP.UI.init();
