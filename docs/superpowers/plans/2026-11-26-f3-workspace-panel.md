# F3 workspace panel: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Office previews as PDF, per-turn changed files with diffs, a browser tab for public pages, and a live file tree, in the chat's right-hand panel.

**Architecture:** The API exposes two DSH services that the profile already mounts (`office-to-pdf`, `workspace-changes`) through new owner-scoped routes, plus a file-watch SSE route over envd `WatchDir` (sandbox) or `fs.watch` (local). The web adds BFF routes, renderers, a Changes card, Diff, Web-page tabs and a watch hook. Each part ships alone.

**Spec:** `docs/superpowers/specs/2026-11-26-f3-workspace-panel-design.md`

**Repos:** API tasks run in `~/code/dsh-agents-api` (prefix `export DSH_ROOT=/home/mffaiz/code/dsh-pinned`; checks `pnpm typecheck && pnpm vitest run`). Web tasks run in `~/code/agentry-web` (checks `pnpm typecheck && pnpm vitest run --no-file-parallelism`). Every shell: `export PATH=$HOME/.nvm/versions/node/v24.19.0/bin:$PATH`.

**Model per task:** **Sonnet** = mechanical, the interfaces are fixed here. **Opus** = needs judgment (spikes, DSH service wiring, security-sensitive code).

## Global Constraints

- Browser code never holds Agentry credentials; every new byte or SSE path goes through a BFF route that calls `requireCredential()`.
- API: every route is owner-scoped (`requireSession`), has an OpenAPI entry in `openapi/agentry.yaml` (the drift test enforces it), a CHANGELOG bullet, and for a new capability a `docs/changes/2026-11-26-<slug>.md` note plus a `docs/README.md` row.
- API: DSH services are optional and read at call time (`() => ctx.get('officeToPdf')`, as `schedule` and `skills` are in `src/index.ts`). Absent → 503, never a crash.
- Web: astryx components and tokens; StyleX only for layout glue; no raw hex/px; read props with `pnpm exec astryx component <Name>` first.
- Web: agent-authored content never runs with `allow-same-origin`.
- Each behaviour change gets a dated (2026-11-26 or the day of work) bullet at the top of `## Unreleased` in that repo's `CHANGELOG.md`.
- Commit as `fakhrulfaiz <fakhrulfaiz2003@gmail.com>`; no Co-Authored-By or AI attribution.
- Never edit `~/code/dsh-pinned`.

## Review Focus

- Path escapes on every new route (reuse `sanitizeRelativePath` in the API and `sanitizeArtifactSegments` in the BFF).
- Diffs never serve files outside the workspace (absolute paths are dropped).
- Office errors map to the right status and never leak engine diagnostics.
- Watch streams stop when the reader leaves (no leaked watchers).
- The browser tab iframe has no `allow-same-origin`.

---

## Part 1: Office previews

### Task 1: Spike, office conversion in the Agentry profile (Opus)

**Files:**
- Create: `dsh-agents-api/tests/office-live.spec.ts` (skipped unless `AGENTRY_LIVE_OFFICE=1`)
- Create: `dsh-agents-api/tests/fixtures/office/two-slides.pptx` (a tiny deck made with python-pptx or by hand)

- [ ] **Step 1:** Read `~/code/dsh-pinned/packages/document/office-to-pdf/src/{index,types,queue}.ts`. Note the exact `convert()` request shape and how `OfficeSourceKey` is built (`identity.ts`).
- [ ] **Step 2:** Write a live test that builds the provider the way its own tests do (see `packages/document/office-to-pdf/tests/`), converts the fixture, and expects bytes starting with `%PDF-`.
- [ ] **Step 3:** Run `AGENTRY_LIVE_OFFICE=1 pnpm vitest run tests/office-live.spec.ts`. Record time taken and peak RSS (`/usr/bin/time -v`).
- [ ] **Step 4:** Check the Docker image: `grep -n libreoffice Dockerfile` and the image's `node_modules`. If the WASM package is not in the image, note the Dockerfile change needed (do not build the image).
- [ ] **Step 5:** Write the findings at the top of this plan under "Spike results". If conversion does not work, stop Part 1 and report.
- [ ] **Step 6:** Commit `test(office): live conversion spike`.

