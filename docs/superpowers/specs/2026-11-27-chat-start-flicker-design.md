# Chat start flicker and composer dock (2026-11-27)

Status: proposed 2026-11-27. Short design, approved in conversation on 2026-11-27.

## Why

On a new chat page the composer is intentionally large and centered. As soon as the first message exists, it should become the small composer docked at the bottom of the chat, like every open chat. Today it stays tall until the route changes to `/c/<id>`, then jumps to the small size.

After the first send, the waiting state also jumps through three states: “Starting the chat…” on `/`, “Loading conversation…” just after the route change, then “Agentry is thinking…”. The waiting row can disappear before the first token, leaving a blank area. This is a UI timing issue; no theme flash was reproduced.

## Goals / non-goals

- Goals:
  - The tall composer exists only on the empty new-chat page.
  - On first send, the composer shrinks and docks immediately, before session creation or navigation finishes.
  - A first send keeps one continuous label: the new-chat start label while the chat becomes ready, then “Agentry is thinking…”. It never says “Loading conversation…”.
  - The waiting row stays until the user sees real output (assistant text, reasoning, tool, subagent, action, command result or notice), or until the turn ends/errors.
  - Opening or reloading an existing chat keeps the current “Loading conversation…” behavior.
- Non-goals:
  - No change to the reducer's pure event-fold or to stream/history fetching.
  - No broad opening/sending/live/idle phase model.
  - No theme/CSS “black flash” work.
  - No change to the open-chat composer's size; it is already the small/balanced one.

## Approaches considered

- **A. UI-only height change.** Fixes the jump but leaves the label and blank-gap flicker. Rejected.
- **B. Broad phase refactor in the hook/reducer.** Clean-looking but moves UI phases into a pure event reducer and touches stream/history behavior. Rejected as too risky for this bug.
- **C. Carry the first-send handoff into the conversation and derive UI from explicit flags.** Chosen. The hook already uses `pending-first` to seed the first user message; the same handoff can carry the start label and a small `firstSend` flag. Label and waiting-row logic stay pure helpers, and the reducer is untouched.

## Design

### Composer height and docking

`NewChat` builds one `composer` element for both its empty and pending layouts. Make its density depend on whether a message exists:

- no pending message: `density="spacious"` (the current tall centered form);
- pending message: `density="balanced"` (the small docked form used by open chats).

`Composer` already forwards `density` to `ChatComposer` and sets `data-tall` on its root for `spacious`, so the DOM marker is the test seam. Keep `ChatLayout density="spacious"` in the pending layout: the open-chat layout uses that too, and it is the composer's input height, not the layout's max width, that changes.

`Conversation` needs no density change.

### First-send handoff

Extend `PendingFirst` (`src/chat/pending-first.ts`) with an optional `startLabel?: string`. `NewChat` sets it when it calls `setPendingFirst`: `Starting a sandbox…` for a new sandbox, otherwise `Starting the chat…`.

`useConversation` captures the handoff before `clearPendingFirst(sessionId)` in its existing reset effect and exposes it as `firstSend: { startLabel: string } | null` alongside `state`, `loaded` and `ready`. It must reset when `sessionId` changes, so a later chat in the same mounted component cannot inherit the flag. `seededState` keeps using the handoff's `text/files` as it does now.

### Waiting label and row

Add two pure helpers in `src/chat/show-steps.ts`:

- `waitingLabel(loading, status, firstSend?, ready?)`:
  - first send and not ready → `firstSend.startLabel`;
  - loading without a first-send handoff → `Loading conversation…`;
  - `in_progress` → `Agentry is thinking…`;
  - otherwise → `Sending…`.
- `hasVisibleOutput(items)` returns true for any assistant-side view that actually renders: assistant text with non-empty content, reasoning (its header renders even before text arrives), tool, subagent, action, command result or notice. It returns false for user rows and for empty assistant rows (which `Message` deliberately returns `null` for).

`Conversation` uses `hasVisibleOutput(state.items)` instead of its narrower `liveActivity` check. Its `waiting` condition keeps the row for a first send until visible output, a new notice, a terminal/idle session status after `ready`, a closed stream, or an unavailable-server error. Follow-up sends keep the current `sent`/status behavior but use the same helper, so an empty assistant row cannot hide the row early.

The reducer, `use-conversation`'s fetch order and the SSE loop are unchanged.

## Tests and verification

- Unit (`tests/unit/show-steps.spec.ts`): first-send label uses the start label until `ready`, then “Agentry is thinking…”; normal history loading still says “Loading conversation…”; `hasVisibleOutput` ignores user rows and empty assistant rows but counts reasoning, tools and notices.
- Component: a new-chat component test sends a message with a deferred `createSession` and asserts the composer's `data-tall` disappears immediately while still on the new-chat pending view. A conversation test with a first-send handoff asserts the waiting row does not say “Loading conversation…” and remains until an output frame arrives.
- Run `pnpm typecheck` and `pnpm test`; then run a production build/probe (`pnpm build`, mock API, `pnpm start`) and confirm the first send never shows the tall composer or “Loading conversation…”, matching the dev trace.
- Update `CHANGELOG.md` with a dated behavior-change bullet.

## Risks

- The first-send flag must be consumed once and reset per `sessionId`; otherwise a later chat could show the wrong label. The reset effect and tests cover this.
- Counting reasoning before its text arrives may hide the waiting row a little earlier than text-only logic did. This is intentional: its “Thinking…” header is visible output. The empty assistant row remains ignored because it renders nothing.
