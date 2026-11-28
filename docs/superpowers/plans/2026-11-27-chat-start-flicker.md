# Chat start flicker and composer dock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the new-chat composer tall only while empty, shrink and dock it immediately on the first send, and keep one continuous waiting state until the first visible output.

**Architecture:** Carry a small `firstSend` handoff from `NewChat` through `pending-first` into `useConversation`; keep the label and wait decision in pure helpers; let `Conversation` consume those helpers without changing the reducer or stream/history fetching. `Composer` already exposes `data-tall`, so tests can assert the height state directly.

**Tech Stack:** Next.js 16.4.5 App Router, React 19.3, astryx 0.7.17, StyleX 0.19.1, Vitest + Testing Library, Playwright for the production probe.

**Spec:** `docs/superpowers/specs/2026-11-27-chat-start-flicker-design.md`

## Global Constraints

- Browser JavaScript, storage and requests to the web app never contain an Agentry access token, refresh token or API key.
- Proxy allow-list only; state-changing calls need same-origin plus the session's `x-agentry-csrf` token.
- UI from astryx components and tokens; StyleX only for layout glue; no other CSS framework.
- Exact dependency versions: astryx `0.7.17`, StyleX and `@stylexswc/*` `0.19.1`; no `^` or `~` for those.
- Prefix shells with `export PATH=$HOME/.nvm/versions/node/v24.19.0/bin:$PATH` on this WSL machine.
- Do not add `Co-Authored-By` or AI attribution. Commit as `fakhrulfaiz <fakhrulfaiz2003@gmail.com>`.
- Update `CHANGELOG.md` with a dated behavior-change bullet before finishing.

## Review Focus

- Slow session creation or history read on a first send: must show the start label, never “Loading conversation…”. Pinned in Task 1 `waitingLabel` tests and Task 4 component test.
- An empty assistant item arrives before tokens: the waiting row must stay, because `Message` renders nothing for that view. Pinned in Task 1 `hasVisibleOutput`/`shouldWaitForOutput` tests.
- First visible output is reasoning, a tool, a subagent, an action, a command result or a notice rather than answer text: the waiting row must disappear. Pinned in Task 1 `hasVisibleOutput` tests.
- First send fails, or the hook switches to another `sessionId`: no stale start label or tall/short composer state leaks. Pinned in Task 2 `firstSend` tests and Task 3 failure test.
- Turn ends, stream closes, or the server is unavailable with no visible output: no infinite waiting row. Pinned in Task 1 `shouldWaitForOutput` tests.

---

## File structure

- `src/chat/pending-first.ts`: remains the one in-memory handoff from the new-chat page; gains `startLabel` and the `FirstSend` type.
- `src/chat/show-steps.ts`: owns pure label/wait decisions and the visible-output check.
- `src/chat/use-conversation.ts`: exposes the consumed handoff as `firstSend`.
- `src/ui/chat/NewChat.tsx`: derives composer density from whether a message exists and writes the start label into the handoff.
- `src/ui/chat/Conversation.tsx`: consumes `firstSend` and the pure helpers; no local wait-label state.
- `tests/unit/show-steps.spec.ts`, `tests/unit/pending-first.spec.ts`, `tests/unit/use-conversation.spec.ts`, `tests/component/new-chat-seed.spec.tsx`, `tests/component/chat-start-waiting.spec.tsx`: tests for the seams above.
- `CHANGELOG.md`: dated behavior-change entry.

### Task 1: Pure handoff type and waiting helpers

**Files:**
- Modify: `src/chat/pending-first.ts`
- Modify: `src/chat/show-steps.ts`
- Modify: `tests/unit/show-steps.spec.ts`
- Create: `tests/unit/pending-first.spec.ts`

**Interfaces:**
- Consumes: `UserFile` from `@/chat/attachments`; `MessageView` from `@/chat/reducer`.
- Produces:
  - `export type FirstSend = { startLabel: string }`
  - `export type PendingFirst = { text: string; files?: UserFile[]; startLabel?: string }`
  - `export function waitingLabel(loading: boolean, status: string, firstSend?: FirstSend | null, ready?: boolean): string`
  - `export function hasVisibleOutput(items: MessageView[]): boolean`
  - `export type WaitOptions = { loading: boolean; ready: boolean; status: string; sent: boolean; firstSend: boolean; visibleOutput: boolean; endedInNotice: boolean; closedReason: boolean; unavailable: boolean }`
  - `export function shouldWaitForOutput(options: WaitOptions): boolean`

- [ ] **Step 1: Write failing tests for `FirstSend` and `PendingFirst`**

