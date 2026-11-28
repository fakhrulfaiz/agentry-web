# F3 Remainder: Live File Tree + XLSX Sheet View

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the preview panel's file tree update while the agent works, and let spreadsheets be read as a sheet/grid in the panel.

**Architecture:** The API adds an owner-scoped SSE watch route over the session workspace. Sandbox workspaces watch through envd `filesystem.watchDir`; local workspaces watch through Node `fs.watch`. A small `WatchHub` shares one upstream watch per session, debounces changes, and emits `changed`/`reset`/`closed`. The web adds a BFF SSE route and a `useFileWatch` hook that refreshes the tree and reloads the active file on change. For xlsx, the web adds a lazy-loaded read-only `SheetView` renderer that fetches workbook bytes through the existing artifact BFF route and parses them with `exceljs`.

**Tech Stack:** TypeScript, Node http, Connect/envd filesystem watchDir, Next.js App Router route handlers, React, Vitest, @astryxdesign/core, @stylexjs/stylex, exceljs (browser, lazy-loaded).

**Spec:** `docs/superpowers/specs/2026-11-28-f3-remainder-design.md`

**Repos/checks:**
- Web: `~/code/agentry-web` (shell prefix `export PATH=$HOME/.nvm/versions/node/v24.19.0/bin:$PATH`). Checks: `pnpm typecheck && pnpm vitest run --no-file-parallelism`. Full suite may be heavy; prefer targeted tests while iterating, run broader checks before finishing.
- API: `~/home/mffaiz/code/dsh-agents-api` (same PATH prefix; `export DSH_ROOT=/home/mffaiz/code/dsh-pinned` if DSH packages are needed). Checks: `pnpm typecheck && pnpm vitest run`.

## Global constraints

- Do not touch unrelated dirty files. Current web dirty files include AGENTS.md, docs/superpowers plans/specs unrelated to this feature, sandbox/subagent UI/tests, and src/agents/from-subagent.*. Only modify files listed in tasks plus CHANGELOG/AGENTS updates required by this feature.
- No Co-Authored-By or AI attribution in commits.
- Browser/BFF never receive Agentry credentials. Watch BFF route mirrors the existing stream route: server-only, auth required, no-store SSE.
- Proxy allow-list only: adding the web watch BFF path requires no new upstream allowlist entry beyond the existing session/artifacts access pattern? The BFF calls upstream `/agents/sessions/{id}/artifacts/watch`; web allowlist currently allows `GET /agents/sessions/:id/artifacts` but not `/artifacts/watch` as a separate listed path. The catch-all artifact content route already handles file bytes by explicit segment validation, but watch is a different upstream endpoint - add an explicit allowlist entry or handle it in a dedicated BFF route that validates ID and calls the upstream path directly (like stream route). Prefer dedicated BFF route using `agentryUrl` + `requireCredential`, same as stream route; do **not** expose raw upstream errors.
- StyleX/astryx rules: no raw hex/px in new component styling except where existing preview renderer patterns already use inline style objects for content layout (CodeBlock/pre/table wrappers follow existing pattern); use astryx components/tokens for controls.
- Exact dependency versions. `exceljs` must be added as exact version, no `^`.
- TDD: write failing test, run it, implement, run it, commit.

## Review focus

- Watch route is owner-scoped and does not leak watchers/timers on disconnect.
- Next static `watch` segment is not swallowed by `artifacts/[...path]`.
- WatchHub debounce/reset/429 behavior matches spec; no event-loop leaks.
- Sandbox watch uses envd `watchDir` recursive and skips ignored dirs where practical; local watch uses `fs.watch`.
- XLSX renderer is lazy-loaded, read-only, capped (2000 rows/50 cols), handles parse errors, and keeps download fallback.
- No regressions to existing file/office/pdf/video preview behavior.

---

## Task 1: API watch hub

**Files:**
- Create: `dsh-agents-api/src/files/watch.ts`
- Test: `dsh-agents-api/tests/files-watch.spec.ts`

- [ ] **Step 1: Write failing tests**

Create `dsh-agents-api/tests/files-watch.spec.ts` with fake timers and a fake async source. Cover:
- two rapid change batches within 500 ms merge into one `changed` event with deduped paths
- a batch with >200 paths emits `reset`
- after the last subscriber unsubscribes, source aborts after 30 s idle
- subscribing a 9th session for same owner rejects with `too_many_watches` (or the chosen error shape)
- `closed` is emitted when source ends

