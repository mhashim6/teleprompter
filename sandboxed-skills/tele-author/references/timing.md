# Reference: the timing math (duration report)

These formulas are transcribed from the teleprompter app's timing core
(`src/engine.js` and `src/constants.js` in the source repo). They are the same
math the app uses at playback, so a report you compute here matches what the
speaker will actually experience. If the app's constants ever change, this file
must be re-exported.

## Per-token duration

Walk each slide's narration left to right as a sequence of tokens (words and pause
beats) and sum their durations.

- **Base word duration**: `base = 60000 / wpm` milliseconds, where `wpm` is the
  reference pace (default **130**).
- A word **ending in sentence-final punctuation** `.` `?` `!` `…` takes
  `base × 1.9`.
- A word **ending in clause punctuation** `,` `;` `:` takes `base × 1.4`.
- Any other word takes `base`.
- A **pause** takes its absolute time, never scaled by pace:
  `[[pause]]` = 1000 ms, `[[pause:N]]` = N × 1000 ms, `[[pause:Nms]]` = N ms,
  `[[beat]]` = 1000 ms.

Punctuation is judged on the **last character** of the word token (the beat
brackets are their own tokens and don't affect the adjacent word).

## Aggregates

- **Slide duration** = sum of its token durations.
- **Deck total** = sum of all slide durations.
- **Clock format** `m:ss`: `total_seconds = round(ms / 1000)`, then
  `floor(total_seconds / 60) : (total_seconds % 60)` zero-padded to two digits.
- **Implied pace** of a slide = `wordCount / estimatedMinutes` (words per minute).
  Flag the slide if this falls **outside 60–220 wpm** — below means it's too thin
  for its target, above means it's too dense.
- **Delta vs target** = slide duration − `estimatedMinutes × 60000` ms; report as
  `±m:ss`.

## Worked example

Slide 1 from `deck-json.md` (`target: 0.15`), at **130 wpm** → `base = 461.54 ms`.

```
script: "This is the first paragraph, spoken as one beat. [[pause]]
         A second paragraph before the reveal. [[pause:1.5]]"
```

| token        | rule                  | ms       |
|--------------|-----------------------|----------|
| This         | base                  |   461.54 |
| is           | base                  |   461.54 |
| the          | base                  |   461.54 |
| first        | base                  |   461.54 |
| paragraph,   | clause × 1.4          |   646.15 |
| spoken       | base                  |   461.54 |
| as           | base                  |   461.54 |
| one          | base                  |   461.54 |
| beat.        | sentence × 1.9        |   876.92 |
| [[pause]]    | absolute              |  1000.00 |
| A            | base                  |   461.54 |
| second       | base                  |   461.54 |
| paragraph    | base                  |   461.54 |
| before       | base                  |   461.54 |
| the          | base                  |   461.54 |
| reveal.      | sentence × 1.9        |   876.92 |
| [[pause:1.5]]| absolute              |  1500.00 |
| **total**    |                       | **10438** |

→ `10438 ms` → **0:10**.

Implied pace = `15 words / 0.15 min` = **100 wpm**, inside 60–220 → no flag.
(If the target were `0.4`, implied pace would be `15 / 0.4` = 37.5 wpm → below 60
→ flag the slide as too thin for its target.)

## Report layout

Show one row per slide and a deck total, e.g.:

```
deck "Demo deck"  (id: demo-deck)  @ 130 wpm

    1   0:10    15w   2p(+2.5s)  Opening          [target 0:09, +0:01]
    2   0:04     6w   0p(+0.0s)  The point        [target 0:06, -0:02]

  total 0:14  (21 words, 2 pauses)
```