In `tests/unit/pending-first.spec.ts`, import `clearPendingFirst`, `peekPendingFirst` and `setPendingFirst` from `@/chat/pending-first`. Add one test named `carries the new-chat start label`: call `setPendingFirst('sess_label', { text: 'hi', startLabel: 'Starting a sandbox…' })`, assert `peekPendingFirst('sess_label')` equals `{ text: 'hi', startLabel: 'Starting a sandbox…' }`, and clear the key in `afterEach`.

- [ ] **Step 2: Run the pending-first test to verify it fails**

Run: `export PATH=$HOME/.nvm/versions/node/v24.19.0/bin:$PATH; pnpm exec vitest run tests/unit/pending-first.spec.ts`

Expected: FAIL because `startLabel` is not part of `PendingFirst` yet (or TypeScript rejects the object).

- [ ] **Step 3: Add `startLabel` and `FirstSend` to `src/chat/pending-first.ts`**

Add `startLabel?: string` to `PendingFirst` and export `FirstSend = { startLabel: string }`. Change no other behavior.

- [ ] **Step 4: Run the pending-first test to verify it passes**

Run: `export PATH=$HOME/.nvm/versions/node/v24.19.0/bin:$PATH; pnpm exec vitest run tests/unit/pending-first.spec.ts`

Expected: PASS.

- [ ] **Step 5: Write failing tests for `waitingLabel`, `hasVisibleOutput` and `shouldWaitForOutput`**

Extend `tests/unit/show-steps.spec.ts` with these imports and assertions:

```ts
import type { MessageView } from '@/chat/reducer'
import { hasVisibleOutput, shouldWaitForOutput, waitingLabel } from '@/chat/show-steps'
```

```ts
it('keeps the first-send label until ready, then says thinking', () => {
  const firstSend = { startLabel: 'Starting a sandbox…' }
  expect(waitingLabel(true, 'idle', firstSend, false)).toBe('Starting a sandbox…')
  expect(waitingLabel(true, 'in_progress', firstSend, true)).toBe('Agentry is thinking…')
  expect(waitingLabel(true, 'in_progress', null, false)).toBe('Loading conversation…')
})
```

```ts
it('counts only views that actually render as visible output', () => {
  const user: MessageView = { kind: 'user', id: 'u', text: 'hello' }
  const emptyAssistant: MessageView = { kind: 'assistant', id: 'a', text: '', streaming: true }
  const reasoning: MessageView = { kind: 'reasoning', id: 'r', text: '', streaming: true }
  const tool: MessageView = { kind: 'tool', id: 't', callId: 'c', name: 'bash', args: {}, status: 'running' }
  const notice: MessageView = { kind: 'notice', id: 'n', level: 'failed', message: 'oops' }
  expect(hasVisibleOutput([])).toBe(false)
  expect(hasVisibleOutput([user, emptyAssistant])).toBe(false)
  expect(hasVisibleOutput([reasoning])).toBe(true)
  expect(hasVisibleOutput([tool])).toBe(true)
  expect(hasVisibleOutput([notice])).toBe(true)
})
```

```ts
it('waits for first-send output but stops at output, notice, terminal status, closure or error', () => {
  const base = { loading: false, ready: true, status: 'idle', sent: false, firstSend: false, visibleOutput: false, endedInNotice: false, closedReason: false, unavailable: false }
  expect(shouldWaitForOutput({ ...base, loading: true })).toBe(true)
  expect(shouldWaitForOutput({ ...base, firstSend: true, ready: false })).toBe(true)
  expect(shouldWaitForOutput({ ...base, firstSend: true, status: 'in_progress' })).toBe(true)
  expect(shouldWaitForOutput({ ...base, firstSend: true, status: 'idle' })).toBe(false)
  expect(shouldWaitForOutput({ ...base, firstSend: true, status: 'failed' })).toBe(false)
  expect(shouldWaitForOutput({ ...base, firstSend: true, visibleOutput: true })).toBe(false)
  expect(shouldWaitForOutput({ ...base, firstSend: true, endedInNotice: true })).toBe(false)
  expect(shouldWaitForOutput({ ...base, firstSend: true, closedReason: true })).toBe(false)
  expect(shouldWaitForOutput({ ...base, firstSend: true, unavailable: true })).toBe(false)
  expect(shouldWaitForOutput({ ...base, sent: true })).toBe(true)
  expect(shouldWaitForOutput({ ...base, status: 'in_progress' })).toBe(true)
})
```

Keep the two existing `waitingLabel(loading, status)` tests unchanged.

