"use strict";
window.TP = window.TP || {};

/* ==========================================================================
   Welcome  ->  welcome.js
   Pure DATA: the raw deck for the self-running landing session shown when no
   deck is loaded. It is normalised by TP.Schema and played through the real
   TP.Prompter pipeline exactly like an imported deck, but the shell never
   persists it (it stays an in-memory "welcome" deck — see ui.js loadWelcome).

   Keep it to roughly one paragraph; the [[pause]] beats demo the pause glyph,
   and the copy names the on-screen controls the coach-marks point at. No logic
   lives here, so there is nothing to unit-test beyond "it still normalises to a
   playable, pause-bearing deck" (test/welcome.test.js).
   ========================================================================== */
TP.Welcome = Object.freeze({
  RAW: {
    meta: { title: "Welcome" },
    slides: [
      {
        number: 1,
        title: "Welcome",
        type: "intro",
        onScreen: "a teleprompter that reads with you",
        script:
          "This is a teleprompter. [[pause]] It reads your script back to you one " +
          "word at a time, lighting up where you are so your eyes never lose the " +
          "line. [[pause:1.2]] Press play to start or stop, and use the pace slider " +
          "to find your speed. Open the menu to load a deck or build your own in " +
          "the studio. [[pause]] When you're ready, drop in your words, and let's " +
          "begin."
      }
    ]
  }
});
