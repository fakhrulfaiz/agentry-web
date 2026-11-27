# Browser live view: the agent's cursor (plan)

Date: 2026-11-27. Repos: `~/code/dsh-agents-api` (relay + live stream) and `~/code/agentry-web` (overlay).

## Goal

The Browser tab's live view shows where the agent points and clicks: an arrow that glides to each point, a press and ripple on click, and a short outline on the field the agent types into. Today nothing is drawn: the live view is a CDP screencast (no pointer in it), and Playwright clicks by sending `Input.dispatchMouseEvent` over its own CDP connection, which the relay cannot see.

## Approach (decided)

The page still receives Playwright's mouse events, so the relay listens for them inside the page and reports them. No change to how the agent acts.

## Global constraints

- Commit as `fakhrulfaiz <fakhrulfaiz2003@gmail.com>`. No `Co-Authored-By`, no AI attribution anywhere.
- Web: astryx components and tokens, StyleX for layout glue only, no raw hex/px (use tokens; positions computed at runtime go through inline transform only where StyleX dynamic styles cannot, follow what `BrowserViewport.tsx` already does for its overlays).
- Both repos: dated CHANGELOG bullet; API also a `docs/changes/2026-11-27-browser-cursor.md`.
- Vitest while working; no e2e.

## Task 1: API relay reports pointer and focus

Files: `src/sandbox/browser-live-relay.ts`, `src/sandbox/browser-live.ts`, tests beside the existing relay/live tests.

1. New exported constant `POINTER_LISTENER_SOURCE` (JavaScript source, tested on its own like `RELAY_COMMAND_SOURCE`). Installed once per document (guard flag on `window`). Capture-phase, passive listeners on `window` for `mousemove`, `mousedown`, `mouseup`, and `focusin`; only `event.isTrusted`; only in the top frame (`window.top === window`). Calls the binding `__agentryPointer` with a JSON string:
   - `{"a":"move","x","y"}` (moves throttled to one per 50 ms, latest wins, trailing call kept),
   - `{"a":"down"|"up","x","y","b":button}` (always sent),
   - `{"a":"focus","x","y","w","h"}` for `focusin` on `input`, `textarea`, `select` or `[contenteditable]` (its `getBoundingClientRect()`).
   Coordinates are `clientX/clientY` (viewport CSS px), which match the screencast.
2. In `follow()`, after `Target.attachToTarget` and before `Page.startScreencast`: `Runtime.addBinding({ name: '__agentryPointer' })`, `Page.addScriptToEvaluateOnNewDocument({ source: POINTER_LISTENER_SOURCE })`, `Runtime.evaluate({ expression: POINTER_LISTENER_SOURCE })`, all on the page's session, failures ignored. Verify against real Chromium whether `Runtime.bindingCalled` needs `Runtime.enable`; enable it only if needed.
3. On `Runtime.bindingCalled` for the active session and that name: parse the payload, drop it unless every number is finite and within 0..100000, and write `{"type":"pointer","action","x","y","ts"}` or `{"type":"focus","x","y","width","height","ts"}`. Never more than 30 pointer lines a second (drop extra moves, never down/up).
4. `browser-live.ts`: extend the relay-line parser and the reader fan-out with `LivePointer` / `LiveFocus` kinds and send them to readers as SSE events `pointer` and `focus` (not stored as `last`; a new reader gets no stale pointer). Keep the existing frame/idle/control behavior byte-for-byte.
5. Document the two new lines in the relay's header comment and in `docs/sandbox.md` (live view section).

Tests: listener source (run it in a fake `window` with stub `addEventListener`/binding: throttling, isTrusted, focus filter), relay payload validation, `browser-live` parser and fan-out of the new events.

## Task 2: Web overlay

Files: `src/chat/use-browser-live.ts`, `src/chat/browser-input.ts`, new `src/ui/preview/BrowserCursor.tsx`, `src/ui/preview/BrowserViewport.tsx`, tests in `tests/unit/browser-input.spec.ts`, `tests/component/browser-viewport.spec.tsx` (or a new `browser-cursor.spec.tsx`).

1. `browser-input.ts`: `toFramePoint(x, y, box)`, the inverse of `toPagePoint` (same letterbox maths), unit-tested both ways.
2. `use-browser-live.ts`: listen for `pointer` and `focus`; expose `pointer?: { x, y, action, at }` and `focus?: { x, y, width, height, at }` beside the frame. Clear both on `idle`, on a URL change of the frame, and on reconnect.
3. `BrowserCursor.tsx`: an absolutely positioned layer over the frame (pointer-events none, `aria-hidden`). An arrow icon (heroicons `CursorArrowRaysIcon` or an inline SVG with `currentColor`, coloured by a token with a light outline so it reads on any page) moved with `transform: translate(...)` and a 350 ms ease-out transition, so Playwright's jumps become glides. `down`: arrow scales to 0.85 and a ring expands and fades (about 400 ms). `focus`: a token-coloured outline around the rect that fades after about 1.2 s. Hidden after 3 s without events, while the user has control, and before the first pointer event. Reduced motion: no transition, no ripple, outline without fade animation.
4. Render it in `BrowserViewport.tsx` over the live frame only (not stored screenshots), using the same frame box the input mapping uses.

Tests: mapping, hook event parsing and clearing, overlay position for a given box, hidden while controlled, reduced motion without transition.

## Task 3: Finish

- `pnpm typecheck` + `pnpm test` in agentry-web; the API's typecheck + unit tests.
- Live check if a browser sandbox can be started locally (browser image `ghcr.io/fakhrulfaiz/agentry-sandbox-browser:1`): open a chat with the browser on, ask it to click something, watch the cursor. If not possible, say so in the report and in both CHANGELOG bullets ("not yet checked live").
- AGENTS.md (agentry-web) backlog item 3: add "agent cursor in the live view (2026-11-27, branch `feat/browser-cursor`)".
- Commit per task on `feat/browser-cursor` in both repos. Do not merge, do not push.

## Out of scope

Cursor inside cross-origin iframes; scroll indicators; recording the live view to video (separate idea, see the 2026-11-27 notes in the session state memory).