- [ ] **Step 6: Run the show-steps tests to verify they fail**

Run: `export PATH=$HOME/.nvm/versions/node/v24.19.0/bin:$PATH; pnpm exec vitest run tests/unit/show-steps.spec.ts`

Expected: FAIL because `hasVisibleOutput`, `shouldWaitForOutput` and the extra `waitingLabel` parameters do not exist.

- [ ] **Step 7: Implement the helpers in `src/chat/show-steps.ts`**

- Import `type MessageView` from `@/chat/reducer` and `type FirstSend` from `@/chat/pending-first`.
- Change `waitingLabel` to `(loading, status, firstSend = null, ready = true)`: return `firstSend.startLabel` when `firstSend && !ready`; keep the existing `Loading conversation…` / `Agentry is thinking…` / `Sending…` branches for all other inputs.
- Implement `hasVisibleOutput` as: return false for a `user` view and for an `assistant` view whose `text.trim()` is empty; return true for every other `MessageView` kind.
- Implement `shouldWaitForOutput` in this order: return false for `closedReason`, `unavailable`, `visibleOutput` or `endedInNotice`; return true for `loading`; if `firstSend`, return false once `ready && (status === 'idle' || status === 'failed')`, otherwise true; for non-first sends return `sent || status === 'in_progress'`.

- [ ] **Step 8: Run the show-steps tests to verify they pass**

Run: `export PATH=$HOME/.nvm/versions/node/v24.19.0/bin:$PATH; pnpm exec vitest run tests/unit/show-steps.spec.ts`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/chat/pending-first.ts src/chat/show-steps.ts tests/unit/pending-first.spec.ts tests/unit/show-steps.spec.ts
git commit -m "fix: add first-send waiting helpers"
```

### Task 2: Expose `firstSend` from `useConversation`

**Files:**
- Modify: `src/chat/use-conversation.ts`
- Modify: `tests/unit/use-conversation.spec.ts`

**Interfaces:**
- Consumes: `FirstSend` and `peekPendingFirst`/`clearPendingFirst` from Task 1.
- Produces: `useConversation(...)` return type gains `firstSend: FirstSend | null`.

- [ ] **Step 1: Write failing tests in `tests/unit/use-conversation.spec.ts`**

Add to the existing `describe('useConversation first message')` block:

```ts
it('exposes and consumes the new-chat handoff as firstSend', async () => {
  const { peekPendingFirst, setPendingFirst } = await import('@/chat/pending-first')
  setPendingFirst(SID, { text: 'hello there', startLabel: 'Starting the chat…' })
  const { result, unmount } = renderHook(() => useConversation(SID))
  expect(result.current.firstSend).toEqual({ startLabel: 'Starting the chat…' })
  await flush()
  expect(peekPendingFirst(SID)).toBeUndefined()
  unmount()
})

it('does not leak firstSend when the hook switches sessions', async () => {
  const { setPendingFirst } = await import('@/chat/pending-first')
  setPendingFirst(SID, { text: 'hello there' })
  const { result, rerender, unmount } = renderHook(({ id }) => useConversation(id), { initialProps: { id: SID } })
  expect(result.current.firstSend).toEqual({ startLabel: 'Starting the chat…' })
  rerender({ id: 'sess_other' })
  await flush()
  expect(result.current.firstSend).toBeNull()
  unmount()
})
```

- [ ] **Step 2: Run the useConversation tests to verify they fail**

Run: `export PATH=$HOME/.nvm/versions/node/v24.19.0/bin:$PATH; pnpm exec vitest run tests/unit/use-conversation.spec.ts -t firstSend`

Expected: FAIL because `result.current.firstSend` is `undefined`.

- [ ] **Step 3: Capture and return the handoff in `src/chat/use-conversation.ts`**

- Import `type FirstSend` from `./pending-first`.
- Add `const [firstSend, setFirstSend] = useState<FirstSend | null>(null)` next to `loaded`/`ready`.
- In the existing reset effect that already calls `clearPendingFirst(sessionId)`, read `peekPendingFirst(sessionId)` first and call `setFirstSend(handoff ? { startLabel: handoff.startLabel ?? 'Starting the chat…' } : null)` before clearing. `seededState` must still read the handoff during the first render.
- Add `firstSend` to the hook's declared return type and return object.

- [ ] **Step 4: Run the useConversation tests to verify they pass**

Run: `export PATH=$HOME/.nvm/versions/node/v24.19.0/bin:$PATH; pnpm exec vitest run tests/unit/use-conversation.spec.ts`

Expected: PASS.

- [ ] **Step 5: Check types**

Run: `export PATH=$HOME/.nvm/versions/node/v24.19.0/bin:$PATH; pnpm typecheck`

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/chat/use-conversation.ts tests/unit/use-conversation.spec.ts
git commit -m "fix: expose first-send handoff from conversation hook"
```

