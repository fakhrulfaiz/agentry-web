# Browser panel: browser-like live view Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Browser tab's basic header/image/list layout with a browser-like toolbar above a fixed-size viewport, keeping the live Chromium stream and take-over behavior unchanged.

**Architecture:** Split `BrowserView.tsx` into small focused pieces: a pure address parser, a toolbar, a fixed viewport that owns the live frame and screenshot, and a collapsed visited-pages disclosure. `BrowserView` composes them and keeps the empty/blocked states and auto-open hook; the existing live/control hooks and input-event shapes stay untouched.

**Tech Stack:** Next.js App Router, React 19, astryx 0.7.17 components and theme tokens, StyleX 0.19.1 for layout glue only, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-27-browser-panel-design.md`

## Global Constraints

- Browser JavaScript, storage and requests never contain an Agentry access token, refresh token or API key; do not change the BFF or live/control/input routes.
- Use astryx components and theme tokens; StyleX only for layout glue; no raw hex/px, `className`, `style`, raw `<div>`/`<span>`, or new font/palette.
- Keep `useBrowserLive`, `useBrowserControl` and the `BrowserInputEvent`/`FrameBox` shapes in `src/chat/browser-input.ts` unchanged.
- Preserve: Esc never sent, hand-back on hide/close/idle, 5-minute idle, reduced-motion frame rate, decoded frame swaps.
- Component tests start with `// @vitest-environment jsdom` and import `tests/helpers/dom`.
- Exact dependency versions unchanged; no new dependencies.
- Commits by `fakhrulfaiz <fakhrulfaiz2003@gmail.com>` with no AI attribution; `CHANGELOG.md` gains a dated bullet.
- Commands need `export PATH=$HOME/.nvm/versions/node/v24.19.0/bin:$PATH` first.

## Review Focus

