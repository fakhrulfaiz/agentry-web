# Preview panel (design)

Status: 2026-11-10, draft for review. Not implemented.

## Goal

A Claude-style right-hand panel in the chat page that previews the files an agent produced, and shows the session sandbox's file tree beside them (as DeepSeek's web sidebar does). It replaces the Artifacts modal as the way to look at a file.

## Understanding

- Users want to open a file from the chat and read it rendered (Markdown, HTML, images, PDF, tables, code) without leaving the conversation.
- DeepSeek's web client (`deepseek-harness/packages/client/ui-sidebar-{right,files,documentpreview}`) is the behavioural reference: a docked right sidebar, a Files tab with the workspace tree, preview tabs with a path header, renderer dropdown, wrap and reload, and an optional tree beside the preview. Behaviour is copied, not code.
- "Work tree" means the sandbox file tree, not git worktrees.
- v1 uses only existing endpoints; there is no backend change.

## Existing pieces reused

- `GET /api/agentry/agents/sessions/{id}/artifacts` lists the whole workspace (flat `path`, `size`, `last_modified`).
- `GET /api/agentry/agents/sessions/{id}/artifacts/{path}` streams bytes (`?download=1` forces attachment); the BFF sets the MIME from `src/artifacts/kind.ts`.
- `isPresentedArtifact()` hides `uploads/`, dot paths and `__pycache__`.
- `SessionArtifacts` / `FileCard` (chat file cards) and `ArtifactsPage` are the entry points.
- `Markdown.tsx` renders Markdown (KaTeX included).

## Layout and behaviour

- `Conversation` becomes two columns when the panel is open: chat and panel. The panel width is resizable (drag edge, arrow keys), clamped, and remembered in `localStorage` (guarded). Below 768px the panel is a full-screen overlay. Escape closes the panel when focus is inside it.
- Open triggers: a file card in the chat, a "Files" button in the chat header, an Artifacts page row (which links to the chat with `?file=<path>` and opens the panel there). The Artifacts modal is removed.
- Panel state lives in a client store scoped to the open session: `open`, `tabs[]`, `activeTab`, `treeVisible`, `width`. Closing the panel keeps tabs for the session; switching chats resets them.
- Tabs: a fixed **Files** tab (the tree, full width) and one tab per opened file. Opening a file replaces the current unpinned preview tab; double-clicking a tab or its pin icon keeps it. Tab close buttons are keyboard reachable.
- A toggle in the preview header shows the tree beside the file (a narrow column, 260px, resizable), highlighting the open file. Where the panel is narrower than 560px the tree overlays instead.

## File tree

- `src/preview/tree.ts` (pure): builds a nested tree from the flat listing, folders first then files, natural sort, using `isPresentedArtifact` to hide tooling paths.
- Refreshes when a turn ends (the chat already knows when the session goes idle) and on manual reload; keeps expansion state per session.
- Rows show a file-type icon (reusing `artifactKind`), name, and size in the tooltip. Keyboard: arrows, Enter opens, Left/Right collapse/expand (ARIA `tree`).

## Renderers

`src/preview/renderers.ts` picks a renderer id from the extension and offers alternatives for the header dropdown:

| Extension | Default | Alternatives |
|---|---|---|
| `md`, `markdown` | Markdown (rendered) | Code, Text |
| `html`, `htm` | HTML (sandboxed live preview) | Source |
| `svg` | Image | Source |
| `png jpg jpeg gif webp` | Image | none |
| `pdf` | PDF iframe | none |
| `csv`, `tsv` | Table | Text |
| `json` | JSON tree | Code |
| known code extensions (`kind.ts` `CODE_EXTENSIONS`) | Code (highlighted, wrap toggle) | Text |
| other text MIME | Text | none |
| everything else (incl. `docx xlsx pptx zip`) | Download card | none |

- Text-like renderers read at most 200,000 characters (as today) and say so when truncated; Table caps at 2,000 rows with a notice; the download has the rest.
- Code highlighting uses `highlight.js` core with the languages in `CODE_EXTENSIONS` registered lazily (exact version, no `^`), loaded only when a code file opens, so the chat bundle is unchanged.
- Office files are a download card in v1. The renderer registry lets a later `docx/pptx` renderer (server conversion to PDF, a backend endpoint) and an `xlsx` renderer (in-browser) drop in without changing the panel.

## HTML safety

HTML renders in an `<iframe sandbox="">` (no `allow-scripts`, no `allow-same-origin`) with `srcdoc` built from the bytes the BFF returned, so agent-authored markup can neither run script nor reach the signed-in app's cookies or DOM. A "Run scripts" toggle (off by default, explained in a tooltip) adds `allow-scripts` only, still without `allow-same-origin`. Relative sub-resources do not resolve in `srcdoc`; the header notes "linked files do not load in preview" when the HTML references any. The page CSP (`next.config.ts`) needs `frame-src` unchanged because `srcdoc` frames inherit; verified at implementation.

## Header and actions

Path label (directories subdued, filename primary), renderer dropdown (hidden with one choice), wrap toggle (text renderers), reload, copy path, copy contents (text renderers), download, tree toggle, close tab. Reload refetches bytes and the listing.

## Components and files

- `src/preview/{tree,renderers,store}.ts`: pure logic and the panel store (unit tested).
- `src/ui/preview/PreviewPanel.tsx` (shell, tabs, resize), `FileTree.tsx`, `PreviewHeader.tsx`, `renderers/{MarkdownView,CodeView,ImageView,PdfView,HtmlView,TableView,JsonView,DownloadCard}.tsx`, one fetch hook `use-file-bytes.ts` (abort on change, size cap, error state).
- `Conversation.tsx` hosts the panel; `SessionArtifacts` and `FileCard` call `openFile(path)`; `ArtifactsPage` links to the chat; `ArtifactPreview.tsx` is deleted.
- Layout and controls from astryx components and tokens; StyleX only for layout glue, per the repo rules. No Anthropic name, mark or exact colours.

## Error handling

Failed or 404 reads show an inline error with Retry; a file removed by the agent between listing and open shows "File no longer exists" and refreshes the tree; an oversize file shows the truncation notice; an unknown type shows the download card.

## Testing

Kept light, per the user: unit tests for the tree builder and renderer selection only, one component test that the HTML iframe is sandboxed (no `allow-same-origin`) and that opening a file adds a tab, plus `pnpm typecheck`. No new e2e test.

## Out of scope (v1)

Office rendering, per-turn diffs and git worktree views, terminal and browser tabs, editing or saving files, floating or multi-pane docking, auto-refresh via file watches (v1 refreshes on turn end and manual reload).

## Open items to verify during implementation

- The existing listing's size and latency on a large workspace; if slow, list one level at a time (DeepSeek does) behind a new `?prefix=` filter, a backend follow-up.
- Whether `srcdoc` frames pass the current CSP unchanged.