### Task 3: Shrink and dock the composer on first send

**Files:**
- Modify: `src/ui/chat/NewChat.tsx`
- Modify: `tests/component/new-chat-seed.spec.tsx`

**Interfaces:**
- Consumes: `PendingFirst.startLabel` from Task 1; `NEW_SANDBOX` from `@/ui/sandboxes/format`.
- Produces: pending composer root without `data-tall`; `setPendingFirst` carries `Starting a sandbox…` or `Starting the chat…`.

- [ ] **Step 1: Write failing component assertions**

In `describe('New chat first prompt')` in `tests/component/new-chat-seed.spec.tsx`, add before the send:

```ts
expect(input().closest('[data-tall]')).not.toBeNull()
```

and after `const pane = await screen.findByTestId('new-chat-pending')`:

```ts
expect(input().closest('[data-tall]')).toBeNull()
```

In the `it('shows the message and thinking state before the session exists, and restores the composer on failure')` test, after the final `await waitFor(() => expect(input()).toHaveTextContent('hello world'))`, add:

```ts
expect(input().closest('[data-tall]')).not.toBeNull()
```

Add a new test in the environment describe block named `carries the sandbox start label into the new-chat handoff`. Near the other `vi.hoisted` calls at the top of the file add `const pendingFirst = vi.hoisted(() => ({ setPendingFirst: vi.fn() }))` and `vi.mock('@/chat/pending-first', () => ({ setPendingFirst: pendingFirst.setPendingFirst }))`. In `beforeEach`, call `pendingFirst.setPendingFirst.mockReset()`. In the test, choose `Empty sandbox` from the Environment menu as the existing environment test does, resolve `apiMock.createSession` with `{ id: 'sess_created' } as never`, send `hello{Enter}`, then assert `pendingFirst.setPendingFirst` was called with `('sess_created', expect.objectContaining({ text: 'hello', startLabel: 'Starting a sandbox…' }))`.

- [ ] **Step 2: Run the component tests to verify they fail**

Run: `export PATH=$HOME/.nvm/versions/node/v24.19.0/bin:$PATH; pnpm exec vitest run tests/component/new-chat-seed.spec.tsx`

Expected: FAIL because the composer still has `data-tall` after send and `setPendingFirst` has no `startLabel`.

- [ ] **Step 3: Implement the density and handoff changes in `src/ui/chat/NewChat.tsx`**

- Change the `<Composer>` in the shared `composer` element to `density={pending ? 'balanced' : 'spacious'}`.
- In `start`, extend the `setPendingFirst(session.id, ...)` call with `startLabel: environmentId?.startsWith(NEW_SANDBOX) ? 'Starting a sandbox…' : 'Starting the chat…'`.
- Leave the pending `ChatLayout density="spacious"` and failure `setRestore` behavior unchanged.

- [ ] **Step 4: Run the component tests to verify they pass**

Run: `export PATH=$HOME/.nvm/versions/node/v24.19.0/bin:$PATH; pnpm exec vitest run tests/component/new-chat-seed.spec.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/chat/NewChat.tsx tests/component/new-chat-seed.spec.tsx
git commit -m "fix: dock the composer on the first send"
```

### Task 4: Use the helpers in `Conversation`

**Files:**
- Modify: `src/ui/chat/Conversation.tsx`
- Create: `tests/component/chat-start-waiting.spec.tsx`

**Interfaces:**
- Consumes: `firstSend` from Task 2; `hasVisibleOutput`, `shouldWaitForOutput`, `waitingLabel` from Task 1.
- Produces: first-send waiting row with start label until ready, then thinking label; no “Loading conversation…” for a first send.

- [ ] **Step 1: Write a failing component test**

Create `tests/component/chat-start-waiting.spec.tsx` using the same jsdom/DOM helpers and `next/navigation` mock style as `tests/component/reveal.spec.tsx`. Stub `fetch` so:
  - `/items` returns a promise that never resolves (`loading` stays true);
  - `/agents/sessions/<SID>` returns a deferred response, with a resolver variable;
  - `/stream` returns an open `ReadableStream` with no frames;
  - `/turns` and `/subagents` return empty lists.

Before rendering, call `setPendingFirst(SID, { text: 'hello there', startLabel: 'Starting the chat…' })` from `@/chat/pending-first`. Render `<Conversation sessionId={SID} />`. Assert:

```ts
expect(await screen.findByText('Starting the chat…')).toBeInTheDocument()
expect(screen.queryByText('Loading conversation…')).not.toBeInTheDocument()
```

Resolve the deferred session response with `status: 'in_progress'`, then assert:

```ts
await waitFor(() => expect(screen.getByText('Agentry is thinking…')).toBeInTheDocument())
expect(screen.queryByText('Loading conversation…')).not.toBeInTheDocument()
```

- [ ] **Step 2: Run the component test to verify it fails**

Run: `export PATH=$HOME/.nvm/versions/node/v24.19.0/bin:$PATH; pnpm exec vitest run tests/component/chat-start-waiting.spec.tsx`

Expected: FAIL because the conversation labels a first send as “Loading conversation…”.

- [ ] **Step 3: Wire the helpers into `src/ui/chat/Conversation.tsx`**

- Destructure `firstSend` from `useConversation(sessionId)`.
- Import `hasVisibleOutput`, `shouldWaitForOutput` and `waitingLabel` from `@/chat/show-steps` (merge with the existing `readShowSteps` import).
- Replace the local `liveActivity` check with `const visibleOutput = hasVisibleOutput(state.items)`.
- Replace the current `waiting` expression with:

```ts
const waiting = shouldWaitForOutput({
  loading,
  ready,
  status: state.status,
  sent,
  firstSend: firstSend !== null,
  visibleOutput,
  endedInNotice,
  closedReason: closedReason !== null,
  unavailable: Boolean(failure?.unavailable),
})
```

- Change the thinking row to `<Thinking label={waitingLabel(loading, state.status, firstSend, ready)} />`.
- Keep `endedInNotice`, `seenNotices` and `noticesAtSend` unchanged.

- [ ] **Step 4: Run the component test to verify it passes**

Run: `export PATH=$HOME/.nvm/versions/node/v24.19.0/bin:$PATH; pnpm exec vitest run tests/component/chat-start-waiting.spec.tsx`

Expected: PASS.

- [ ] **Step 5: Check types and the full test suite**

Run: `export PATH=$HOME/.nvm/versions/node/v24.19.0/bin:$PATH; pnpm typecheck && pnpm test`

Expected: no type errors; all Vitest tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/ui/chat/Conversation.tsx tests/component/chat-start-waiting.spec.tsx
git commit -m "fix: keep a steady first-send waiting state"
```

### Task 5: Changelog and production verification

**Files:**
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: the four committed tasks above.
- Produces: a dated behavior-change note and a production-build check matching the dev trace.

- [ ] **Step 1: Add the changelog entry**

Add a dated `2026-11-27` bullet under the current section in `CHANGELOG.md` saying that the new-chat composer now shrinks and docks on the first send, and that the first send keeps one waiting label until visible output instead of flashing “Loading conversation…”.

- [ ] **Step 2: Run the unit/component suite and typecheck**

Run: `export PATH=$HOME/.nvm/versions/node/v24.19.0/bin:$PATH; pnpm typecheck && pnpm test`

Expected: no type errors; all tests pass.

- [ ] **Step 3: Build and start the production app against the mock API**

Run in a background shell (stop both servers after the probe):

```bash
export PATH=$HOME/.nvm/versions/node/v24.19.0/bin:$PATH
pnpm build
MOCK_PORT=4020 node mock/agentry-mock.ts &
AGENTRY_WEB_AUTH=apikey \
AGENTRY_API_URL=http://127.0.0.1:4020 \
AGENTRY_WEB_SESSION_SECRET=e2e-session-secret-0123456789abcdef-0123 \
AGENTRY_WEB_MODELS=mock-model,mock-large \
pnpm start -p 3020 &
```

Expected: `pnpm build` completes; both services answer.

- [ ] **Step 4: Run a temporary production Playwright probe**

Using the mock API sign-in helper from `tests/e2e/f1.spec.ts`, open `http://localhost:3020`, send a first message, and sample the DOM. Expected:
  - on `/` before send, the composer root has `data-tall`;
  - immediately after Enter, the composer root has no `data-tall`, while still on `/` or just after `/c/<id>` navigation;
  - the waiting label sequence contains `Starting the chat…` and then `Agentry is thinking…`, and never contains `Loading conversation…`;
  - the waiting row remains until the first assistant text or tool card is rendered.

Delete any temporary probe files afterward.

- [ ] **Step 5: Commit the changelog**

```bash
git add CHANGELOG.md
git commit -m "docs: note the chat start fix"
```
