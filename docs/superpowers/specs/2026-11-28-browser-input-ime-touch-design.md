# Browser take-over: IME and touch input — design

*Status: 2026-11-28, approved for planning. P3 "browser leftovers", IME/touch slice only.*

## Intent and why

While you have control of the agent's browser (the Browser tab's Take control), typing and scrolling should work with an input method and on a touch screen the way they do in a normal browser. Today the viewport sends each single-character keydown as a `text` event, so composed input (Japanese, Chinese, Korean, accented characters chosen from a candidate list) sends the intermediate keystrokes instead of the finished text, and the viewport sets `touchAction: none` with only a wheel listener, so a finger drag does not scroll the remote page.

## Goals

- Composed text reaches the remote page once, as the final committed string, without the keystrokes that produced it.
- A one-finger drag scrolls the remote page; a tap still clicks.
- Ordinary keyboard, mouse and paste behaviour is unchanged, including Esc leaving the frame and never reaching the page.

## Non-goals and anti-goals

- Copying text out of the page (needs an API-side read of the page's selection).
- A per-chat browser switch in the composer.
- Clipboard writes, pinch-to-zoom, multi-touch gestures, or any change to the API, BFF, saved agent settings, or the agent cursor.
- Anti-goal: sending both the raw composition keystrokes and the committed text, or making IME users unable to type at all.

## Constraints

- Input reaches the page only through the existing `POST .../browser/input` events (`key`, `text`, `wheel`, `mouse`, `resize`), in page CSS pixels; no new routes.
- All input helpers stay in `src/chat/browser-input.ts`; the DOM events stay in `src/ui/preview/BrowserViewport.tsx`.
- astryx components and tokens for UI, StyleX only for layout glue; no new dependencies.
- Tests: `tests/unit/browser-input.spec.ts` (pure mapping) and `tests/component/browser-viewport.spec.tsx` (jsdom DOM behaviour), using the repo's existing patterns. One dated CHANGELOG bullet.

## Approaches

1. **Web-only, composition-aware key mapping plus touch-as-wheel (chosen).** Track `compositionstart`/`compositionend` on the frame; while composing, send key events without a `text` field and send the committed `compositionend.data` as one `text` event. Treat pointer events with `pointerType === 'touch'` separately: down/up still produce mouse down/up (taps click), while moves with the finger down produce `wheel` events scaled into page pixels. This fixes both gaps where they occur, needs no API change, and is covered by pure unit tests plus DOM tests.
2. **Teach the API to accept composition events.** Rejected: it would cross repos and add a wire contract for something the browser already reports as a finished string, while still leaving the touch gap in the web app.
3. **Overlay an invisible native input and read its value.** Rejected: it duplicates browser focus and caret behaviour, fights the existing image-based focus model, and risks double text.

## Decided design

- `keyEvent()` gains an optional composing flag: while true it omits `text` from the key event. A small pure helper turns `CompositionEvent.data` into the existing `text` event, capped like paste at 2000 characters and dropped when empty.
- The viewport keeps a composition ref, resets it on blur/control loss, and sends the committed string on `compositionend`. Keydown/keyup still carry key identity (without text) while composing so non-printing keys keep working.
- For touch, the viewport remembers the last touch pointer position. Moves with the primary finger down are converted to `wheel` deltas in page pixels (same frame scaling as the existing wheel listener) and coalesce with other wheels; down/up keep their mouse events so taps click. Mouse and pen pointers keep today's path exactly.
- Tests cover: composed keys carry no text and commit one text event; touch drag sends wheel deltas, tap still clicks, mouse drag is unchanged; existing key/pointer/resize tests still pass.

## What is left to the builder

Write the plan, implement the two files and their tests, run typecheck plus the focused suites, and add the CHANGELOG bullet.
