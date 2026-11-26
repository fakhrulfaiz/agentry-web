# F3 remainder: workspace panel (design)

Status: 2026-11-26, draft for review. Not implemented. Plan: `docs/superpowers/plans/2026-11-26-f3-workspace-panel.md`.

## Goal

Finish the chat's right-hand panel (backlog item 5). Four parts, each shippable alone:

1. **Office previews.** PowerPoint and older Word/Excel files show as pages, not a download card.
2. **Changes per turn.** A finished turn lists the files it changed, with line counts, and each file opens as a diff in the panel.
3. **Browser tab.** A web page beside the chat.
4. **Live file tree.** The tree and the open file update while the agent works, not only when the turn ends.

Terminal tabs already shipped (2026-11-25, `docs/superpowers/specs/2026-11-25-sandbox-terminal-design.md`). They are not part of this spec.

## What exists today (facts)

Web (`agentry-web`):

- `src/ui/preview/PreviewPanel.tsx` is the panel: tabs for files and terminals, a Start page, the Files tree, resize, slide-in. State is `src/preview/store.ts` (`PanelState`: `tabs`, `terminals`, `active` = `'start' | 'files' | term:<key> | <path>`).
- `src/preview/renderers.ts` picks a renderer by extension. `docx` already renders in the browser with `mammoth` (`DocxView` in `src/ui/preview/renderers/index.tsx`). `pptx`, `xlsx`, `doc`, `xls`, `ppt` fall to the download card.
- The tree refreshes when the chat returns to idle (`PreviewPanel` effect on `idle`).
- Bytes come through `app/api/agentry/agents/sessions/[id]/artifacts/[...path]/route.ts`, which validates segments (`src/server/artifact-bytes.ts`) and sets the MIME.
- Chat file cards come from `GET /agents/sessions/{id}/deliverables` (`src/ui/chat/SessionArtifacts.tsx`).

API (`dsh-agents-api`):

- `getArtifact`, `listArtifacts`, `listDeliverables` in `src/gateway.ts`. A sandbox chat reads through the sandbox provider (`src/sandbox/agentry-sandbox-provider.ts`: `listEntries`, `readFile`, `fileSize`; cap `MAX_ARTIFACT_BYTES` = 100 MB). A local chat reads the workspace folder.
- Deliverables come from `deliverables/presented` events (`src/history/deliverables.ts`), cached per session version (`src/history/deliverables-cache.ts`).
- The profile bundles `dsh-web-app`, whose `cordis.patch.yml` (in `~/code/dsh-pinned/packages/bundle/web-app/`) mounts both `office-to-pdf` and `workspace-changes`. So both DSH services are already running inside the Agentry API process. The API just does not expose them.

DSH (`~/code/dsh-pinned`, read only):