Use a small fake source:

```ts
function makeSource(batches: string[][], opts?: { end?: boolean }) {
  return (signal: AbortSignal): AsyncIterable<string[]> => ({
    async *[Symbol.asyncIterator]() {
      for (const b of batches) {
        if (signal.aborted) return
        yield b
      }
      if (opts?.end) return
      await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }))
    },
  })
}
```

Test `WatchHub` directly (no HTTP): `subscribe(owner, sessionId, source, onEvent)` returns unsubscribe.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/mffaiz/code/dsh-agents-api && export PATH=$HOME/.nvm/versions/node/v24.19.0/bin:$PATH && pnpm vitest run tests/files-watch.spec.ts`
Expected: FAIL because `src/files/watch.ts` does not exist / exports missing.

- [ ] **Step 3: Write minimal implementation**

Create `src/files/watch.ts`:

```ts
export type WatchEvent =
  | { type: 'changed'; paths: string[] }
  | { type: 'reset' }
  | { type: 'closed' }

export class WatchLimitError extends Error {
  readonly status = 429
  readonly code = 'too_many_watches'
  constructor() { super('Too many watched sessions'); this.name = 'WatchLimitError' }
}

export class WatchHub {
  private sessions = new Map<string, SessionWatch>()
  private byOwner = new Map<string, Set<string>>()
  constructor(private readonly idleMs = 30_000, private readonly debounceMs = 500, private readonly maxPaths = 200, private readonly maxPerOwner = 8) {}

  subscribe(owner: string, sessionId: string, source: (signal: AbortSignal) => AsyncIterable<string[]>, onEvent: (event: WatchEvent) => void): () => void { /* ... */ }
}
```

Behavior details:
- key by sessionId (session is owner-scoped at route level; owner limit tracked separately)
- one upstream source per session; multiple subscribers share it
- debounce path batches for `debounceMs`; dedupe paths; if deduped size > `maxPaths` emit `reset` and clear pending
- on source normal end emit `closed` and clean up
- on source throw/abort from hub cleanup, no throw to subscribers
- last subscriber removed starts idle timer; new subscriber before timer cancels it
- max watched sessions per owner: count sessions with active source/subscribers; reject when exceeded

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/mffaiz/code/dsh-agents-api && export PATH=$HOME/.nvm/versions/node/v24.19.0/bin:$PATH && pnpm vitest run tests/files-watch.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /home/mffaiz/code/dsh-agents-api
git add src/files/watch.ts tests/files-watch.spec.ts
git commit -m "feat(api): add workspace watch hub"
```

## Task 2: Sandbox and local watch sources

**Files:**
- Modify: `dsh-agents-api/src/sandbox/agentry-sandbox-provider.ts`
- Modify: `dsh-agents-api/src/environment/local.ts` (or create helper near it; prefer adding `watchWorkspace` helper file `dsh-agents-api/src/files/local-watch.ts` to keep local.ts focused)
- Create: `dsh-agents-api/src/files/local-watch.ts`
- Modify: `dsh-agents-api/src/sandbox/contract.ts`? No, do not widen SandboxProvider contract unless needed; gateway can detect capability by checking a new optional method on the concrete provider or by adding `watch?` to SandboxProvider. Prefer adding optional `watch?` on `AgentrySandboxProvider` interface only first; gateway can special-case `agentry-sandbox` provider or accept any provider with `watch`.
- Test: `dsh-agents-api/tests/files-watch-source.spec.ts`

- [ ] **Step 1: Write failing tests**

Add tests for local watch source helper with a temp dir: creating/updating/removing a file yields batches containing relative paths; ignored dirs like `.git`/`node_modules` are filtered; abort stops watcher.

For sandbox source, unit-test path normalization/filtering by extracting a small pure helper (e.g. `normalizeWatchPaths(root, names)`) rather than mocking Connect stream deeply.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/files-watch-source.spec.ts`

- [ ] **Step 3: Implement**

In `agentry-sandbox-provider.ts`, add to interface and implementation:

```ts
watch(record: EnvironmentRecord, signal: AbortSignal): AsyncIterable<string[]>
```

Implementation:
- `const { id, dir } = meta(record)`; `const envd = api(ownerOf(record)).envd(id)`
- call `envd.filesystem.watchDir({ path: dir, recursive: true }, { headers: envd.userHeaders(AGENT), signal })` as async iterable
- for each response event: if `event.case === 'filesystem'`, take `event.value.name`; normalize to workspace-relative POSIX path under `dir`; ignore if outside or in `SKIP_DIRS` segments; yield `[rel]` (WatchHub debounces/batches)
- ignore `start` and `keepalive`

If connect-node stream does not accept `signal` in options in this version, wrap with an abort-aware async iterator that stops consuming on abort.

Create `src/files/local-watch.ts`:

```ts
import { watch } from 'node:fs/promises'
import path from 'node:path'