- Long URL in a narrow panel: address ellipsizes on one line and toolbar buttons stay on that line — Task 2 unit/component assertions plus the narrow-window production screenshot in Task 5.
- Non-web URL (`about:blank`, `data:`): no external link, still readable text — Task 1 unit test and Task 2 component test.
- Letterboxed live frame while in control: pointer at the drawn image's edge maps to the correct page point — Task 3 coordinate test.
- Resize while in control: page size follows the fixed viewport ratio (not the screenshot's ratio) and stays inside the API's 320–1920 width range — Task 3 resize test.
- Control states (on, held, idle-ended) keep the same visible phrases and buttons, but nothing above the viewport changes height — Task 4 component test and the existing `browser-takeover.spec.tsx`; Task 5 screenshot.

---

### Task 1: Address parsing

**Files:**
- Create: `src/ui/preview/browser-address.ts`
- Test: `tests/unit/browser-address.spec.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `export interface BrowserAddress { host: string; rest: string; href: string | null; isSecure: boolean }` and `export function parseAddress(url: string): BrowserAddress`. `href` is the original URL only for `http(s)`, else `null`. `rest` is `pathname` (except `/`) plus search plus hash.

- [ ] **Step 1: Write the failing test**

`tests/unit/browser-address.spec.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { parseAddress } from '@/ui/preview/browser-address'

describe('parseAddress', () => {
  it('splits a secure web URL into host and rest', () => {
    expect(parseAddress('https://example.com/a/b?q=1#top')).toEqual({ host: 'example.com', rest: '/a/b?q=1#top', href: 'https://example.com/a/b?q=1#top', isSecure: true })
  })
  it('keeps a port and marks plain http as not secure', () => {
    expect(parseAddress('http://localhost:3000/')).toEqual({ host: 'localhost:3000', rest: '', href: 'http://localhost:3000/', isSecure: false })
  })
  it('does not link non-web addresses', () => {
    expect(parseAddress('about:blank')).toEqual({ host: 'about:blank', rest: '', href: null, isSecure: false })
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `pnpm exec vitest run tests/unit/browser-address.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `parseAddress`**

Use `new URL(url)` in a `try`; return the non-web shape on failure or when the protocol is not `http:`/`https:`. No other exports.

- [ ] **Step 4: Run the test and verify it passes**

Run: `pnpm exec vitest run tests/unit/browser-address.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/ui/preview/browser-address.ts tests/unit/browser-address.spec.ts
git commit -m "feat: parse browser addresses for the panel toolbar"
```

### Task 2: Browser toolbar

**Files:**
- Create: `src/ui/preview/BrowserToolbar.tsx`
- Test: `tests/component/browser-toolbar.spec.tsx`

**Interfaces:**
- Consumes: `parseAddress` from Task 1; `BrowserControl['status']` from `@/chat/browser-input`.
- Produces:
```ts
export interface BrowserToolbarProps {
  address: BrowserAddress | null
  statusText: string
  isLive: boolean
  running: boolean
  controlStatus: BrowserControl['status']
  onTake: () => void
  onHandBack: () => void
}
export function BrowserToolbar(props: BrowserToolbarProps): JSX.Element
```
The root has `data-testid="browser-toolbar"`. The leading icon wrapper has `data-testid="browser-address-icon"` and `data-secure={address?.isSecure ? 'true' : 'false'}`.

- [ ] **Step 1: Write the failing test**

`tests/component/browser-toolbar.spec.tsx` (jsdom, `tests/helpers/dom`):
- renders `address={parseAddress('https://example.com/a?q=1')}`, `statusText="Live"`, `controlStatus="off"`; asserts `getByTestId('browser-address-icon')` has `data-secure="true"`, the address element contains `example.com` and `/a?q=1` as separate text nodes, and a link with `href="https://example.com/a?q=1"` and `target="_blank"` exists.
- re-renders with a very long host/path (`'https://' + 'long'.repeat(60) + '.com/' + 'x'.repeat(200)`) and asserts exactly one `getAllByTestId('browser-address')` element whose `textContent` equals the host followed by the path.
- renders `parseAddress('about:blank')` and asserts no link in the toolbar and `data-secure="false"`.
- renders `controlStatus="taking"`, `statusText="You have control"` and asserts `getByRole('button', { name: 'Hand back' })` is disabled; with `controlStatus="on"` the same button is enabled and calls `onHandBack`; with `controlStatus="off"` `Take control` calls `onTake`; with `controlStatus="held"` `Take control here` calls `onTake`.
- asserts `running` shows an element with `aria-label="The browser is working"`.

Use `userEvent` for clicks; read icon/link/text props with `pnpm exec astryx component Icon`, `Link`, `Text`, `Button`, `StatusDot`, `Spinner`, `HStack` before writing the component.

- [ ] **Step 2: Run the test and verify it fails**

Run: `pnpm exec vitest run tests/component/browser-toolbar.spec.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `BrowserToolbar`**

One `HStack` row with `gap={2}` and `vAlign="center"`: secure/globe icon, a `StackItem size="fill"` holding host (`Text` primary) and rest (`Text` secondary, `maxLines={1}`), an external `Link` only when `href` is non-null, then `StatusDot`, the `statusText`, an optional `Spinner`, and the control `Button`. When `controlStatus === 'held'`, the button label is `Take control here`; when `on`, `Hand back` (enabled); when `taking`, `Hand back` disabled; otherwise `Take control`. Use `colorVars`/`radiusVars` tokens in `xstyle` only for the address field's outline and ellipsis support; no raw hex/px.

- [ ] **Step 4: Run the test and verify it passes**

Run: `pnpm exec vitest run tests/component/browser-toolbar.spec.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/preview/BrowserToolbar.tsx tests/component/browser-toolbar.spec.tsx
git commit -m "feat: browser-like toolbar for the panel's Browser tab"
```

### Task 3: Fixed viewport

**Files:**
- Create: `src/ui/preview/BrowserViewport.tsx`
- Create: `tests/component/browser-viewport.spec.tsx`
- Modify: `src/ui/preview/BrowserView.tsx` (stop exporting/moving `LiveFrameView`, `frameBox` and `PAGE_WIDTH` into the new file; `BrowserTab` will use the new component in Task 4)

**Interfaces:**
- Consumes: `LiveFrame` from `@/chat/use-browser-live`, `BrowserInputEvent`/`FrameBox` from `@/chat/browser-input`, `artifactUrl` from `@/artifacts/kind`, `fileContentPath` from `@/chat/attachments`.
- Produces:
```ts
export interface BrowserViewportProps {
  frame: LiveFrame | null
  screenshotUrl: string | null
  inControl: boolean
  send: (event: BrowserInputEvent) => void
}
export function BrowserViewport(props: BrowserViewportProps): JSX.Element
```
Root has `data-testid="browser-viewport"`; the image keeps `data-testid="browser-frame"` and `role="application"` while in control.

- [ ] **Step 1: Write the failing test**

`tests/component/browser-viewport.spec.tsx` (jsdom, `tests/helpers/dom`, `@testing-library/jest-dom/vitest`). Use a live frame `{ src: 'data:image/jpeg;base64,AAA', url: 'https://e.com/', title: 'E', width: 1280, height: 800 }` and `send = vi.fn()`:
- renders live frame and screenshot fallback separately; asserts `within(getByTestId('browser-viewport')).getByTestId('browser-frame')` in both cases (`screenshotUrl` supplies the `src` when `frame` is null) and that the image's `data-fit` attribute is `contain`.
- with `inControl`, sets `getBoundingClientRect` on the image to `{ left: 100, top: 50, width: 640, height: 400, ... }`, fires `pointerDown` at `(420, 250)` with `button: 0, buttons: 1, detail: 1`, and asserts `send` was called with `{ type: 'mouse', action: 'down', x: 640, y: 400, button: 'left', buttons: 1, click_count: 1 }` (letterboxing removed by `toPagePoint`).
- with `inControl` and that same rect, asserts `send` receives `{ type: 'resize', width: 640, height: 400 }`; then re-renders with a 16:10 rect of width 2000 and height 1250 and asserts the resize is `{ type: 'resize', width: 1920, height: 1200 }`.
- asserts `keyDown` with `Escape` does not call `send` and blurs the image; `keyDown` with `'h'` sends `{ type: 'key', action: 'down', key: 'h', code: 'KeyH', key_code: 72, text: 'h' }`.

- [ ] **Step 2: Run the test and verify it fails**

Run: `pnpm exec vitest run tests/component/browser-viewport.spec.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `BrowserViewport`**

Move the existing `LiveFrameView` body into this file. Wrap the image in an astryx `Center` with `xstyle` pinning `aspectRatio: '16 / 10'`, `inlineSize: '100%'`, `overflow: 'hidden'`, `backgroundColor: colorVars['--color-background-muted']`, `borderColor`/`borderWidth` from `--color-border`, and `borderRadius: radiusVars['--radius-container']`. The image uses `inlineSize: '100%'`, `blockSize: '100%'`, `objectFit: 'contain'` and `data-fit="contain"` (test seam). Keep all existing pointer/wheel/key/paste handlers. Change `fit()` to read `img.getBoundingClientRect()` and send `{ type: 'resize', width: clamp(rect.width, 320, 1920), height: Math.round(width * rect.height / rect.width) }` when the width differs by at least 8 from the last sent width. `frameBox` still returns the image's rect and page dimensions from the frame.

- [ ] **Step 4: Run the test and verify it passes**

Run: `pnpm exec vitest run tests/component/browser-viewport.spec.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/preview/BrowserViewport.tsx tests/component/browser-viewport.spec.tsx src/ui/preview/BrowserView.tsx
git commit -m "feat: fixed browser viewport with contained live frames"
```

### Task 4: Compose the panel and collapse history

**Files:**
- Create: `src/ui/preview/BrowserHistory.tsx`
- Create: `tests/component/browser-panel.spec.tsx`
- Modify: `src/ui/preview/BrowserView.tsx` (compose toolbar, viewport and history; remove old header/banners/visited list)
- Modify: `tests/component/browser-takeover.spec.tsx` (only if a text assertion needs the new location; do not weaken input assertions)

**Interfaces:**
- Consumes: `BrowserToolbar` (Task 2), `BrowserViewport` (Task 3), `parseAddress` (Task 1), `BrowserState` from `@/chat/browser-tools`, `ControlEndReason` from `@/chat/browser-input`.
- Produces:
```ts
export interface BrowserHistoryProps {
  pages: Array<{ url: string; title?: string }>
}
export function BrowserHistory(props: BrowserHistoryProps): JSX.Element
```
`BrowserView.tsx` keeps exporting `BROWSER_VIEW`, `BROWSER_TITLE`, `CANNOT_BROWSE`, `BrowserTab` and `BrowserAutoOpen`.

- [ ] **Step 1: Write the failing test**

`tests/component/browser-panel.spec.tsx` (jsdom, `tests/helpers/dom`). Reuse the `FakeSource` EventSource stub and `PanelConversationContext` setup pattern from `tests/component/browser-takeover.spec.tsx`; set `browser: { ...EMPTY_BROWSER, calls: 1, visited: [{ url: 'https://a.com/1', title: 'A' }, { url: 'https://b.com/2' }] }`:
- emits a frame with `url: 'https://e.com/path?q=1'`, `title: 'E', width: 1280, height: 800`; asserts `getByTestId('browser-toolbar')` contains `e.com` and `/path?q=1`, `getByTestId('browser-viewport')` contains `getByTestId('browser-frame')`, and the status text is `Live`.
- emits a second frame with different natural dimensions (`width: 800, height: 500`); asserts the same `browser-viewport` element is still present and `browser-frame` `src` changed, then emits a frame with `url: 'https://other.com/'` and asserts the toolbar's `href` changed.
- asserts `getByText('Pages visited (2)')` is present, the links are absent before clicking it, and after clicking, links to `https://a.com/1` and `https://b.com/2` appear.
- with `control.status === 'on'` (click `Take control`), asserts `getByText('You have control')` is inside `getByTestId('browser-tab')` but after `getByTestId('browser-viewport')` in DOM order, and no astryx `Banner` is above the viewport.
- with an idle frame reason `no_browser` and `browser.calls === 1`, asserts the blocked explanation is below the viewport, not above it.

- [ ] **Step 2: Run the test and verify it fails**

Run: `pnpm exec vitest run tests/component/browser-panel.spec.tsx tests/component/browser-takeover.spec.tsx`
Expected: FAIL — `browser-toolbar` / `browser-viewport` selectors absent.

- [ ] **Step 3: Implement `BrowserHistory` and recompose `BrowserView`**

`BrowserHistory` uses astryx `Collapsible` with `defaultIsOpen={false}` and a trigger `Text` of `Pages visited (N)`; children are an ordered list of `Link`s (or `Text` for non-web) using `parseAddress`. In `BrowserTab`, keep the empty/blocked `EmptyState` early returns; otherwise render a `VStack gap={3}` containing `BrowserToolbar`, `BrowserViewport`, then supporting `Text` lines for control errors/`ENDED` and the watching hint, then `BrowserHistory` when `visited.length > 0`. `statusText` is `You have control` (on), `You have control in another tab` (held), `Live` (live), else `Not browsing`; `isLive` is `live.status === 'live'`. `current` still prefers `live.frame` title/url over `browser.current`. Keep `CANNOT_BROWSE`, `ENDED` wording and `BrowserAutoOpen` unchanged. Read `pnpm exec astryx component Collapsible` before use.

- [ ] **Step 4: Run the tests and verify they pass**

Run: `pnpm exec vitest run tests/component/browser-panel.spec.tsx tests/component/browser-takeover.spec.tsx`
Expected: PASS, with all existing takeover assertions intact.

- [ ] **Step 5: Document and commit**

Add one dated bullet to `CHANGELOG.md` describing the browser toolbar, fixed viewport and collapsed history. Then:
```bash
git add src/ui/preview/BrowserHistory.tsx src/ui/preview/BrowserView.tsx tests/component/browser-panel.spec.tsx tests/component/browser-takeover.spec.tsx CHANGELOG.md
git commit -m "feat: browser-like panel toolbar, fixed page and collapsed history"
```

### Task 5: Verification and production visual check

**Files:**
- Modify: none expected (only test/probe artifacts, deleted after the check)

**Interfaces:**
- Consumes: all tasks above.

- [ ] **Step 1: Run static and unit checks**

Run: `pnpm typecheck && pnpm test`
Expected: typecheck clean; full Vitest suite green (no skipped files).

- [ ] **Step 2: Run the astryx self-check**

Run: `pnpm exec astryx doctor --built src/ui/preview`
Expected: no failures. Fix any reported component/style violations in the owning task and re-run that task's tests.

- [ ] **Step 3: Production screenshot check**

Build with `pnpm build`, start the mock API and `pnpm start`, open a chat with browser frames at a narrow panel width (about 400 px), and screenshot two different frames with different natural sizes plus a taken-control state. Confirm: the toolbar stays one row with the full URL ellipsized, the viewport outer box does not move or change height between frames/states, and control/history text sits below it. Delete the temporary probe and stop both servers.

- [ ] **Step 4: Whole-branch review**

Have a fresh reviewer check the complete range against the spec, especially the five Review Focus items. Fix any Critical/Important finding with a RED→GREEN test before declaring done.
