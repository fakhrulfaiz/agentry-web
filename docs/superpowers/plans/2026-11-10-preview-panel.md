# Preview Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A right-hand preview panel in the chat page that previews session files (Markdown, code, images, PDF, sandboxed HTML, CSV/JSON tables) and shows the sandbox file tree beside them.

**Architecture:** Pure logic (`src/preview/`) holds the tree builder, renderer picker and panel store. UI (`src/ui/preview/`) holds the panel shell, tree, header and one small component per renderer. `Conversation` hosts the panel; file cards and the Artifacts page call `openFile`. All bytes come from the existing BFF artifacts route; no backend change.

**Tech Stack:** Next.js App Router, React 19, astryx + StyleX, Vitest. New dependency: `highlight.js` (exact version, no `^`).

**Spec:** `docs/superpowers/specs/2026-11-10-preview-panel-design.md`

## Global Constraints

- Exact dependency versions, no `^`/`~`.
- UI from astryx components and tokens; StyleX only for layout glue; no raw hex/px, no `className`/`style` (the existing code's few `style` uses for iframes/img are the only exception).
- Browser code never sees Agentry credentials; bytes only via `/api/agentry/agents/sessions/{id}/artifacts/{path}` (`artifactUrl()` in `src/artifacts/kind.ts`).
- Text renderers read at most 200,000 characters; Table caps at 2,000 rows; both say so.
- HTML renders in `<iframe sandbox="">` via `srcdoc`; never `allow-same-origin`. "Run scripts" adds only `allow-scripts`.
- Office types (`docx xlsx pptx zip`, any unknown binary) show a download card only.
- Update `CHANGELOG.md` (dated bullet). Run shells with `export PATH=$HOME/.nvm/versions/node/v24.19.0/bin:$PATH`. No Co-Authored-By or AI attribution in commits; author `fakhrulfaiz <fakhrulfaiz2003@gmail.com>`.
- Testing stays light (user's call): unit tests for tree and renderer picker, one component test, `pnpm typecheck`. No new e2e.

## Review Focus

- A path with spaces, `#` or unicode must open (encode per segment via `artifactContentUrl`).
- An empty workspace shows an empty-state in the tree, not a blank panel.
- A 404 on open (agent removed the file) shows "File no longer exists" and refreshes the tree.
- A huge file is truncated with a notice rather than freezing the tab.
- HTML containing `<script>` must not execute by default and must not read the parent's cookies.

---

### Task 1: Tree builder and renderer picker (pure logic)

**Files:**
- Create: `src/preview/tree.ts`, `src/preview/renderers.ts`
- Test: `tests/unit/preview-tree.spec.ts`, `tests/unit/preview-renderers.spec.ts`

**Interfaces:**
- Produces:
  - `type TreeNode = { name: string; path: string; kind: 'dir' | 'file'; size?: number; children: TreeNode[] }`
  - `buildTree(entries: { path: string; size?: number }[]): TreeNode[]` — drops paths failing `isPresentedArtifact`, nests by `/`, folders first, then natural (numeric-aware, case-insensitive) name order.
  - `type RendererId = 'markdown' | 'code' | 'text' | 'image' | 'pdf' | 'html' | 'source' | 'table' | 'json' | 'download'`
  - `renderersFor(name: string): { default: RendererId; options: RendererId[] }` per the spec's table (`options` includes the default; length 1 hides the dropdown).

- [ ] **Step 1: Write the failing tests.** Tree: input `['b/x.md','a.txt','b/y.md','.venv/z','uploads/u.png','file10.txt','file2.txt']` gives roots `b` (dir) then `a.txt`, `file2.txt`, `file10.txt`; `.venv` and `uploads` absent; `b` has children `x.md`, `y.md`; empty input gives `[]`. Renderers: `a.md` → default `markdown`, options `['markdown','code','text']`; `a.html` → `html`, `['html','source']`; `a.png` → `image` only; `a.csv` → `table`, `['table','text']`; `a.json` → `json`, `['json','code']`; `a.py` → `code`, `['code','text']`; `a.docx` and `a.bin` → `download` only; `a.PDF` (uppercase) → `pdf`.
- [ ] **Step 2: Run** `pnpm vitest run tests/unit/preview-` — Expected: FAIL (modules missing).
- [ ] **Step 3: Implement** both modules per the signatures; reuse `isPresentedArtifact`, `CODE_EXTENSIONS` (export it from `src/artifacts/kind.ts`) and a lowercase extension helper.
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Commit** `feat(preview): tree builder and renderer picker`.

### Task 2: Panel store and file-bytes hook

**Files:**
- Create: `src/preview/store.ts`, `src/preview/use-file-bytes.ts`
- Test: `tests/unit/preview-store.spec.ts`

**Interfaces:**
- Produces:
  - `type PanelState = { open: boolean; tabs: { path: string; pinned: boolean }[]; active: 'files' | string; treeVisible: boolean; width: number }`
  - Pure reducers: `openFile(s, path): PanelState` (opens the panel; reuses/replaces the single unpinned tab, else appends; activates it), `pinTab(s, path)`, `closeTab(s, path)` (falls back to `'files'`), `showFiles(s)`, `setWidth(s, px)` (clamp 320–900), `toggleTree(s)`, `closePanel(s)`, `initialState(): PanelState` (width 480).
  - `usePreviewPanel(sessionId: string | null): { state: PanelState; actions: {…the reducers bound} }` — React context provider `PreviewPanelProvider` plus hook; state resets when `sessionId` changes; width persisted to `localStorage` key `agentry-preview-width` inside try/catch.
  - `useFileBytes(sessionId: string, path: string, mode: 'text' | 'binary-url', reloadKey: number): { status: 'loading' | 'ok' | 'missing' | 'error'; text?: string; truncated?: boolean }` — fetches `artifactUrl`-style URL with `AbortController`, truncates text at 200,000 chars, maps 404 to `missing`.

- [ ] **Step 1: Write the failing test** for the reducers: `openFile` on empty state opens panel with one unpinned tab and `active` = that path; a second `openFile` replaces the unpinned tab; after `pinTab` the second `openFile` appends; `closeTab` of the active tab returns `active: 'files'`; `setWidth(s, 5000)` clamps to 900.
- [ ] **Step 2: Run** `pnpm vitest run tests/unit/preview-store.spec.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** reducers, provider/hook and `useFileBytes` (bytes URL via `artifactContentUrl` + `/api/agentry` prefix as `artifactUrl` does).
- [ ] **Step 4: Run** the test — Expected: PASS.
- [ ] **Step 5: Commit** `feat(preview): panel store and file hook`.

### Task 3: Renderers

**Files:**
- Create: `src/ui/preview/renderers/{MarkdownView,CodeView,TextView,ImageView,PdfView,HtmlView,SourceView,TableView,JsonView,DownloadCard}.tsx`, `src/ui/preview/renderers/index.tsx`
- Modify: `package.json` (add `highlight.js` at an exact version, e.g. `11.11.1`)
- Test: `tests/component/preview-renderers.spec.tsx`

**Interfaces:**
- Consumes: `useFileBytes`, `RendererId`, `Markdown` from `src/ui/chat/Markdown.tsx`.
- Produces: `RendererBody({ id: RendererId, sessionId: string, path: string, reloadKey: number, wrap: boolean, runScripts: boolean }): JSX.Element` that switches on `id`. Text-based views show a `Banner` when `truncated` and Retry on `error`; `missing` shows "File no longer exists" and calls an `onMissing?: () => void` prop (added to `RendererBody`). `CodeView` imports `highlight.js/lib/core` and registers languages lazily with dynamic `import()` per extension. `HtmlView` renders `<iframe sandbox={runScripts ? 'allow-scripts' : ''} srcdoc={text} title={path}>`. `TableView` parses CSV/TSV with a small in-file parser (quotes, commas) and caps at 2,000 rows with a notice. `JsonView` pretty prints parsed JSON as a collapsible tree (`<details>`), falling back to text on a parse error.

- [ ] **Step 1: Write the failing component test**: mock `fetch`; render `RendererBody` with `id='html'`; assert the iframe has `sandbox=""` and no `allow-same-origin`; with `runScripts` it is exactly `allow-scripts`. Render `id='table'` with 3 rows and assert 3 body rows; render with a 404 and assert "File no longer exists" and `onMissing` called.
- [ ] **Step 2: Run** `pnpm vitest run tests/component/preview-renderers.spec.tsx` — Expected: FAIL.
- [ ] **Step 3: Implement** the renderers and `RendererBody`; `pnpm install` for `highlight.js` (pin exact in `package.json`).
- [ ] **Step 4: Run** the test — Expected: PASS.
- [ ] **Step 5: Commit** `feat(preview): file renderers`.

### Task 4: Panel shell, tabs, tree UI, header

**Files:**
- Create: `src/ui/preview/{PreviewPanel,FileTree,PreviewHeader}.tsx`
- Test: `tests/component/preview-panel.spec.tsx`

**Interfaces:**
- Consumes: `usePreviewPanel`, `buildTree`, `renderersFor`, `RendererBody`, `api.listSessionArtifacts(id)`.
- Produces: `PreviewPanel({ sessionId: string, idle: boolean })`. Shows nothing when `!state.open`. Fixed Files tab plus one tab per open file (close button, pin on double-click). Files tab: `FileTree` (ARIA `tree`, arrow/Enter/Left/Right keys, expansion kept in component state, empty state "No files yet", refetch when `idle` flips to true and via a reload button). A file tab: `PreviewHeader` (path with subdued directories, renderer dropdown hidden when one option, wrap toggle for text renderers, Run scripts toggle for HTML only, reload, copy path, download via `artifactUrl(…, true)`, tree toggle, close) over `RendererBody`; with `treeVisible` the tree shows in a 260px column beside it (overlay under 560px panel width). Resizable left edge (drag + arrow keys) calling `setWidth`; Escape inside the panel closes it; under 768px viewport it renders full-screen.

- [ ] **Step 1: Write the failing test**: render `PreviewPanel` inside `PreviewPanelProvider` with `listSessionArtifacts` mocked to two files; call `openFile('a.md')` via the hook; assert a tab titled `a.md` and the renderer region appear; opening `b.py` replaces that tab (unpinned); Escape closes the panel.
- [ ] **Step 2: Run** `pnpm vitest run tests/component/preview-panel.spec.tsx` — Expected: FAIL.
- [ ] **Step 3: Implement** the three components with astryx layout components (read each with `pnpm exec astryx component <Name>` first; the Artifacts page and `SessionArtifacts` show house style).
- [ ] **Step 4: Run** the test — Expected: PASS.
- [ ] **Step 5: Commit** `feat(preview): panel, tree and header`.

### Task 5: Wire into chat and Artifacts; remove the modal

**Files:**
- Modify: `src/ui/chat/Conversation.tsx` (wrap the chat column and `PreviewPanel` in an `HStack` inside `PreviewPanelProvider`; add a "Files" button in the chat header that calls `showFiles`; open `?file=` from the URL once), `src/ui/chat/SessionArtifacts.tsx` (`FileCard` click calls `openFile(path)` instead of the dialog), `src/ui/artifacts/ArtifactsPage.tsx` (row click navigates to `/c/{session_id}?file={path}`), `src/ui/chat/MessageFiles.tsx` if it uses the dialog
- Delete: `src/ui/artifacts/ArtifactPreview.tsx`
- Modify: `CHANGELOG.md`, `AGENTS.md` (Backlog item 5: panel landed; remaining diffs/Office)
- Test: update `tests/component/` specs that reference the dialog (find with `grep -rl ArtifactPreview tests src`)

**Interfaces:**
- Consumes: `usePreviewPanel().actions.openFile`.

- [ ] **Step 1: Update/adjust the affected existing tests first** to expect panel behaviour (a card click opens the panel tab, not a dialog); run them and confirm they fail.
- [ ] **Step 2: Implement** the wiring and delete `ArtifactPreview.tsx`; keep `Conversation` untouched on narrow layout beyond the two-column wrap.
- [ ] **Step 3: Run** `pnpm typecheck` and `pnpm vitest run --no-file-parallelism` — Expected: all pass except the two known failures listed in `AGENTS.md`.
- [ ] **Step 4: Add the CHANGELOG bullet and AGENTS.md note.**
- [ ] **Step 5: Commit** `feat(preview): open files in the chat's right panel`.

### Task 6: Manual check

- [ ] **Step 1:** With the dev server running and a chat that has files, open a `.md`, `.html` (confirm a `<script>` does nothing), `.csv`, `.png` and `.pdf`; toggle the tree; resize; reload the page and confirm the width persisted. Note anything that fails; do not claim it works unchecked. (Browser tooling is unavailable here, so the user may need to do this pass.)