const SKIP = new Set(['.git', 'node_modules', '__pycache__', '.next', 'dist', 'build'])
export async function* watchLocalDir(dir: string, signal: AbortSignal): AsyncIterable<string[]> {
  const watcher = watch(dir, { recursive: true, signal })
  for await (const event of watcher) {
    const name = event.filename?.toString()
    if (!name) continue
    const rel = name.split(path.sep).join('/')
    if (rel.split('/').some((seg) => SKIP.has(seg))) continue
    yield [rel]
  }
}
```

(Handle abort/error gracefully.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/files-watch-source.spec.ts tests/files-watch.spec.ts`

- [ ] **Step 5: Commit**

```bash
git add src/files/local-watch.ts src/sandbox/agentry-sandbox-provider.ts tests/files-watch-source.spec.ts
git commit -m "feat(api): add sandbox and local workspace watch sources"
```

## Task 3: API watch SSE route

**Files:**
- Modify: `dsh-agents-api/src/gateway.ts`
- Modify: `dsh-agents-api/openapi/agentry.yaml`
- Modify: `dsh-agents-api/CHANGELOG.md`
- Create: `dsh-agents-api/docs/changes/2026-11-28-workspace-watch.md`
- Test: `dsh-agents-api/tests/files-watch-route.spec.ts` (or add to existing gateway/files test pattern)

- [ ] **Step 1: Write failing route tests**

