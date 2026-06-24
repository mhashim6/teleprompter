"use strict";
window.TP = window.TP || {};

/* ==========================================================================
   Const  ->  constants.js
   The single source for every tunable number in the app: clamp bounds, step
   sizes, pace multipliers, and timing intervals. Frozen so nothing can be
   mutated at runtime. Pure data, no dependencies — loads first.

   NOTE: the pace slider's min/max/step are ALSO declared as HTML attributes
   on #wpm (index.html). Keep the two in sync by hand; they can't be de-duped
   without a build step (the app is deliberately no-build).
   ========================================================================== */
TP.Const = Object.freeze({
  // pace (words per minute)
  WPM_MIN: 60, WPM_MAX: 220, WPM_STEP: 5,

  // reading-text size, as a multiplier of the base size
  FONT_MIN: 0.6, FONT_MAX: 2.4, FONT_STEP: 0.1,

  // line spacing (CSS line-height, unitless)
  LEAD_MIN: 1.2, LEAD_MAX: 2.4, LEAD_STEP: 0.1,

  // pace math: a word's base duration is BASE_MS_PER_MIN / wpm, scaled up
  // after punctuation. Pauses are absolute ms and are never scaled.
  BASE_MS_PER_MIN: 60000,
  MULT_SENTENCE: 1.9,   // after sentence-final  . ? ! …
  MULT_CLAUSE: 1.4,     // after clause-ending   , ; :

  // timing intervals (ms)
  SAVE_THROTTLE_MS: 1200,   // position-save cadence while playing
  TOAST_MS: 2200,           // toast visibility
  AUTOADVANCE_MS: 700,      // delay before auto-advancing to the next slide

  // reading layout
  DEFAULT_READ_ANCHOR: 0.22 // fraction of reader height; mirrors CSS --read-anchor
});