- `packages/document/office-to-pdf`: `ctx.officeToPdf.convert(request)` turns `doc docx xls xlsx ppt pptx` into PDF bytes with LibreOffice Kit (WASM on Linux, `@deepseek-ai/libreoffice-kit-wasm@0.1.5` is in the pinned install). It caches PDFs by the SHA-256 of the source (8 PDFs, 128 MB), runs 2 conversions at once, times out after 60 s, rejects input over 50 MB, and reports missing fonts. Errors have codes (`input-too-large`, `invalid-document`, `timeout`, `busy`, ...).
- `packages/deliverables/workspace-changes`: on every top-level turn it takes git snapshots of the working tree at turn start and end (a private object dir, the user's repo is untouched) and copies files that file tools edit. It appends `workspace/changes` `{ turn }` to the Session log. `ctx.workspaceChanges.summary(sessionId, seq)` gives `{ turn, cwd, files[{path, display, added, deleted, binary?, oversized?}], total, added, deleted }`; `ctx.workspaceChanges.diff(sessionId, seq, index, signal)` gives hunks. Summaries live **in memory only**: gone after an API restart. Subagent sessions are not recorded.
- `packages/client/ui-sidebar-browser`: an iframe tab with its own history. Behaviour reference only.
- envd (in every sandbox) has `filesystem.WatchDir`; the API's envd client already has `envd.filesystem` (`listDir`, `stat`) and `envd.process` (used by `src/sandbox/terminals.ts`). The sandbox image has git (`agentry-sandbox/images/sandbox/Dockerfile`).

## Part 1: Office previews

### Where conversion runs

In the **API process**, through DSH's `ctx.officeToPdf`. Reasons:

- It is already mounted and already has a queue, limits and a cache. No new install.
- It works for local and sandbox chats the same way: the API reads the bytes (from the folder or the sandbox) and converts them on its side.
- The sandbox image has no LibreOffice. Adding it costs hundreds of MB per image and every sandbox would convert by itself.

Not chosen: LibreOffice inside the sandbox (above); a separate converter service (one more thing to run; DSH's provider already bounds memory and time).

**Verify first (spike, plan task 1):** that `ctx.officeToPdf` is present in the Agentry profile and converts a small `pptx` on the dev machine and in the Docker image (the WASM package must be in the image).

### API

`GET /v1/agents/sessions/{id}/renders/pdf/*path`

- Owner check and path check as `getArtifact`. Extension must be `doc docx xls xlsx ppt pptx`, else 400 `unsupported_format`.
- Reads the size first; over 50 MB answers 413 `file_too_large` without reading.
- Calls `convert({ extension, priority: 'foreground', source: { key, version, bytes, read } })`. `key` = `<session>:<path>`. `version` = `<size>:<mtime>` (sandbox: from `stat`; local: `fs.stat`). `read` reads the bytes the same way `getArtifact` does.
- 200 `application/pdf`. Header `x-agentry-missing-fonts`: comma list (URL-encoded names), omitted when empty. `etag` = the version.
- Errors: 404 file missing; 413 `input-too-large`/`output-too-large`; 422 `invalid_document`; 503 `render_unavailable` (service absent) or `render_busy` (with `retry-after: 5`); 504 `render_timeout`.
- The service is optional: read it at call time, like the other optional services. Absent means 503, never a crash.
- OpenAPI entry, drift test, CHANGELOG, `docs/changes/2026-11-26-office-render.md`.

### Caching and limits

- DSH caches by content hash (8 PDFs, 128 MB). That is enough for one user. No second cache in the API.
- The BFF answers with `cache-control: private, no-cache` and passes the `etag`, so a reopen without changes is a 304 from the browser cache. The panel's Reload refetches.
- Limits stay DSH's defaults: 2 at once, 60 s, 50 MB in, 100 MB out. Make them config only if a user asks.

### Web

- BFF route `app/api/agentry/agents/sessions/[id]/renders/pdf/[...path]/route.ts`, same shape as the artifacts route (segment validation, `requireCredential`, 401 → signed out). It forwards `if-none-match`.
- `renderersFor`: `pptx`, `ppt`, `doc` → `officePdf` (alone). `docx` → `officePdf`, with `docx` (mammoth) as the "Text" alternative. `xlsx`, `xls` → `officePdf`, with `download` alternative. (An in-browser sheet view is a later step; see Open questions.)
- `OfficePdfView` loads the PDF URL into the existing PDF iframe view. Loading text: "Rendering document...". Errors map to plain messages: "This file is too large to preview", "This file could not be read as a document", "Preview is busy, try again", "Preview timed out". Each error shows Download.
- Missing fonts: a small warning line under the header, "Some fonts are not installed; the layout may differ", with the names in a tooltip.

## Part 2: changes per turn

### Data

The API reads `workspace/changes` events from the log and asks `ctx.workspaceChanges` for the summary.

- Turn ids: Agentry's turn id is `turn_<seq of turn/start>`. The event carries the DSH turn number. Map it by finding the `turn/start` whose `data.turn` matches, latest first (the same walk `deliverablesFromEvents` does).
- A later `workspace/changes` for the same turn replaces the earlier one (DSH rule).

### API

- `GET /v1/agents/sessions/{id}/turns/{turn_id}/changes` → `{ object: 'agent.session.turn.changes', turn_id, available, total, added, deleted, files: [{ index, path, display, added, deleted, binary?, oversized? }] }`.
  - `available: false` with empty files when the log has no event for that turn or the summary is gone (API restarted). The web hides the card then; DSH does the same.
  - Paths: workspace-relative as DSH gives them; absolute paths outside the workspace stay absolute and the web shows them without an Open action.
- `GET /v1/agents/sessions/{id}/turns/{turn_id}/changes/{index}` → `{ object: 'agent.session.turn.change', kind: 'text' | 'binary' | 'oversized', path, display, before?, after?, hunks?, coarse? }`. 404 when the index or summary is gone.
- `GET /v1/agents/sessions/{id}/changes` (list per turn, for the panel's "Changes" view): `{ data: [{ turn_id, total, added, deleted }] }` for turns that still have a summary.
- Security note from DSH: a diff serves the whole text of files outside the workspace too (for example `~/.bashrc` if the agent edited it). The API drops files whose `path` is absolute (outside the workspace) from both the summary and the diff route. The count still includes them, as "n files outside the workspace".

### Sandbox chats

DSH's recorder runs git through the **host** `subprocess` and `fs` services. In a sandbox chat the tools run in the sandbox, so the host recorder probably sees an empty `/workspace` and records nothing (or only what host file tools touched). **Spike before building** (plan task 5): run one sandbox turn that edits a file and read the summary.

If the spike confirms it does not work, the API records sandbox turns itself, the same way DSH does, but inside the sandbox through envd:

- At `turn/start`: `git --git-dir=/tmp/agentry-changes/<session>.git --work-tree=/workspace add -A && write-tree` (a shadow repo, created on first use with `git init --bare`; a `.git` the user owns is never touched). The tree id is kept in memory per turn.
- At `turn/end`: the same, then `diff-tree --numstat` for the summary. A diff reads `git diff <before> <after> -- <path>` and parses hunks into the same shape.
- Limits: 30 s per git call, 500 files, 2 MB per file (DSH defaults). A failure skips that turn with a log line.
- This is `src/history/sandbox-changes.ts` in the API, behind the same routes. Snapshots live in the sandbox's `/tmp` and go away with Reset or Stop.

### Web

- A **Changes card** at the end of each finished turn. `Conversation.tsx` already keys its turn entries by `turnId` (the `group-${entry.turnId}` rows); the card renders after a turn's last entry. Session-wide delivered files (`SessionArtifacts`, at the chat's end) stay where they are. The card reads: "3 files changed +42 −7". Expanded: one row per file with `+a −d`. Click opens the diff in the panel.
- The card loads when the turn completes (and once on history load for the last 20 turns, lazily as they scroll into view). No polling.
- **Diff tab** in the panel: tab key `diff:<turn_id>:<index>`, title `<name> (changes)`. Unified view by default: line numbers, `+`/`−` lines tinted with the theme's success/danger tokens, three context lines, collapsed gaps between hunks. Header actions: Open file (switches to the file tab), Copy patch, Close. `binary` and `oversized` show a one-line notice and Open file.
- Store: `PanelState` gains `diffs: { key, turnId, index, title }[]`; `active` may be `diff:<key>`. Reducers `openDiff`, `closeDiff`.
- The Start page gains a third card, **Changes**, listing turns with changes (from `/changes`), newest first.

## Part 3: browser tab

Two different needs; only the first is in this spec.

1. **A public web page** (a link the agent gave). A browser tab with an address bar, Back, Forward, Reload, Open outside. The page loads in `<iframe sandbox="allow-scripts allow-forms allow-popups">` (no `allow-same-origin`). Chat links open here when the user turns on "Open links in the side panel" (a setting, off by default). Many sites refuse framing (`X-Frame-Options`); the tab cannot detect that reliably, so it always shows "Page blank? Open it in a new tab" under the address bar. HTTP is upgraded to HTTPS. The page CSP in `next.config.ts` has no `frame-src`, so it falls back to `default-src 'self'` and blocks outside pages; add `frame-src 'self' https:`.
2. **A web app running in the sandbox** (`npm run dev` on port 3000). This needs a port proxy: browser → BFF → API → sandbox relay → port. Serving it from the app's own origin would let the sandbox page read the app's cookies, so it needs its own origin (a wildcard subdomain or a second port). This is a separate spec. It is the most useful part for coding chats, so it is listed in Open questions.

Store: `browsers: { key, url, history: string[], index }[]`, `active` may be `web:<key>`. Start page gains **Web page**.

## Part 4: live file tree (file watches)

### API

`GET /v1/agents/sessions/{id}/artifacts/watch` (SSE).

- Events: `changed` `{ paths: string[] }` (workspace-relative, deduplicated, sent at most every 500 ms), `reset` `{}` (too many changes in one window, over 200 paths: reload everything), `: ping` every 15 s.
- Sandbox chats: envd `filesystem.watchDir({ path: dir, recursive: true })` through the provider. New provider method `watch(record, signal): AsyncIterable<string[]>`. The sandbox may stop; the stream then ends with `event: closed` and the web falls back to idle refresh.
- Local chats: Node `fs.watch(dir, { recursive: true })` (supported on Linux since Node 20), with the same skip list as `listEntries` (`node_modules`, `.git`, `__pycache__`, ...).
- One watcher per session shared by all readers; it stops 30 s after the last reader leaves. At most 8 watchers per owner (429 beyond).
- BFF: an SSE route like `app/api/agentry/sessions/[id]/stream/route.ts`, without `Last-Event-ID` (a reconnect starts a fresh watch and the web reloads the listing once).

### Web

- `src/preview/use-file-watch.ts`: opens the stream only while the panel is open, reconnects with the existing backoff (1 s doubling to 30 s), and gives `onChange(paths)`.
- On `changed`: reload the listing (debounced 1 s). If the open file is in `paths`, bump its `reloadKey`; if the user has scrolled, keep the scroll position. On `reset`: reload the listing and the open file.
- The idle-refresh effect stays as the fallback.

## Order and size

| Part | Backend work | Web work | Needs a spike |
|---|---|---|---|
| 1 Office | small (one route) | small | yes, short |
| 2 Changes (local chats) | medium (three routes) | medium | no |
| 2 Changes (sandbox chats) | medium (git over envd) | none | yes |
| 4 Watch | medium | small | no |
| 3 Browser (public pages) | none | small | no |

Suggested order: 1, 2 local, spike 2 sandbox, 4, 3.

## Testing

- API: unit tests for the turn-number to turn-id mapping, the outside-workspace filter, the error code mapping, the watch debouncer; gateway tests with fake `officeToPdf` and `workspaceChanges` services; OpenAPI drift and contract tests.
- Web: unit tests for the new renderer choices, store reducers, hunk-to-rows layout and the watch debounce; component tests for the Changes card, the Diff tab, the Office error states and the browser tab's iframe `sandbox` attribute (never `allow-same-origin`).
- No new e2e until the merge run.

## Out of scope

Editing files, accepting or reverting a turn's changes (needs a write route and conflict rules), side-by-side diffs, the sandbox port proxy, git worktree views, changes for subagent sessions (DSH does not record them), changes after an API restart.

## Open questions

1. **Sandbox port preview** (a dev server inside the sandbox in the browser tab): wanted soon? It needs a separate origin for safety, which means DNS or a second port in every deployment.
2. **docx default:** PDF (exact layout, slower, needs the converter) or mammoth HTML (fast, loose layout)? The design picks PDF with mammoth as "Text".
3. **xlsx:** PDF pages follow print settings and often look poor. Add an in-browser sheet view now (`exceljs`, MIT, lazy loaded, 2,000 rows cap) or keep PDF for now?
4. **Changes after a restart:** DSH keeps them in memory only. Is losing them on restart acceptable (DSH's choice), or should the API persist summaries and diffs (disk per session)?
5. **Files outside the workspace in a diff:** hide them (the design) or show them to the owner?
6. **Links in the side panel:** default off (the design) or on?