Test with the API's existing HTTP test harness/fakes:
- owner can open `GET /agents/sessions/{id}/artifacts/watch` and receives SSE `content-type: text/event-stream`
- receives `changed` event when source emits paths
- receives `reset` event for large batch
- another owner gets 404
- missing session gets 404
- 9th concurrent watch for same owner gets 429 `too_many_watches`

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/files-watch-route.spec.ts`

- [ ] **Step 3: Implement**

In `gateway.ts`:
- import `WatchHub`, `WatchLimitError` from `./files/watch.ts`
- import `watchLocalDir` from `./files/local-watch.ts`
- add `private readonly watchHub = new WatchHub()`
- register route **before** `artifacts/*path`:

```ts
{ method: 'GET', pattern: '/agents/sessions/:session_id/artifacts/watch', handler: (req, res, _url, params, p) => this.streamArtifactWatch(req, res, params, p.owner) },
```

Implement `streamArtifactWatch`:
- require session owner; 404 if missing.
- determine source:
  - sandbox session with agentry-sandbox provider and record: `signal => provider.watch(record, signal)`
  - local/non-sandbox workspace dir: `signal => watchLocalDir(cwd, signal)` where cwd is session workspace directory resolved by existing session/artifact helpers. If no watchable workspace, return 404 or empty closed? Prefer 404 `workspace_not_watchable`.
- `writeSSEHeaders(res)`; send initial ping? not needed.
- subscribe to hub; on event write `event: changed/reset/closed`.
- send `: ping\n\n` every 15s.
- on req close, clear interval and unsubscribe.

OpenAPI: add path `/agents/sessions/{session_id}/artifacts/watch` with GET, SSE response, 404/429 errors. Keep schema simple (`changed` data has `paths: string[]`).

Docs: create `docs/changes/2026-11-28-workspace-watch.md`; update CHANGELOG and docs README route table if present.

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run tests/files-watch.spec.ts tests/files-watch-source.spec.ts tests/files-watch-route.spec.ts`
Then: `pnpm typecheck`

- [ ] **Step 5: Commit**

```bash
git add src/files/watch.ts src/files/local-watch.ts src/sandbox/agentry-sandbox-provider.ts src/gateway.ts openapi/agentry.yaml CHANGELOG.md docs/changes/2026-11-28-workspace-watch.md tests/files-watch.spec.ts tests/files-watch-source.spec.ts tests/files-watch-route.spec.ts
git commit -m "feat(api): stream workspace artifact watch events"
```

## Task 4: Web watch BFF route and hook

**Files:**
- Create: `agentry-web/app/api/agentry/agents/sessions/[id]/artifacts/watch/route.ts`
- Create: `agentry-web/src/preview/use-file-watch.ts`
- Test: `agentry-web/tests/unit/use-file-watch.spec.ts`
- Modify: `agentry-web/CHANGELOG.md`

- [ ] **Step 1: Write failing hook tests**

Create `tests/unit/use-file-watch.spec.ts` with a fake `EventSource` installed on `globalThis`. Test:
- when enabled, opens `/api/agentry/agents/sessions/${id}/artifacts/watch`
- `changed` event calls `onChange(paths)`
- `reset` event calls `onChange('reset')`
- error schedules reconnect with 1s then 2s backoff (fake timers)
- `closed` event closes and does not reconnect until enabled toggles off/on
- disabled/unmount closes source

Use `@testing-library/react` `renderHook` or a tiny harness; keep it unit-level.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/mffaiz/code/agentry-web && export PATH=$HOME/.nvm/versions/node/v24.19.0/bin:$PATH && pnpm vitest run tests/unit/use-file-watch.spec.ts`

- [ ] **Step 3: Implement BFF route**

`app/api/agentry/agents/sessions/[id]/artifacts/watch/route.ts`:

```ts
import { agentryHeaders, agentryUrl, jsonError } from '@/server/agentry'
import { ID_SEGMENT } from '@/server/allowlist'
import { authFailure, requireCredential } from '@/server/require-auth'
import { relay, signedOut } from '@/server/upstream'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params
  if (!ID_SEGMENT.test(id)) return jsonError(404, 'not_found')
  let auth: Awaited<ReturnType<typeof requireCredential>>
  try { auth = await requireCredential() } catch (error) { return authFailure(error) }
  let upstream: Response
  try {
    upstream = await fetch(agentryUrl(`/agents/sessions/${id}/artifacts/watch`), {
      headers: agentryHeaders(auth.authorization, { accept: 'text/event-stream' }),
      signal: req.signal,
      cache: 'no-store',
    })
  } catch (error) {
    if (req.signal.aborted) throw error
    return jsonError(502, 'upstream_unavailable')
  }
  if (upstream.status === 401) { await upstream.body?.cancel(); return signedOut(auth.session) }
  if (!upstream.ok) return relay(upstream)
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store, no-transform', 'x-accel-buffering': 'no' },
  })
}
```

No `Last-Event-ID` forwarding.

- [ ] **Step 4: Implement hook**

`src/preview/use-file-watch.ts`:

```ts
import { useEffect, useRef } from 'react'

export function useFileWatch(sessionId: string, enabled: boolean, onChange: (paths: string[] | 'reset') => void): void {
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  useEffect(() => {
    if (!enabled) return
    let es: EventSource | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    let attempt = 0
    let closedByServer = false
    const open = () => {
      if (closedByServer) return
      es = new EventSource(`/api/agentry/agents/sessions/${encodeURIComponent(sessionId)}/artifacts/watch`)
      es.addEventListener('changed', (ev: MessageEvent) => {
        attempt = 0
        try { const data = JSON.parse(ev.data) as { paths?: string[] }; onChangeRef.current(Array.isArray(data.paths) ? data.paths : []) } catch {}
      })
      es.addEventListener('reset', () => { attempt = 0; onChangeRef.current('reset') })
      es.addEventListener('closed', () => { closedByServer = true; es?.close(); es = null })
      es.onerror = () => {
        es?.close(); es = null
        if (closedByServer) return
        const delay = Math.min(30_000, 1000 * 2 ** attempt)
        attempt += 1
        timer = setTimeout(open, delay)
      }
    }
    open()
    return () => { closedByServer = true; clearTimeout(timer); es?.close() }
  }, [sessionId, enabled])
}
```

Make sure `closed` disables reconnect until the effect reruns (enabled flips/session changes).

- [ ] **Step 5: Run tests**

Run: `pnpm vitest run tests/unit/use-file-watch.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /home/mffaiz/code/agentry-web
git add app/api/agentry/agents/sessions/[id]/artifacts/watch/route.ts src/preview/use-file-watch.ts tests/unit/use-file-watch.spec.ts CHANGELOG.md
git commit -m "feat(web): add workspace watch route and hook"
```

## Task 5: Wire live watch into PreviewPanel

**Files:**
- Modify: `agentry-web/src/ui/preview/PreviewPanel.tsx`
- Test: `agentry-web/tests/component/preview-panel-watch.spec.tsx` (targeted; mock `useFileWatch` or EventSource)

- [ ] **Step 1: Write failing test**

Create a component test that renders `PreviewPanel` with mocked `api.listSessionArtifacts` and a controllable watch mock. Assert:
- when watch reports `changed` including active path, panel reloads tree and bumps file reload (renderer receives new reloadKey / fetch called again)
- when watch reports `reset`, tree reload happens
- changes are debounced ~1s before `load()` (fake timers)

Keep test narrow; mock `useFileWatch` module to capture callback.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/component/preview-panel-watch.spec.tsx`

- [ ] **Step 3: Implement**

In `PreviewPanel.tsx`:
- import `useFileWatch` from `@/preview/use-file-watch`
- add a debounced refresh helper using `useRef` timer; on watch event:
  - if `reset`: schedule `load(); setReloadKey(k=>k+1)`
  - if `changed`: schedule `load()`; if active file is in paths (or any changed path affects open file), bump reloadKey
- call `useFileWatch(sessionId, state.open, handler)`
- keep existing idle refresh effect as fallback

Be careful not to refresh when panel is closed; `enabled=state.open`.

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run tests/component/preview-panel-watch.spec.tsx tests/unit/use-file-watch.spec.ts`
Then: `pnpm typecheck`

- [ ] **Step 5: Commit**

```bash
git add src/ui/preview/PreviewPanel.tsx tests/component/preview-panel-watch.spec.tsx
git commit -m "feat(web): refresh preview panel from workspace watch"
```

## Task 6: XLSX sheet renderer

**Files:**
- Modify: `agentry-web/package.json` (add `exceljs` exact version)
- Modify: `agentry-web/src/preview/renderers.ts`
- Modify: `agentry-web/src/ui/preview/renderers/index.tsx`
- Modify: `agentry-web/src/ui/preview/PreviewPanel.tsx` (kind mapping/labels if needed)
- Create: `agentry-web/src/ui/preview/renderers/SheetView.tsx`
- Test: `agentry-web/tests/unit/renderers.spec.ts` (or add case to existing renderer tests)
- Test: `agentry-web/tests/component/sheet-view.spec.tsx`

- [ ] **Step 1: Write failing tests**

Renderer choice test: `renderersFor('report.xlsx')` returns `{ default: 'sheet', options: ['sheet','officePdf','download'] }` and same for `xls`.

Component test `sheet-view.spec.tsx`:
- renders sheet tabs for multi-sheet workbook
- renders cell values in a table
- shows truncation banner when rows/cols exceed cap
- shows parse error banner with Download on fetch/parse failure

For the component test, mock `fetch(fileUrl(...))` to return a small workbook ArrayBuffer generated with `exceljs` in Node test environment (exceljs can write buffers in node; use dynamic import or direct import in test). Keep fixture tiny.

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm vitest run tests/unit/renderers.spec.ts tests/component/sheet-view.spec.tsx`

- [ ] **Step 3: Add dependency**

```bash
cd /home/mffaiz/code/agentry-web
export PATH=$HOME/.nvm/versions/node/v24.19.0/bin:$PATH
pnpm add exceljs@4.4.0
```

Confirm `package.json` has exact version `"exceljs": "4.4.0"`.

- [ ] **Step 4: Implement renderer choice and view**

`src/preview/renderers.ts`:

```ts
export type RendererId = 'markdown' | 'code' | 'text' | 'image' | 'video' | 'pdf' | 'html' | 'source' | 'table' | 'json' | 'docx' | 'officePdf' | 'sheet' | 'download'
// ...
if (ext === 'xls' || ext === 'xlsx') return pick('sheet', 'officePdf', 'download')
```

`src/ui/preview/PreviewPanel.tsx`:
- `SIDE.sheet = 'preview'`
- `kindOf`: `if (id === 'sheet') return { label: 'Spreadsheet', icon: TableCellsIcon }`

`src/ui/preview/renderers/SheetView.tsx`:

```tsx
'use client'
import { Banner } from '@astryxdesign/core/Banner'
import { Button } from '@astryxdesign/core/Button'
import { Skeleton } from '@astryxdesign/core/Skeleton'
import { Tab, TabList, TabPanel, Tabs } from '@astryxdesign/core/Tabs' // verify actual astryx Tabs API; if unavailable, use simple buttons styled with StyleX
import * as stylex from '@stylexjs/stylex'
import { useEffect, useState } from 'react'
import { fileUrl } from '@/preview/use-file-bytes'

const ROW_CAP = 2000
const COL_CAP = 50
```

Implementation notes:
- Fetch bytes with `fetch(fileUrl(sessionId, path), { signal })`.
- `const ExcelJS = await import('exceljs')`; `const wb = new ExcelJS.Workbook(); await wb.xlsx.load(await res.arrayBuffer())`.
- Convert selected worksheet to rows of display strings. For each cell: prefer `cell.text` or formatted value; for dates/numbers use reasonable string; for formula use `cell.result ?? ''`; for null/undefined empty string.
- Cap rows/cols; set truncation flags.
- Render semantic `<table>` with sticky first row, horizontal scroll container, StyleX borders/background using colorVars. Keep styling simple and readable.
- Sheet tabs: if multiple worksheets, render a tab control. Check astryx Tabs component props with CLI before using; if awkward, small local tab row is acceptable.
- Error state: Banner with message "Could not read this spreadsheet." and a Download button/link using `fileUrl(sessionId, path, true)`.

`renderers/index.tsx`:
- import `SheetView`
- add `case 'sheet': return <SheetView sessionId={sessionId} path={path} reloadKey={props.reloadKey} onMissing={props.onMissing} />`

- [ ] **Step 5: Run tests**

Run: `pnpm vitest run tests/unit/renderers.spec.ts tests/component/sheet-view.spec.tsx`
Then: `pnpm typecheck`

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml src/preview/renderers.ts src/ui/preview/renderers/index.tsx src/ui/preview/renderers/SheetView.tsx src/ui/preview/PreviewPanel.tsx tests/unit/renderers.spec.ts tests/component/sheet-view.spec.tsx
git commit -m "feat(web): add read-only xlsx sheet preview"
```

## Task 7: Docs, status, and verification

**Files:**
- Modify: `agentry-web/CHANGELOG.md`
- Modify: `agentry-web/AGENTS.md`
- Modify: `dsh-agents-api/CHANGELOG.md` (if not done in Task 3)
- Modify: `dsh-agents-api/docs/README.md` (if route table needs it)

- [ ] **Step 1: Update changelog/status**

Web CHANGELOG: add Unreleased bullets for live file tree watch and xlsx sheet view. AGENTS backlog item 5 / P2 F3 remainder: mark live file tree and xlsx sheet view done (date 2026-11-28), leave "changes kept across an API restart" as not done/deferred.

API CHANGELOG: add workspace watch SSE route.

- [ ] **Step 2: Run focused checks**

Web:
```bash
cd /home/mffaiz/code/agentry-web
export PATH=$HOME/.nvm/versions/node/v24.19.0/bin:$PATH
pnpm vitest run tests/unit/use-file-watch.spec.ts tests/component/preview-panel-watch.spec.tsx tests/unit/renderers.spec.ts tests/component/sheet-view.spec.tsx
pnpm typecheck
```

API:
```bash
cd /home/mffaiz/code/dsh-agents-api
export PATH=$HOME/.nvm/versions/node/v24.19.0/bin:$PATH
pnpm vitest run tests/files-watch.spec.ts tests/files-watch-source.spec.ts tests/files-watch-route.spec.ts
pnpm typecheck
```

- [ ] **Step 3: Run broader confidence checks as appropriate**

If time permits, run `pnpm vitest run --no-file-parallelism` in web and `pnpm vitest run` in API. If too heavy/flaky due unrelated environment, record what ran.

- [ ] **Step 4: Commit**

```bash
# in each repo, commit only relevant files
git commit -m "docs: record f3 live tree and sheet view"
```

## Execution notes

- The existing F3 plan Part 4 has more granular notes; where this plan is brief, follow its intent (route before catch-all, static `watch` segment wins in Next, no Last-Event-ID, idle refresh fallback remains).
- Do not implement changes-persistence across restart.
- Do not implement public browser tab (Part 3).
- If exceljs browser import is problematic under Turbopack/Next, document the issue and use a small fallback (e.g. `xlsx` CE) only after checking license; prefer fixing the import (dynamic import, browser field) first.
