# Browser take-over: IME and touch input Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Composed text and one-finger touch pan/scroll work while the user controls the agent's browser in the web app, without changing the API.

**Architecture:** Pure helpers in `src/chat/browser-input.ts` map composition end to one `text` event and a touch drag to the existing `wheel` event, in page CSS pixels. `BrowserViewport.tsx` tracks composition and touch state and feeds those helpers while leaving mouse, pen, keyboard and paste paths unchanged.

**Tech Stack:** Next.js App Router, React, TypeScript, Vitest (`tests/unit` node, `tests/component` jsdom), astryx + StyleX.

**Spec:** `docs/superpowers/specs/2026-11-28-browser-input-ime-touch-design.md`

## Global Constraints

- All commands: `export PATH=$HOME/.nvm/versions/node/v24.19.0/bin:$PATH` first (Node 24, pnpm 11).
- Browser code never holds Agentry credentials; no new routes; input goes through the existing `POST .../browser/input` events.
- Input event shapes stay exactly as typed in `BrowserInputEvent` (`key`, `text`, `wheel`, `mouse`, `resize`); page coordinates are CSS pixels with 2-decimal rounding.
- astryx components and tokens for UI; StyleX only for layout glue; no raw hex/px or new dependencies.
- Tests: `pnpm typecheck`, `pnpm vitest run <files>`; no file outside the task's Files list may be changed.
- Every shell step ends with a commit as `fakhrulfaiz <fakhrulfaiz2003@gmail.com>`; no Co-Authored-By or AI attribution. Stage only the files named in the task — the tree contains other sessions' uncommitted work.

## Review Focus

- Composition cancelled (`compositionend` with empty `data`) must not send an empty text event and must not leave later keystrokes suppressed — Task 2 tests this.
- A touch drag must scroll the page and must not also send mouse moves or a click at drag end — Task 2 tests this.
- Tap, mouse and pen pointers must behave exactly as before — Task 2 tests touch tap and mouse move; Task 1 pins the unchanged `keyEvent` and `mouseEvent` outputs.
- Touch points in the letterboxed area outside the drawn frame must not produce wheel events — Task 1 tests this.
- Blur or loss of control mid-composition must reset the flag so the next typed key is not swallowed — Task 2 tests blur.

---

### Task 1: Pure composition and touch input helpers

**Files:**
- Modify: `src/chat/browser-input.ts:70-112` (near `keyEvent` and `coalesce`)
- Test: `tests/unit/browser-input.spec.ts`
- Commit with the new spec and this plan: `docs/superpowers/specs/2026-11-28-browser-input-ime-touch-design.md`, `docs/superpowers/plans/2026-11-28-browser-input-ime-touch.md`

**Interfaces:**
- Consumes: `FrameBox`, `toPagePoint`, `BrowserInputEvent` from `src/chat/browser-input.ts`.
- Produces:
  - `keyEvent(e: { key: string; code: string; keyCode: number; altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }, action: 'down' | 'up', composing?: boolean): BrowserInputEvent` — existing behaviour plus `text` omitted when `composing` is true; default false.
  - `composedTextEvent(data: string): { type: 'text'; text: string } | undefined` — empty string gives `undefined`; otherwise the string sliced to 2000 characters.
  - `wheelFromTouch(from: { clientX: number; clientY: number }, to: { clientX: number; clientY: number }, box: FrameBox): BrowserInputEvent | undefined` — a `wheel` event at `to`'s page point, with `delta_x = from.x - to.x` and `delta_y = from.y - to.y` (page px, 2 decimals), or `undefined` if either point is outside the drawn frame.

- [ ] **Step 1: Write the failing tests** in `tests/unit/browser-input.spec.ts`, importing `composedTextEvent` and `wheelFromTouch` alongside the existing imports:

```ts
it('omits typed text from keys pressed during IME composition', () => {
  expect(keyEvent({ key: 'か', code: 'KeyK', keyCode: 75, ...noMods }, 'down', true)).toEqual({ type: 'key', action: 'down', key: 'か', code: 'KeyK', key_code: 75 })
  expect(keyEvent({ key: 'a', code: 'KeyA', keyCode: 65, ...noMods }, 'down')).toHaveProperty('text', 'a')
})

it('turns committed composition data into one capped text event', () => {
  expect(composedTextEvent('日')).toEqual({ type: 'text', text: '日' })
  expect(composedTextEvent('')).toBeUndefined()
  expect(composedTextEvent('x'.repeat(2100))).toEqual({ type: 'text', text: 'x'.repeat(2000) })
})

it('maps a touch drag to wheel deltas in page pixels and drops points outside the frame', () => {
  expect(wheelFromTouch({ clientX: 420, clientY: 230 }, { clientX: 320, clientY: 180 }, box)).toEqual({ type: 'wheel', x: 440, y: 260, delta_x: 200, delta_y: 100 })
  expect(wheelFromTouch({ clientX: 0, clientY: 230 }, { clientX: 320, clientY: 180 }, box)).toBeUndefined()
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `export PATH=$HOME/.nvm/versions/node/v24.19.0/bin:$PATH && pnpm vitest run tests/unit/browser-input.spec.ts`
Expected: FAIL — `composedTextEvent` and `wheelFromTouch` are not exported, and the 3-argument `keyEvent` assertion fails.

- [ ] **Step 3: Implement the helpers** in `src/chat/browser-input.ts`

Give `keyEvent` the third parameter `composing = false` and make its `text` conditional on it (key identity, code, key_code and modifiers are unchanged). Implement `composedTextEvent` and `wheelFromTouch` to the Interfaces contract; use `toPagePoint` for both touch points and round deltas to 2 decimals. Do not change `coalesce`, `mouseEvent`, or the existing conversions.

- [ ] **Step 4: Run the unit suite to verify it passes**

Run: `export PATH=$HOME/.nvm/versions/node/v24.19.0/bin:$PATH && pnpm vitest run tests/unit/browser-input.spec.ts`
Expected: PASS, including the earlier `keyEvent`, `mouseEvent` and `coalesce` tests.

- [ ] **Step 5: Commit**

```bash
git add src/chat/browser-input.ts tests/unit/browser-input.spec.ts docs/superpowers/specs/2026-11-28-browser-input-ime-touch-design.md docs/superpowers/plans/2026-11-28-browser-input-ime-touch.md
git commit -m "feat(browser): composition and touch input helpers"
```

---

### Task 2: Wire composition and touch into the viewport

**Files:**
- Modify: `src/ui/preview/BrowserViewport.tsx:80-168` (the control effect and the controlled image props)
- Test: `tests/component/browser-viewport.spec.tsx`
- Modify: `CHANGELOG.md` (top of `## Unreleased`)

**Interfaces:**
- Consumes: `keyEvent(..., composing)`, `composedTextEvent`, `wheelFromTouch`, `mouseEvent`, `BrowserInputEvent` from Task 1; existing `BrowserViewportProps`.
- Produces: no new exported symbols; the viewport sends the existing event shapes.

- [ ] **Step 1: Write the failing component tests** in `tests/component/browser-viewport.spec.tsx`, using the existing `base`/`frame` fixtures and `fireEvent`:

```tsx
it('sends the committed IME string once and does not type the composition keystrokes', () => {
  const send = vi.fn<(event: BrowserInputEvent) => void>()
  render(<BrowserViewport {...base} inControl send={send} />)
  const img = screen.getByTestId('browser-frame')
  fireEvent.compositionStart(img, { data: 'に' })
  fireEvent.keyDown(img, { key: 'Process', code: 'Process', keyCode: 229 })
  fireEvent.compositionEnd(img, { data: '日' })
  expect(send).toHaveBeenCalledWith({ type: 'text', text: '日' })
  expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'key', text: expect.anything() }))
  send.mockClear()
  fireEvent.keyDown(img, { key: 'a', code: 'KeyA', keyCode: 65 })
  expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: 'key', text: 'a' }))
})

it('does not send text for a cancelled composition', () => {
  const send = vi.fn<(event: BrowserInputEvent) => void>()
  render(<BrowserViewport {...base} inControl send={send} />)
  const img = screen.getByTestId('browser-frame')
  fireEvent.compositionStart(img, { data: 'に' })
  fireEvent.compositionEnd(img, { data: '' })
  expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'text' }))
  fireEvent.keyDown(img, { key: 'a', code: 'KeyA', keyCode: 65 })
  expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: 'key', text: 'a' }))
})

it('stops suppressing typed text when the frame loses focus mid-composition', () => {
  const send = vi.fn<(event: BrowserInputEvent) => void>()
  render(<BrowserViewport {...base} inControl send={send} />)
  const img = screen.getByTestId('browser-frame')
  fireEvent.compositionStart(img, { data: 'に' })
  fireEvent.blur(img)
  fireEvent.keyDown(img, { key: 'a', code: 'KeyA', keyCode: 65 })
  expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: 'key', text: 'a' }))
})

it('scrolls the page on a touch drag without sending mouse moves or a click', () => {
  const send = vi.fn<(event: BrowserInputEvent) => void>()
  render(<BrowserViewport {...base} inControl send={send} />)
  const img = screen.getByTestId('browser-frame')
  rect(640, 400)(img)
  fireEvent.pointerDown(img, { pointerType: 'touch', clientX: 420, clientY: 250, button: 0, buttons: 1, detail: 1 })
  fireEvent.pointerMove(img, { pointerType: 'touch', clientX: 320, clientY: 200, button: 0, buttons: 1, detail: 0 })
  fireEvent.pointerUp(img, { pointerType: 'touch', clientX: 320, clientY: 200, button: 0, buttons: 0, detail: 1 })
  expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: 'mouse', action: 'down' }))
  expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: 'wheel', delta_y: expect.any(Number) }))
  expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: 'mouse', action: 'up', click_count: 0 }))
  expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'mouse', action: 'move' }))
})

it('keeps a touch tap as a click and a mouse pointer unchanged', () => {
  const send = vi.fn<(event: BrowserInputEvent) => void>()
  render(<BrowserViewport {...base} inControl send={send} />)
  const img = screen.getByTestId('browser-frame')
  rect(640, 400)(img)
  fireEvent.pointerDown(img, { pointerType: 'touch', clientX: 420, clientY: 250, button: 0, buttons: 1, detail: 1 })
  fireEvent.pointerUp(img, { pointerType: 'touch', clientX: 420, clientY: 250, button: 0, buttons: 0, detail: 1 })
  expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: 'mouse', action: 'up', click_count: 1 }))
  send.mockClear()
  fireEvent.pointerMove(img, { pointerType: 'mouse', clientX: 420, clientY: 250, button: 0, buttons: 0, detail: 0 })
  expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: 'mouse', action: 'move' }))
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `export PATH=$HOME/.nvm/versions/node/v24.19.0/bin:$PATH && pnpm vitest run tests/component/browser-viewport.spec.tsx`
Expected: FAIL — composition events are not handled, touch moves are sent as mouse moves, and touch-up keeps `click_count: 1`.

- [ ] **Step 3: Implement the viewport wiring** in `src/ui/preview/BrowserViewport.tsx`

Keep refs `composing = useRef(false)` and `touchFrom = useRef<{ clientX: number; clientY: number } | null>(null)`. In the control effect, add a `blur` listener on the image that clears both refs, remove it in cleanup, and clear both refs when control ends. Pass `composing.current` as `keyEvent`'s third argument. Add `onCompositionStart` and `onCompositionUpdate` (set composing true) and `onCompositionEnd` (clear it, then send the result of `composedTextEvent(e.data)` when it is defined) to the controlled image props. In `pointer(action)`: for `pointerType === 'touch'`, down records the start point and sends the normal mouse down; move sends `wheelFromTouch(touchFrom.current, e, frameBox(...))` when a start exists, updates the start, and sends no mouse move; up clears the start and sends the normal mouse up for a tap (page-point distance from the start at most 8 px) but a mouse up with `click_count: 0` after a drag. Add `onPointerCancel` to clear the touch state. Mouse and pen keep the current path.

- [ ] **Step 4: Run the focused suites to verify they pass**

Run: `export PATH=$HOME/.nvm/versions/node/v24.19.0/bin:$PATH && pnpm vitest run tests/unit/browser-input.spec.ts tests/component/browser-viewport.spec.tsx tests/component/browser-takeover.spec.tsx`
Expected: PASS, including the existing takeover, resize and Escape tests.

- [ ] **Step 5: Add the CHANGELOG bullet** at the top of `## Unreleased` in `CHANGELOG.md`, dated `2026-11-28`: while you control the agent's browser, composed text is typed once when the candidate is committed (instead of the intermediate keystrokes), and a one-finger drag scrolls the page while a tap still clicks.

- [ ] **Step 6: Typecheck and commit**

Run: `export PATH=$HOME/.nvm/versions/node/v24.19.0/bin:$PATH && pnpm typecheck`
Expected: PASS.

```bash
git add src/ui/preview/BrowserViewport.tsx tests/component/browser-viewport.spec.tsx CHANGELOG.md
git commit -m "feat(browser): IME and touch input while in control"
```
