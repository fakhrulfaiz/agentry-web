# F3 remainder: live file tree and xlsx sheet view

Status: draft for approval, 2026-11-28. Extends `docs/superpowers/specs/2026-11-26-f3-workspace-panel-design.md`. Persistence of changes across API restart is deferred.

## Intent

Finish the remaining P2 F3 workspace-panel items the user picked now: the file tree should update while the agent works, and spreadsheets should be readable in the panel without downloading.

## Scope

**In:**
1. **Live file tree / file watch** (spec Part 4). Follow existing plan Part 4, Tasks 13-14 in `docs/superpowers/plans/2026-11-26-f3-workspace-panel.md`.
2. **Xlsx sheet view** (revises spec open question 3, which chose "PDF for now"). Approach 1A.

**Deferred (explicit):**
- Changes kept across API restart (spec open question 4 stays memory-only for now).
- Public-page browser tab (Part 3, another session).
- Sandbox port preview follow-ups beyond what's already done.

## 1. Live file tree

No new design decisions; implement the existing plan:

- **API**: `GET /agents/sessions/:session_id/artifacts/watch` SSE. `WatchHub` debounces 500 ms, >200 paths in a batch becomes `reset`, source stops 30 s after last subscriber, max 8 watched sessions per owner (429 `too_many_watches`). Sandbox: envd `WatchDir` recursive, skip `SKIP_DIRS`, relative paths. Local: `fs.watch` recursive. Events: `changed {paths}`, `reset`, `closed`, comment ping every 15 s. Route placed before `artifacts/*path`.
- **Web**: BFF route mirroring stream route shape (no `Last-Event-ID`), `useFileWatch(sessionId, enabled, onChange)` with EventSource reconnect 1s doubling to 30s, `closed` stops reconnect until enabled flips. `PreviewPanel`: on `changed` debounce 1s then `load()`; if active file path is in changed paths bump `reloadKey`; on `reset` do both; keep idle-refresh fallback.

Security/behavior constraints from plan: owner-scoped, BFF never exposes credentials, no leaked watchers, static `watch` segment wins over catch-all.

## 2. Xlsx sheet view (1A)

### Decision

Use `exceljs` in the browser, lazy-loaded. Parse workbook client-side and render a read-only grid with sheet tabs. No new API route; bytes come from the existing artifact BFF route.

### Rendering

- `renderers.ts`: `xls`/`xlsx` become `pick('sheet', 'officePdf', 'download')` (sheet first; PDF remains available; download fallback).
- New renderer id `sheet` in `RendererId`. `PreviewPanel` maps it to preview side; kind label "Table" / table icon like CSV.
- `SheetView` loads bytes via `fetch(fileUrl(sessionId, path))` (arrayBuffer), dynamically imports `exceljs`, parses workbook.
- UI: sheet tabs when workbook has multiple sheets; table/grid with sticky header row; cell values rendered as text (numbers, strings, dates formatted readably; formulas show cached result when present, else empty). No editing, no styling fidelity beyond readable table.
- Limits: first 2,000 rows and 50 columns per sheet; show a Banner when truncated ("Showing first 2,000 rows / 50 columns. Download for the full file."). Files over existing text/byte limits follow the same missing/error handling as other views.
- Errors: parse failure shows Banner with "Could not read this spreadsheet." + Download button + Retry.

### Dependencies

- Add `exceljs` as an exact-version dependency in `agentry-web` (check license MIT; confirm bundle is lazy-loaded only by the sheet renderer). If bundle/runtime is problematic in browser, fall back to `xlsx` (SheetJS CE) after license check - but default is exceljs per spec decision.

### Accessibility / UI

- Use astryx components/tokens for controls (sheet tabs, banners, buttons). Table is plain semantic `<table>` with StyleX layout glue, like the existing CSV table. No raw hex/px.

## Testing

- **API (live file tree):** fake-timer/fake-source unit tests for WatchHub debounce/reset/unsubscribe/429; gateway route test for SSE owner scoping and 404 for other owner. OpenAPI drift.
- **Web (live file tree):** `useFileWatch` unit tests with fake EventSource (changed/reset/error reconnect/disable closes). PreviewPanel behavior covered by targeted component test if needed.
- **Web (xlsx):** unit test for renderer choice (`xlsx` -> sheet default). Component test for SheetView: renders rows/cells, sheet tabs, truncation banner, parse error banner. Use a small fixture workbook generated in test (exceljs can write in node).

## Out of scope

- Changes persisted across API restart.
- Editing spreadsheets.
- Full Excel fidelity (merged cells, charts, conditional formatting, rich styles).
- Browser tab (Part 3 public pages).
- Sandbox port preview follow-ups.

## Docs / bookkeeping

- Update `CHANGELOG.md` in each touched repo.
- Update `AGENTS.md` backlog item 5 / P2 F3 remainder status when shipped.
- Add `docs/changes/2026-11-28-workspace-watch.md` in API if new route added (per plan convention) and note sheet view in web changelog.
