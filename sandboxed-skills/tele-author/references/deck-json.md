# Reference: the deck JSON output contract

This is the file the teleprompter app loads. You produce it directly from the
`.deck.md` (see `format.md`). The app re-normalises it on load — it recomputes
word counts, parses `script` into word/pause tokens, derives the `id`, and
sanitises every string — so you only need the *shape* below to be right.

## Shape

```jsonc
{
  "meta": {
    "title": "Demo deck",
    "id": "demo-deck",            // = slug(title) unless the user set one; KEEP STABLE across edits
    "voice": "conversational",     // optional, informational
    "language": "en-GB"            // optional, informational (carried for readability; the app ignores it)
  },
  "slides": [
    {
      "number": 1,                 // integer; auto-index from position if absent
      "title": "Opening",          // omit "N · " — just the title text
      "type": "content",           // optional (e.g. content, section-divider)
      "onScreen": "You, to camera.", // optional; from the slide's `on-screen:`
      "estimatedMinutes": 0.15,    // from the slide's `target:` (a number, in minutes)
      "script": "...",             // narration; paragraphs joined with \n\n, pause beats verbatim
      "wordCount": 15              // display-only; the app recomputes on load (still set it honestly)
    }
  ]
}
```

Only these fields. Don't invent others.

## Transform rules (`.deck.md` → JSON)

- **Title**: the heading text without the leading number/separator. `## 1 · Opening`
  → `"title": "Opening"`, `"number": 1`.
- **Directives** map straight across: `type:` → `type`, `on-screen:` → `onScreen`,
  `target:` → `estimatedMinutes`. Omit a field if its directive is absent.
- **script**: within a paragraph, collapse soft-wrapped lines to single spaces.
  Join paragraphs with a blank line — i.e. `"\n\n"` in the JSON string. Keep every
  `[[pause]]` / `[[pause:N]]` / `[[pause:Nms]]` / `[[beat]]` beat exactly as written.
- **wordCount**: remove the `[[…]]` pause beats, then count whitespace-separated
  words in what remains. Pauses never count as words.
- **id** (`meta.id`): lowercase the title (or the user's chosen id), replace runs of
  non-alphanumerics with `-`, and trim leading/trailing `-`. Keep it stable across
  edits so the app preserves the saved reading position.

## Worked example

Input `demo-deck.deck.md`:

```markdown
---
title: Demo deck
id: demo-deck
voice: conversational
language: en-GB
---

## 1 · Opening
type: content
on-screen: You, to camera.
target: 0.15

This is the first paragraph, spoken as one beat. [[pause]]

A second paragraph before the reveal. [[pause:1.5]]

## 2 · The point
type: section-divider
on-screen: A title card.
target: 0.1

Keep it short. Make it land.
```

Output `demo-deck.json`:

```json
{
  "meta": {
    "title": "Demo deck",
    "id": "demo-deck",
    "voice": "conversational",
    "language": "en-GB"
  },
  "slides": [
    {
      "number": 1,
      "title": "Opening",
      "type": "content",
      "onScreen": "You, to camera.",
      "estimatedMinutes": 0.15,
      "script": "This is the first paragraph, spoken as one beat. [[pause]]\n\nA second paragraph before the reveal. [[pause:1.5]]",
      "wordCount": 15
    },
    {
      "number": 2,
      "title": "The point",
      "type": "section-divider",
      "onScreen": "A title card.",
      "estimatedMinutes": 0.1,
      "script": "Keep it short. Make it land.",
      "wordCount": 6
    }
  ]
}
```

Note how slide 1's two paragraphs are joined with `\n\n`, both pause beats survive,
and `wordCount` is 15 (the two `[[pause]]` beats are not counted). Slide 2 has 6
words and no pauses.