### Task 2: API office helpers (Sonnet)

**Files:**
- Create: `dsh-agents-api/src/render/office.ts`
- Test: `dsh-agents-api/tests/office-render.spec.ts`

**Interfaces (produce):**
- `type OfficeExtension = 'doc' | 'docx' | 'xls' | 'xlsx' | 'ppt' | 'pptx'`
- `officeExtension(path: string): OfficeExtension | undefined` (case-insensitive, last dot).
- `MAX_OFFICE_INPUT_BYTES = 50 * 1024 * 1024`
- `renderError(code: string): { status: number; code: string; message: string }` mapping: `input-too-large`/`output-too-large` → 413 `file_too_large`; `invalid-document`/`unsupported-format` → 422 `invalid_document`; `timeout` → 504 `render_timeout`; `busy` → 503 `render_busy`; `unavailable` → 503 `render_unavailable`; `source-changed` → 409 `source_changed`; anything else → 500 `render_failed`. Messages are plain and never include engine text.
- `missingFontsHeader(names: string[]): string | undefined` (comma-joined `encodeURIComponent` names; undefined when empty).

- [ ] **Step 1: Write failing tests** for each mapping, `officeExtension('a/B.PPTX') === 'pptx'`, `officeExtension('a.pdf') === undefined`, `officeExtension('noext') === undefined`, header encoding of `['Calibri','Noto Sans CJK']`.
- [ ] **Step 2: Run** `pnpm vitest run tests/office-render.spec.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `src/render/office.ts`.
- [ ] **Step 4: Run** again. Expected: PASS.
- [ ] **Step 5: Commit** `feat(render): office helpers`.

### Task 3: API route `GET /agents/sessions/{id}/renders/pdf/*path` (Opus)

**Files:**
- Modify: `dsh-agents-api/src/gateway.ts` (option `officeToPdf?: () => OfficeToPdfLike | undefined`, route row next to `getArtifact`, handler `renderPdf`)
- Modify: `dsh-agents-api/src/index.ts` (wire `officeToPdf: () => ctx.get('officeToPdf')`)
- Modify: `dsh-agents-api/tests/support/fake-session-query.ts` (`testGatewayOptions` default `officeToPdf: () => undefined`)
- Modify: `dsh-agents-api/openapi/agentry.yaml`, `CHANGELOG.md`, `docs/README.md`
- Create: `dsh-agents-api/docs/changes/2026-11-26-office-render.md`
- Test: `dsh-agents-api/tests/gateway-office.spec.ts`

**Interfaces:**
- Consumes Task 2. `OfficeToPdfLike` is a structural type with only `convert(request): Promise<{ pdf: Uint8Array; missingFonts: string[] }>` (do not import the DSH package type at runtime; add it as an optional peer only if the typecheck needs it).
- Handler order: `requireSession` → `sanitizeRelativePath` (400) → `officeExtension` (400 `unsupported_format`) → service present (503 `render_unavailable`) → size via the same branch logic as `getArtifact` (sandbox `fileSize`, local `fs.stat`, S3 head) → 404 if missing → 413 if over `MAX_OFFICE_INPUT_BYTES` → `convert({ extension, priority: 'foreground', source: { key, version: \`${size}:${mtimeMs}\`, bytes: size, read } })` → 200 `application/pdf`, `etag: "<version>"`, `x-agentry-missing-fonts` when any. `if-none-match` equal to the etag → 304 without converting. Errors with a `code` property go through `renderError`.
- Refactor only as much as needed: extract the "read bytes for a session path" branches of `getArtifact` into a private `readSessionFile(owner, sessionId, path)` returning `{ bytes, size, version } | undefined`, and use it in both handlers.

- [ ] **Step 1: Write failing gateway tests** (copy the server setup of `tests/gateway-history.spec.ts`): 200 with a fake service returning `%PDF-1.7`, content type and etag; 304 on matching `if-none-match` and the fake not called; 400 for `a.txt`; 400 for `../x.pptx`; 404 for a missing file; 413 with a fake size over the cap and the fake not called; 503 when `officeToPdf` returns undefined; 504 when the fake rejects with `{ code: 'timeout' }`; another owner gets 404.
- [ ] **Step 2: Run** `pnpm vitest run tests/gateway-office.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the route, the shared reader, the wiring.
- [ ] **Step 4: Run** the new test plus `tests/gateway.spec.ts tests/artifacts-mime.spec.ts` (the refactor must not change `getArtifact`). Expected: PASS.
- [ ] **Step 5:** OpenAPI path and 200/304/400/404/413/422/503/504 responses; run `pnpm vitest run tests/openapi-drift.spec.ts tests/openapi-contract.spec.ts`. Expected: PASS.
- [ ] **Step 6:** CHANGELOG bullet, `docs/changes/2026-11-26-office-render.md` (route, limits, where conversion runs, caching by DSH), `docs/README.md` row.
- [ ] **Step 7:** `pnpm typecheck && pnpm vitest run`. Commit `feat(api): office documents render to PDF`.

### Task 4: Web BFF route for office renders (Sonnet)

**Files:**
- Create: `agentry-web/app/api/agentry/agents/sessions/[id]/renders/pdf/[...path]/route.ts`
- Modify: `agentry-web/src/preview/use-file-bytes.ts` (add `pdfRenderUrl(sessionId, path)`)
- Test: `agentry-web/tests/unit/office-render-route.spec.ts` (pattern: `tests/unit/models-route.spec.ts`)

**Interfaces:**
- Copy the shape of `app/api/agentry/agents/sessions/[id]/artifacts/[...path]/route.ts`: `sanitizeArtifactSegments`, `ID_SEGMENT`, `requireCredential`, 401 → `signedOut`, 502 on fetch failure. Upstream path `/agents/sessions/{id}/renders/pdf/{segments}`.
- Forward request header `if-none-match`; pass through `etag`, `x-agentry-missing-fonts`, status 304. Response headers: `content-type: application/pdf` when ok, `content-disposition: inline; filename="<name>.pdf"`, `cache-control: private, no-cache`, `x-content-type-options: nosniff`. Non-ok upstream JSON passes through with its status.
- `pdfRenderUrl` = `/api/agentry/agents/sessions/{id}/renders/pdf/{encoded segments}`.

- [ ] **Step 1: Write failing tests:** a bad segment (`..`) → 404 without fetch; ok upstream → 200, `application/pdf`, etag passed; `if-none-match` forwarded; upstream 504 JSON passes through; upstream 401 → signed-out response.
- [ ] **Step 2: Run** `pnpm vitest run tests/unit/office-render-route.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(bff): office render route`.

### Task 5: Web Office renderer (Sonnet)

**Files:**
- Modify: `agentry-web/src/preview/renderers.ts` (new id `officePdf`)
- Modify: `agentry-web/src/ui/preview/renderers/index.tsx` (`OfficePdfView`)
- Modify: `agentry-web/src/ui/preview/PreviewPanel.tsx` (`SIDE.officePdf = 'preview'`, `kindOf`: Document for doc/docx, "Presentation" for ppt/pptx, Table for xls/xlsx)
- Test: `agentry-web/tests/unit/preview-renderers.spec.ts`, `agentry-web/tests/component/preview-renderers.spec.tsx`

**Interfaces:**
- `renderersFor`: `pptx`, `ppt`, `doc` → `pick('officePdf')`; `docx` → `pick('officePdf', 'docx')`; `xlsx`, `xls` → `pick('officePdf', 'download')`.
- `OfficePdfView({ sessionId, path, reloadKey, onMissing, onRetry })`: fetches `pdfRenderUrl` with `cache: 'no-cache'` (so the etag is used), turns the blob into an object URL (revoked on change), shows it in the same iframe the `pdf` renderer uses. Loading: Skeleton plus "Rendering document...". Status to message: 404 → `onMissing()`; 413 "This file is too large to preview."; 422 "This file could not be read as a document."; 503 "Preview is busy or unavailable. Try again."; 504 "Preview timed out."; each with Retry and Download buttons. `x-agentry-missing-fonts` → a supporting-text line "Some fonts are not installed; the layout may differ." with the decoded names in a Tooltip.
- The header's "Text" choice for docx is the existing mammoth renderer (label it "Text" in the toggle: `SIDE.docx = 'code'`).

- [ ] **Step 1: Write failing tests:** unit for the new `renderersFor` rows; component: a mocked fetch 200 renders an iframe whose `src` starts with `blob:`; a 422 shows the invalid-document message and a Download link; the missing-fonts header shows the warning.
- [ ] **Step 2: Run** `pnpm vitest run tests/unit/preview-renderers.spec.ts tests/component/preview-renderers.spec.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS. Then `pnpm typecheck`.
- [ ] **Step 5:** CHANGELOG bullet. Commit `feat(preview): Office files preview as PDF`.

---

## Part 2: changes per turn

### Task 6: API changes mapper (Sonnet)

**Files:**
- Create: `dsh-agents-api/src/history/turn-changes.ts`
- Test: `dsh-agents-api/tests/history/turn-changes.spec.ts`

**Interfaces (produce):**
- `changeEventsByTurn(events: readonly SessionEvent[]): Map<string, number>`: turn id (`turn_<seq of turn/start>`) → seq of the **latest** `workspace/changes` event for that DSH turn number. Map the event's `data.turn` to the latest preceding `turn/start` whose `data.turn` matches.
- `toWireSummary(turnId, summary | undefined): TurnChanges` where `TurnChanges = { object: 'agent.session.turn.changes'; turn_id; available: boolean; total; added; deleted; outside: number; files: { index; path; display; added; deleted; binary?: true; oversized?: true }[] }`. `index` is the file's index in DSH's `files` (kept even after filtering). Files whose `path` is absolute go to `outside` and are not listed. `undefined` summary → `available: false`, zeros, empty files.
- `toWireDiff(diff)`: `{ object: 'agent.session.turn.change', kind, path, display, before?, after?, hunks?, coarse? }` with hunks as `{ old_start, old_lines, new_start, new_lines, lines }`.

- [ ] **Step 1: Write failing tests** with `logEvent` from `tests/support/fake-session-query.ts`: two turns, a repeated `workspace/changes` for turn 1 (the later seq wins); an event for a turn number without a `turn/start` is ignored; an absolute path counts as `outside` and keeps the other files' original `index`.
- [ ] **Step 2: Run** `pnpm vitest run tests/history/turn-changes.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(history): map workspace changes to turns`.

### Task 7: API changes routes (Opus)

**Files:**
- Modify: `dsh-agents-api/src/history/session-history.ts` (add `events(sessionId): Promise<readonly SessionEvent[]>` reusing `read`)
- Modify: `dsh-agents-api/src/gateway.ts` (option `workspaceChanges?: () => WorkspaceChangesLike | undefined`; three routes; place them before `/turns/:turn_id`)
- Modify: `dsh-agents-api/src/index.ts`, `tests/support/fake-session-query.ts`
- Modify: `openapi/agentry.yaml`, `CHANGELOG.md`, `docs/README.md`; create `docs/changes/2026-11-26-turn-changes.md`
- Test: `dsh-agents-api/tests/gateway-changes.spec.ts`

**Interfaces:**
- `GET /agents/sessions/:session_id/changes` → `{ object: 'list', data: [{ turn_id, total, added, deleted }] }`, newest first, only turns whose summary is available.
- `GET /agents/sessions/:session_id/turns/:turn_id/changes` → `TurnChanges` (Task 6). Unknown turn → 404.
- `GET /agents/sessions/:session_id/turns/:turn_id/changes/:index` → wire diff; index not a listed (non-outside) file, or summary gone → 404. Abort the DSH `diff` call when the request closes.
- `WorkspaceChangesLike = { summary(sessionId, seq); diff(sessionId, seq, index, signal) }` (structural).
- Service absent → the list routes answer `available: false` / empty list (not 503), so the web simply shows no card.

- [ ] **Step 1: Write failing gateway tests** with a fake service and a fake log: summary returned and filtered; second owner 404; diff for an outside file 404; diff passes an AbortSignal; absent service → `available: false`.
- [ ] **Step 2: Run** `pnpm vitest run tests/gateway-changes.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it plus `tests/openapi-drift.spec.ts tests/openapi-contract.spec.ts` after adding the OpenAPI paths. Expected: PASS.
- [ ] **Step 5:** CHANGELOG, change note (routes, memory-only lifetime, outside-workspace rule), `docs/README.md` row.
- [ ] **Step 6:** `pnpm typecheck && pnpm vitest run`. Commit `feat(api): per-turn workspace changes`.

### Task 8: Spike, changes in sandbox chats (Opus)

**Files:** none committed unless the fallback is needed (then Task 9).

- [ ] **Step 1:** Read `~/code/dsh-pinned/packages/deliverables/workspace-changes/src/{index,recorder,git,capture}.ts` and `dsh-agents-api/src/sandbox/presets.ts`. Decide on paper which `subprocess` and `fs` the root-level recorder gets in a sandbox chat.
- [ ] **Step 2:** On the dev stack (the user starts it; do not start servers yourself), ask the user to run one sandbox chat turn that edits `/workspace/a.txt` with the edit tool and one that runs `echo x >> b.txt` in bash, then call `GET /v1/agents/sessions/{id}/turns/{turn}/changes`.
- [ ] **Step 3:** Record the result under "Spike results" here. If both files are listed with counts, skip Task 9.

### Task 9: Sandbox changes recorder, only if Task 8 fails (Opus)

**Files:**
- Create: `dsh-agents-api/src/history/sandbox-changes.ts`, `dsh-agents-api/src/history/numstat.ts`
- Modify: `dsh-agents-api/src/sandbox/agentry-sandbox-provider.ts` (method `exec(record, argv, opts): Promise<{ code; stdout; stderr }>` over `envd.process`, 30 s timeout, 8 MB output cap)
- Modify: `dsh-agents-api/src/gateway.ts` (use it for sandbox sessions in the Task 7 routes)
- Modify: `dsh-agents-api/src/bridge.ts` or wherever `turn/start`/`turn/end` are observed per session (read it first)
- Test: `dsh-agents-api/tests/sandbox-changes.spec.ts` (fake `exec`), `tests/history/numstat.spec.ts`

**Interfaces:**
- `SandboxChanges.start(sessionId, turnId)` and `.end(sessionId, turnId)` run, through `exec`, with `GIT_DIR=/tmp/agentry-changes/<session>.git GIT_WORK_TREE=<dir> GIT_INDEX_FILE=/tmp/agentry-changes/<session>.index`: `git init --bare -q` (once), `git add -A`, `git write-tree`. `end` then runs `git diff-tree -r --numstat <before> <after>` and keeps a summary in memory (same wire shape as Task 6, `maxFiles` 500).
- `diff(sessionId, turnId, index)` runs `git diff --no-color -U3 <before> <after> -- <path>` and parses hunks (`parseUnifiedDiff` in `numstat.ts`); `Binary files differ` → `kind: 'binary'`.
- Failures log one line and leave the turn without a summary.

- [ ] **Step 1: Write failing tests** for `parseNumstat` (`-\t-\tbin.png` is binary), `parseUnifiedDiff` (two hunks, a no-newline marker), and the recorder against a fake `exec` that answers from a script.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS. `pnpm typecheck && pnpm vitest run`.
- [ ] **Step 5:** CHANGELOG and change note update. Commit `feat(api): record sandbox turn changes with a shadow git repo`.

### Task 10: Web client, types and BFF allow-list for changes (Sonnet)

**Files:**
- Modify: `agentry-web/src/api/types.ts` (`TurnChanges`, `TurnChangeDiff`, `TurnChangesListEntry`, matching the API wire shapes)
- Modify: `agentry-web/src/api/client.ts` (`sessionChanges(id)`, `turnChanges(id, turnId)`, `turnChangeDiff(id, turnId, index)`)
- Modify: `agentry-web/src/server/allowlist.ts` (GET `agents/sessions/{session}/changes`, `.../turns/{turn}/changes`, `.../turns/{turn}/changes/{index}`; add a `turn` id kind and an `index` kind matching `^[0-9]{1,5}$`)
- Test: `agentry-web/tests/unit/allowlist.spec.ts`, `agentry-web/tests/unit/api-client.spec.ts`

- [ ] **Step 1: Write failing tests:** the three paths allowed for GET only; `changes/abc` and `changes/-1` rejected; POST rejected; client builds the right URLs.
- [ ] **Step 2: Run** `pnpm vitest run tests/unit/allowlist.spec.ts tests/unit/api-client.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(api-client): turn changes`.

### Task 11: Diff layout and panel store (Sonnet)

**Files:**
- Create: `agentry-web/src/preview/diff.ts`
- Modify: `agentry-web/src/preview/store.ts`
- Test: `agentry-web/tests/unit/preview-diff.spec.ts`, `agentry-web/tests/unit/preview-store.spec.ts`

**Interfaces (produce):**
- `diffRows(hunks): DiffRow[]` where `DiffRow = { kind: 'context' | 'add' | 'del'; oldNo?: number; newNo?: number; text: string } | { kind: 'gap'; hidden: number }`. A `gap` row sits between hunks with the count of unchanged lines skipped (`next.old_start - (prev.old_start + prev.old_lines)`).
- `toPatch(path, hunks): string` (a unified diff text for Copy patch).
- Store: `PanelState.diffs: { key: string; turnId: string; index: number; title: string }[]`; `openDiff(s, { turnId, index, path })` (key `${turnId}:${index}`, title `${basename} (changes)`, activates `diff:<key>`, reuses an existing key), `closeDiff(s, key)` (active falls back to `'start'`). Add both to `PanelActions`, the provider, and the no-op default.

- [ ] **Step 1: Write failing tests** for line numbering across `+`/`-`/context lines, the gap count, `toPatch` header lines (`--- a/x`, `+++ b/x`, `@@ -1,3 +1,4 @@`), and the two reducers.
- [ ] **Step 2: Run** `pnpm vitest run tests/unit/preview-diff.spec.ts tests/unit/preview-store.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(preview): diff rows and diff tabs`.

### Task 12: Diff tab and Changes card (Sonnet)

**Files:**
- Create: `agentry-web/src/ui/preview/DiffView.tsx`, `agentry-web/src/ui/chat/ChangesCard.tsx`
- Modify: `agentry-web/src/ui/preview/PreviewPanel.tsx` (render `diff:` tabs in the tab strip and body; Start page card "Changes" listing `api.sessionChanges`)
- Modify: `agentry-web/src/ui/chat/Conversation.tsx` (render `ChangesCard` after each completed turn's last entry, keyed by `turnId`)
- Test: `agentry-web/tests/component/changes.spec.tsx`

**Interfaces:**
- `ChangesCard({ sessionId, turnId, completed })`: reads `api.turnChanges` once when `completed` becomes true (and on mount for completed turns, only when scrolled into view: use an IntersectionObserver guarded for jsdom). Hidden when `available` is false or `total` is 0. Collapsed label "3 files changed" with `+42` (success token) `−7` (danger token); `outside > 0` adds "and 1 outside the workspace". Expanded: astryx `List`/`Item` rows (name, dir subdued, counts); click → `actions.openDiff`.
- `DiffView({ sessionId, turnId, index })`: fetch `api.turnChangeDiff`; render `diffRows` in a monospace block (astryx `Code` tokens; line numbers in `Text type="supporting"`); `gap` rows as a muted "⋯ 12 unchanged lines" row; header actions Open file (`actions.openFile(path)`), Copy patch, Close. `binary`/`oversized` → one-line notice plus Open file. 404 → "These changes are no longer available."

- [ ] **Step 1: Write failing component tests:** card hidden when `available: false`; card shows counts and opens a diff tab on click; diff view renders add/del rows and a gap row; 404 shows the unavailable message.
- [ ] **Step 2: Run** `pnpm vitest run tests/component/changes.spec.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.** Read props first: `pnpm exec astryx component List`, `Item`, `Code`, `Collapsible`.
- [ ] **Step 4: Run** the test and `tests/component/preview-panel.spec.tsx`. Expected: PASS. `pnpm typecheck`.
- [ ] **Step 5:** CHANGELOG bullet. Commit `feat(chat): changed files per turn with diffs`.

---

## Part 4: live file tree

### Task 13: API watch route (Opus)

**Files:**
- Create: `dsh-agents-api/src/files/watch.ts` (`WatchHub`, debounce)
- Modify: `dsh-agents-api/src/sandbox/agentry-sandbox-provider.ts` (`watch(record, signal): AsyncIterable<string[]>` over `envd.filesystem.watchDir({ path: dir, recursive: true })`, relative paths, skip `SKIP_DIRS`)
- Modify: `dsh-agents-api/src/environment/local.ts` or a helper beside it (local `fs.watch(dir, { recursive: true, signal })` as the same iterable)
- Modify: `dsh-agents-api/src/gateway.ts` (route `GET /agents/sessions/:session_id/artifacts/watch`, placed **before** `artifacts/*path`)
- Modify: `openapi/agentry.yaml`, `CHANGELOG.md`, `docs/README.md`; create `docs/changes/2026-11-26-workspace-watch.md`
- Test: `dsh-agents-api/tests/files-watch.spec.ts`

**Interfaces:**
- `WatchHub.subscribe(owner, sessionId, source: () => AsyncIterable<string[]>, onEvent)`: one source per session; batches paths for 500 ms; over 200 paths in one batch → `reset`; stops the source 30 s after the last subscriber; max 8 sessions watched per owner (429 `too_many_watches`).
- SSE (reuse `src/sse.ts` helpers): `event: changed` `data: {"paths":[...]}`, `event: reset`, `event: closed` when the source ends (sandbox stopped), comment ping every 15 s.

- [ ] **Step 1: Write failing tests** with fake timers and a fake source: two quick events merge into one `changed`; 201 paths → `reset`; last unsubscribe then 30 s → source aborted; ninth session → 429; route returns `text/event-stream` for the owner and 404 for another owner.
- [ ] **Step 2: Run** `pnpm vitest run tests/files-watch.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Check the envd generated client (`agentry-sandbox/src/envd/gen/filesystem/filesystem_pb.ts`, `WatchDirRequest`) for field names and event types (create, write, remove, rename).
- [ ] **Step 4: Run** it plus the OpenAPI tests. Expected: PASS. `pnpm typecheck && pnpm vitest run`.
- [ ] **Step 5:** Docs. Commit `feat(api): workspace file watch stream`.

### Task 14: Web watch route and hook (Sonnet)

**Files:**
- Create: `agentry-web/app/api/agentry/agents/sessions/[id]/artifacts/watch/route.ts` (model on `app/api/agentry/sessions/[id]/stream/route.ts`, without `Last-Event-ID`)
- Create: `agentry-web/src/preview/use-file-watch.ts`
- Modify: `agentry-web/src/ui/preview/PreviewPanel.tsx` (when open: on `changed`, debounce 1 s then `load()`; if `state.active` is in `paths`, bump `reloadKey`; on `reset` do both; keep the idle effect)
- Test: `agentry-web/tests/unit/use-file-watch.spec.ts`

**Interfaces:**
- `useFileWatch(sessionId, enabled, onChange: (paths: string[] | 'reset') => void)`: `EventSource` on the BFF route; reconnect 1 s doubling to 30 s; closed when `enabled` is false or on unmount; `closed` event stops reconnecting until `enabled` flips.
- Note: the catch-all `artifacts/[...path]` route must not swallow `watch`; Next picks the static segment first, verify with a test request.

- [ ] **Step 1: Write failing tests** with a fake `EventSource`: `changed` calls `onChange(paths)`; `reset` calls `onChange('reset')`; an error schedules a reconnect at 1 s, then 2 s; disabling closes the source.
- [ ] **Step 2: Run** `pnpm vitest run tests/unit/use-file-watch.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS. `pnpm typecheck`.
- [ ] **Step 5:** CHANGELOG bullet. Commit `feat(preview): live file tree`.

---

## Part 3: browser tab (public pages)

### Task 15: Web-page tab (Sonnet)

**Files:**
- Create: `agentry-web/src/preview/web-url.ts`, `agentry-web/src/ui/preview/WebView.tsx`
- Modify: `agentry-web/src/preview/store.ts` (`browsers: { key; history: string[]; index }[]`, `openWeb(s, url?)`, `navigateWeb(s, key, url)`, `backWeb`, `forwardWeb`, `closeWeb`; `active` may be `web:<key>`)
- Modify: `agentry-web/src/ui/preview/PreviewPanel.tsx` (tabs, Start page card "Web page")
- Modify: `agentry-web/next.config.ts` (`frame-src 'self' https:` in the page CSP)
- Test: `agentry-web/tests/unit/web-url.spec.ts`, `agentry-web/tests/unit/preview-store.spec.ts`, `agentry-web/tests/component/web-view.spec.tsx`

**Interfaces:**
- `normalizeWebUrl(input: string): string | null`: trims; adds `https://` when no scheme; upgrades `http:` to `https:`; returns null for any other scheme (`javascript:`, `data:`, `file:`) and for hosts `localhost`, `127.*`, `[::1]`, `0.0.0.0` (the sandbox port preview is a separate spec).
- `WebView`: address `TextInput` (Enter navigates), Back, Forward, Reload, Open outside (`target=_blank rel=noopener noreferrer`); `<iframe sandbox="allow-scripts allow-forms allow-popups" referrerPolicy="no-referrer">`; a supporting line "Page blank? Some sites block previews. Open it in a new tab."

- [ ] **Step 1: Write failing tests:** URL normalisation table (including `javascript:alert(1)` → null, `example.com` → `https://example.com/`, `http://a.b` → `https://a.b/`, `localhost:3000` → null); store history (navigate after back drops forward entries); the iframe's `sandbox` attribute does not contain `allow-same-origin`.
- [ ] **Step 2: Run** `pnpm vitest run tests/unit/web-url.spec.ts tests/unit/preview-store.spec.ts tests/component/web-view.spec.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS. `pnpm typecheck`.
- [ ] **Step 5:** CHANGELOG bullet. Commit `feat(preview): web page tab`.

### Task 16: Wrap-up (Sonnet)

- [ ] Update `agentry-web/AGENTS.md` backlog item 5 (what is done, what remains: sandbox port preview, xlsx sheet view if not done, persistence of changes).
- [ ] Update `dsh-agents-api/AGENTS.md` backlog item 5 (cowork endpoints done).
- [ ] Full checks in both repos. One final review of the whole branch (per the user's SDD preference: no per-task review).

## Spike results

(Filled in by Tasks 1 and 8.)
