# Agentry Web — agent guide

Read this first in every session. `CLAUDE.md` is a symlink to this file; edit `AGENTS.md`.

## What this is

**Agentry Web**: the claude.ai-style frontend for Agentry. Next.js (App Router) + astryx design system + StyleX, with a backend-for-frontend (BFF) that keeps every Agentry credential out of the browser. Backend: Agentry API in `~/code/dsh-agents-api` (`@agentry/api`, OpenAI Agents API–compatible; see its `AGENTS.md`).

## Status

- F1 (shell + sign-in + chat): **implemented** on `feat/f1` (all 8 plan tasks). The final whole-branch review is done and its fixes are in (Markdown images, Keycloak refresh/logout hardening, stream snapshot ordering, security headers). **Pending:** the manual Keycloak live check (README "Keycloak live check") and the live check against a real Agentry (`docs/live-check.md`).
  - Spec: `docs/superpowers/specs/2026-11-08-agentry-web-f1-design.md`
  - Plan: `docs/superpowers/plans/2026-11-08-agentry-web-f1.md` (8 tasks)
- F1.1 (chat fidelity): **implemented** on `feat/f1-1` and through its final review fix wave. Live reasoning and tool cards from the real backend's item log, expandable subagent cards, the Trajectory view (ledger, overview, Event details), the full-featured composer (model and effort for new chats and mid-chat, slash-command slot), chat title menu with starred chats, and less rounded inputs. Pinned by fixtures recorded from the live backend (`tests/fixtures/live/`).
  - Plan: `docs/superpowers/plans/2026-11-09-f1-1-chat-fidelity.md`
- Agentry Sandbox (2026-11-24, backend only): separate service `~/code/agentry-sandbox` (Docker, E2B envd, egress guard, configurable limits) is the API's `sandbox` environment provider; chats on a sandbox environment run every tool inside it (plan `docs/superpowers/plans/2026-11-25-agentry-sandbox-integration.md`, spec `docs/superpowers/specs/2026-11-25-agentry-sandbox-design.md`). Plan 3 (web, 2026-11-24, complete): named environments with live sandbox state, Start/Stop/Reset and New chat here on the detail page, the two-pane template editor (software, startup, variables, internet and CPU/memory limits), "Runs on" choices in plain words with availability, the Providers tab with the standard image's software, and provider and state in the composer's environment menu. Dev: start `agentry-sandbox` before the API and set `AGENTRY_SANDBOX_URL`/`AGENTRY_SANDBOX_KEY` for it. User guide (setup, tutorial, limits, API, troubleshooting): `docs/sandboxes.md`.
- Agents page (2026-11-10): saved agents CRUD at `/agents`, bundled starters, agent menu in new chats, per-agent app grants enforced by the API (spec `docs/superpowers/specs/2026-11-10-agents-page-design.md`). Done 2026-11-28 (spec `2026-11-26-agents-import-and-owner-connectors-design.md`): import from a GitHub/gist link or pasted text, Export (JSON/Markdown), Save as agent on a subagent card, connector keys in the API (every session, scheduled runs included), BFF soft app note removed. Not yet: delegating to a saved agent by name, deleting `src/server/connectors-store.ts` once no file entries are left (it only migrates old keys now).
- Later specs: F2 admin, F3 artifacts/files, F4 trace inspector + subagent views (F4 also: keyboard access for the trajectory overview). Drafts 2026-11-26 (not built, open questions inside): F3 remainder `docs/superpowers/specs/2026-11-26-f3-workspace-panel-design.md` + plan `docs/superpowers/plans/2026-11-26-f3-workspace-panel.md`; F4 `docs/superpowers/specs/2026-11-26-f4-trace-inspector-design.md` + plan `docs/superpowers/plans/2026-11-26-f4-trace-inspector.md`.

## Working-tree provenance (2026-11-10)

Parts of the current uncommitted work under `main` were authored by a different agent session (skills/commands `/` menu, the Artifacts page, the scheduled-list restyle and wire-type updates, fonts, the thinking row and single-scrollbar fixes — see their CHANGELOG entries). Commits per the user's call come later; until then:

- Scheduled tasks detail page (`/scheduled/{id}`, `src/ui/scheduled/ScheduleDetail.tsx` + route + `tests/component/schedule-detail.spec.tsx`): authored 2026-11-10 in a separate session (mockups: claude.ai detail + DeepSeek automation panel).
- `tests/component/slash-menu.spec.tsx` mock typing was fixed by the detail-page session so `pnpm typecheck` passes.
- Artifacts rewiring (2026-11-10, this session): the other agent's Artifacts page was built against the F3 cowork spec (`GET /v1/agents/artifacts`), which the backend never implemented; `src/api/client.ts` (`listSessionArtifacts`), `src/api/types.ts` (`SessionArtifactEntry/List`, slimmed `Artifact`), `src/artifacts/{artifact.ts,kind.ts}`, `src/ui/artifacts/*`, `src/ui/chat/SessionArtifacts.tsx`, `src/server/{allowlist.ts,artifact-bytes.ts}` and `app/api/agentry/agents/sessions/[id]/artifacts/[...path]/route.ts` (the old `agents/artifacts/[id]/content` route is deleted) now speak the backend's per-session endpoints. Suite flakiness (reveal, schedule-detail, agent-form, sandboxes hitting the 5s timeout) was CPU contention from one worker per core on heavy jsdom renders; `vitest.config.ts` now sets `maxWorkers: 3` (2026-11-26). If a full run still times out on a loaded machine, use `--no-file-parallelism`.
- The cards 403 test and the trajectory draft test listed here earlier pass (checked 2026-11-26; the 403 test's dynamic import is now static).

## Resume / start the F1 plan

In a Claude Code session opened in `~/code/agentry-web`, say:

> Execute docs/superpowers/plans/2026-11-08-agentry-web-f1.md with subagent-driven-development (implementers on Opus, reviewers on Sonnet).

Progress is tracked in the plan's ledger under `.superpowers/sdd/` (git-ignored); if one exists, resume from it instead of restarting.

## Rules

- Never add `Co-Authored-By` or any AI attribution to commits or PRs. Commit as `fakhrulfaiz <fakhrulfaiz2003@gmail.com>`.
- Follow the plan's Global Constraints (below).
- Update `CHANGELOG.md` with every behavior change (dated bullet).

## Global Constraints (from the F1 plan)

- Browser JavaScript, storage, and requests to the web app never contain an Agentry access token, refresh token, or API key.
- Cookie `agentry_session`: `httpOnly`, `SameSite=Lax`, `Secure` in production when the request came over HTTPS (`X-Forwarded-Proto`; `AGENTRY_WEB_COOKIE_SECURE=always` forces it, decided 2026-11-25 so plain-HTTP deployments on a LAN address can sign in); secret `AGENTRY_WEB_SESSION_SECRET` ≥ 32 bytes, required at startup.
- `AGENTRY_WEB_AUTH` ∈ `keycloak` | `apikey`; keycloak mode requires `AGENTRY_WEB_KEYCLOAK_ISSUER`, `AGENTRY_WEB_KEYCLOAK_CLIENT_ID`, `AGENTRY_WEB_KEYCLOAK_CLIENT_SECRET`; `AGENTRY_API_URL` is required and server-only. Missing or invalid values fail startup with a named error (`ConfigError`).
- Proxy allow-list only (spec §5); other paths answer `404`. State-changing calls need same-origin plus an `x-agentry-csrf` header matching the session's CSRF token.
- Reconnect backoff: 1s doubling to a 30s cap; always resend `Last-Event-ID`.
- UI from astryx components and tokens; StyleX only for layout glue; no other CSS framework. Branding "Agentry"; no Anthropic name, logo, mark, licensed fonts, or exact colors.
- Exact dependency versions (no `^`/`~`) for astryx (`0.7.17`) and StyleX (`0.19.1`, including the `@stylexswc/*` compiler packages).

## Toolchain and commands

- The `pnpm` on the default WSL PATH is a Windows binary. Prefix shells with `export PATH=$HOME/.nvm/versions/node/v24.19.0/bin:$PATH` (Node 24, pnpm 11).
- Launchers (README "Running it"): `scripts/dev.sh` (`next dev`), `scripts/dev.sh image` (Docker image → `dist/agentry-web-<tag>.tar`), `scripts/start.sh` (deploys the newest tar as container `agentry-web`; `--no-docker` for `next start`). All check that the Agentry API is up first.
- Branches: work on `develop`; `main` only via a `develop` → `main` PR. CI (`.github/workflows/ci.yml`) runs typecheck + Vitest on pushes to `develop`, plus e2e and a Docker build on PRs to `main`; `publish.yml` releases on merge to `main`: image to GHCR, tag `v<version>`, GitHub Release. A release needs a new `package.json` version (the PR fails otherwise) and a `## <version>` CHANGELOG section for its notes.
- `pnpm dev` · `pnpm build` · `pnpm start` · `pnpm typecheck` · `pnpm test` (Vitest) · `pnpm test:e2e` (Playwright).
- pnpm 11 blocks dependency build scripts; decisions live in `pnpm-workspace.yaml` (`allowBuilds`).

## Project conventions

- Layout: routes in `app/` (repo root); all other code in `src/` (`src/config`, `src/server`, `src/api`, `src/chat`, `src/ui`). The `@/*` alias maps to `src/*` (tsconfig and Vitest).
- Configuration: read it only through `getConfig()` from `@/config/env` (server-only, memoized). `instrumentation.ts` validates it when the Node server starts and exits on a `ConfigError`. Pages and routes that call `getConfig()` must render dynamically so `pnpm build` works without env vars.
- Server-only modules import `server-only`; Vitest aliases it to `tests/stubs/server-only.ts`.
- Tests: `tests/unit/**/*.spec.ts` and `tests/component/**/*.spec.tsx` (Vitest, `node` environment by default; DOM tests start with `// @vitest-environment jsdom`), `tests/e2e/` (Playwright). Vitest does not compile StyleX: `tests/stubs/stylex-setup.ts` (a setup file) makes our `stylex.create()` return empty styles. `pnpm test:e2e` starts the mock API (port 4019) and `next dev` (port 3019, apikey mode) itself, so stop other dev servers first; Chromium needs its system libraries (`sudo pnpm exec playwright install-deps chromium` once).
- Styling: astryx ships prebuilt CSS (`app/globals.css` imports `reset.css` + `astryx.css`; the theme CSS is the prebuilt Agentry theme, see Theme). Our own `stylex.create()` code compiles with `@stylexswc/nextjs-plugin/turbopack`, and `@stylexswc/postcss-plugin` extracts it into the `@stylex;` directive in `app/globals.css`. The compiler only scans `app/` and `src/`, never `node_modules/@astryxdesign`.
- Theme: `src/ui/theme/brand.ts` defines the Agentry theme (`theme-neutral` re-coloured to a shadcn-style palette: blue accent `#3b82f6`, flat neutral greys, small radii, Inter for text and headings, JetBrains Mono for code); `pnpm exec astryx theme build src/ui/theme/brand.ts --out src/ui/theme/agentry.css` writes the generated `agentry.{css,js,d.ts}` (do not edit; rebuild after changing `brand.ts` or upgrading astryx). `src/ui/theme/AppTheme.tsx` applies it in the mode from the `agentry_theme` cookie (`system` | `light` | `dark`, helpers in `src/ui/theme/theme-cookie.ts`), read by `app/layout.tsx`. `src/astryx-themes.ts` is the CLI's theme registry and is not imported by the app.
- Shell: `app/(app)/layout.tsx` guards every signed-in page (`requirePageSession()`), renders `<meta name="agentry-csrf">`, and wraps pages in `src/ui/shell/Shell.tsx` (astryx `AppShell` + `Sidebar`). DOM tests import `tests/helpers/dom.ts` for jsdom's missing `<dialog>` methods.

## Reusable components (check here before building new UI; keep this list current)

Generic, reused pieces. New generic UI goes in `src/ui/shared/` with a one-line doc comment saying what it is; add it here.

- `src/ui/shared/IconTile.tsx`: coloured icon tile (agents, environments, cards).
- `src/ui/shared/FolderPicker.tsx`: Finder-style column folder browser (breadcrumb, lazy columns, new folder); takes any `listFolders(path)` loader (2026-11-28, used by the project dialog).
- `src/ui/shared/DefinitionRow.tsx`: label/value rows for About panels; `src/ui/shared/CopyButton.tsx`: copy-to-clipboard icon button (2026-11-28, Sandboxes detail).
- `src/ui/cards/EntityCard.tsx`: `EntityCard`, `CardGrid`, `Fact` for card grids (Agents, Sandboxes).
- `src/ui/preview/FileTree.tsx` + `src/preview/tree.ts`: keyboard-accessible file tree built from flat paths (`buildTree` takes a path filter; `FileTree` takes `renderEnd`, `emptyText`, `expandTop`).
- `src/ui/preview/renderers/index.tsx`: `RendererBody` previews a file by type (text, code, CSV, images, PDF, Office as PDF, video with cursor track).
- `src/ui/chat/Markdown.tsx`: Markdown with streaming support and Connect links.
- `src/ui/chat/Notice.tsx`, `ConnectionPill.tsx`: inline notices with retry; live/reconnecting pill.
- `src/ui/preview/BrowserCursor.tsx`: agent cursor, click ripple and focus outline over a page image.
- `src/ui/shell/session-actions.tsx`: chat Rename/Delete dialogs and the star toggle; `src/ui/shell/sidebar-view.ts`: sidebar Group by/Order by/Show helpers.
- `src/ui/chat/use-reduced-motion.ts`, `src/ui/chat/reveal.ts`: reduced-motion hook and text reveal.

## Priorities (review 2026-11-28; keep this list current)

All three repos (web, `~/code/dsh-agents-api`, `~/code/agentry-sandbox`). Size: S under half a day, M about a day, L several days, XL a week or more. When an item is solved, mark it DONE with the date (or delete it once released); add new items in priority order. Plan checkboxes in `docs/superpowers/plans/` are not kept up to date: judge status from merged code and CHANGELOG.

**P0 (risk or debt)**
- [x] DONE 2026-11-28: released web 0.4.0, API 0.4.0, sandbox 0.3.0 (merged by the user; CI and e2e green).
- [x] DONE 2026-11-28, live checks: jobs in the Tasks tab (API list, Tasks row with timer, live output tab, Stop); recording playback (found and fixed: the API sent no `Content-Length`, so videos could not seek); Composio read tools (found and fixed: the Composio relay route never matched DSH's web server, so Composio was disconnected in every new chat since the relay landed; `gmail_search_emails` now works in one call).
- [x] SKIPPED 2026-11-28 (user's decision): live check of schedule tools with two owners (needs `apiKeys` mode with a second key; unit tests cover the owner filter).
- [x] DONE 2026-11-28: sandbox chat with no host `/workspace` works (chat created, `pwd` → `/workspace` inside the sandbox).
- [x] DONE 2026-11-28: sandbox access and admin keys rotated in the API `.env`; sandbox service and API restarted on them.
- [x] DONE 2026-11-28: SSH-machine envd ports moved to 30000-30599, below Linux's ephemeral range (a real bug: envd could hit EADDRINUSE on a busy machine; it also made `tests/ssh-machine.spec.ts` fail while the dev stack ran). agentry-sandbox `develop`.
- [x] DONE 2026-11-28: Keycloak live check, README steps 1–7 all pass against a local Keycloak 26 (`agentry-keycloak` container on 127.0.0.1:8180, realm `agentry`, user `tester`; API accepts it with `AGENTRY_KEYCLOAK_ISSUER`, web in Keycloak mode on :3020).

**P1 (largest user-facing wins)**
- [x] DONE 2026-11-28: compact live steps while a turn runs (default; "Always show steps" keeps full detail). Not yet looked at in a live chat.
- [x] DONE 2026-11-28: open the chat stream in parallel with the history load (read only after items + snapshot).
- [x] DONE 2026-11-28: Sandboxes redesign (sections, status line, icon actions incl. New chat here, refresh on focus, detail page with Files tree / Terminal / Chats tabs and About panel).
- [x] DONE 2026-11-28: Sandboxes templates: Edit and Duplicate (icon actions, one editor dialog for new/edit/duplicate; the API does not return setup commands, variables or file contents, so Edit keeps them when left empty and Duplicate does not copy them).
- [ ] SKIPPED FOR NOW 2026-11-28 (user's decision): vision model route (spec `docs/superpowers/specs/2026-11-26-vision-model-route-design.md`; proposed answers: unknown modality = cannot see, vision-helper subagent as a spike, `deepseek-flash` as the vision model for now). M.
- [x] DONE 2026-11-28: sandbox snapshots in the service (workspace on every place, Docker disk, E2B disk/memory against the fake only, MCP tools), merged to agentry-sandbox `develop`, release 0.3.0.
- [x] DONE 2026-11-28: snapshots in the API and web (Snapshots tab: save, restore, new environment from a snapshot, delete; "Also delete its N snapshots" on environment delete). Follow-up: a snapshot picker in New environment and a list of snapshots of deleted environments on the Sandboxes page. S–M.
- [x] DONE 2026-11-28: download and upload for "Files only" snapshots (service `GET /v1/snapshots/{id}/download`, `POST /v1/snapshots/import`; API `.../snapshots/{id}/content`, `.../snapshots/import`; web icons in the Snapshots tab; checked live, the download is a valid .tar.gz of /workspace). Later: copy a disk snapshot to another location. M.
- [x] DONE 2026-11-28: small UI, duplicate recent files on the new-chat page; empty space under Instructions in the agent form.
- [x] DONE 2026-11-28: Projects live check through the UI (user).

**P2 (valuable, bigger)**
- [x] DONE 2026-11-28 (first slice): session start speed and prompt cache. MCP servers now mount in parallel in the API and `AGENTRY_DEBUG_TIMING=1` reports per-server and total mount durations (recipe in `docs/changes/2026-11-28-session-start-speed.md` there); live numbers were not recorded because the shared dev API was not restarted. `cached_tokens` already shows in the Trajectory. Remaining: generic MCP tool-list caching (only Composio is cached today) and prompt-prefix stability (DSH-owned sections). S–M.
- [ ] SKIPPED FOR NOW 2026-11-28 (user's decision): Publish a sandbox app (share publicly). Existing Preview covers simple temporary mockup/dashboard hosting; real public deployment (stable subdomain, no owner-credential bearer link, no expiry, keep-awake, WebSocket/HMR, rate limits/abuse protection, public listener) not needed now. Design note kept: API owns publish records/limits/keep-awake/public `*.apps.<domain>` listener; sandbox service stays internal; web only has Publish switch/list. M–L.
- [x] DONE 2026-11-28: e2e mock streams reasoning and tool items as item frames (`saveItem` in `mock/agentry-mock.ts`), like the API since 2026-11-26; the live thought count is strict again. User messages are still saved only.
- [x] DONE 2026-11-28 (live check below): sandbox port preview (plan `2026-11-28-port-preview.md`; Docker places, HTTP only, no WebSocket, absolute-path apps need a base path). Follow-ups: per-port subdomain origin, WebSocket/HMR, E2B per-port hosts, auto-open when the agent mentions localhost.
- [x] DONE 2026-11-28 (partial): F3 workspace panel remainder - live file tree/watch (SSE) and read-only xlsx sheet view (lazy `exceljs`, sheet tabs, 2000 rows/50 cols cap). Remaining: changes kept across an API restart (plan `2026-11-26-f3-workspace-panel.md`). M.
- [x] DONE 2026-11-28: Agents import and owner connectors (plan `2026-11-26-agents-import-and-owner-connectors.md`): sealed per-owner Composio keys in the API (`AGENTRY_SECRETS_KEY`) mounted on every session (skipped for agents allowing no apps), key moved from the web file store; import/export; Save as agent; BFF soft note removed. Live-checked (migration, direct API chat read Gmail, key absent from config/logs/SSE; link, folder and paste imports).
- [ ] Composio, dynamic instead of more hand-made tools (idea 2026-11-28): (1) learned shortcuts — after a successful Composio action, remember its slug and working argument shape per owner and list the top ~10 as one-liners in the prompt ("Known tools: GMAIL_FETCH_EMAILS(query, max_results) …") so the agent calls `COMPOSIO_MULTI_EXECUTE_TOOL` without `COMPOSIO_SEARCH_TOOLS`; unused ones age out; a few hundred tokens. (2) later, only if needed: auto-generate named tools for the owner's top 5–8 actions from Composio's schema with light defaults. Keep Gmail/Calendar named tools; stop adding apps by hand. Start with a read-only usage scan of chat history (slugs per app, frequency) and the connected-apps list. Context note: always-loaded cost today is only the meta tools; per-task cost is search results and action results (already trimmed: grants filter, small reads, workbench for big results). M.
- [x] DONE 2026-11-28: dark-mode and narrow-width pass on Agents, Sandboxes, Scheduled (only the scheduled detail page needed a fix).
- [ ] Split the API's `src/gateway.ts`. L.
- [ ] Tool-card images for shell results and subagent images after a restart (backlog 2). M.

**P3 (later, or waiting on the user's answers)**
- [ ] F2 Admin (`2026-11-26-agentry-admin.md`, 18 tasks, 8 open questions). XL.
- [ ] F4 Trace inspector (`2026-11-26-f4-trace-inspector.md`, 5 open questions). L.
- [ ] External coding-agent subagents (backlog 8; spike first). XL.
- [ ] Sandbox next (`agentry-sandbox` spec `2026-11-26-sandbox-next-design.md`, 9 open questions): Daytona/Modal places L, metrics and audit log M, MCP-made sandboxes in the web app M.
- [ ] Browser leftovers: IME and touch input while in control, copying out of the page, a per-chat browser switch in the composer. S–M.

## Backlog (agreed 2026-11-09; each needs its own spec)

Cowork capabilities beyond F1. Backend pieces live in `~/code/dsh-agents-api` (mirrored in its `AGENTS.md`).

1. **Skill picker.** `/name` in a message already invokes a DSH user-invocable skill (`dsh-tool-skill` scans user messages). Backend skill-catalog endpoint done 2026-11-10 (`GET /v1/agents/skills`); remaining: the `/` autocomplete menu in the composer. Skills come from `<workspace>/.agents/skills`, `$DSH_HOME/skills`, `~/.agents/skills`, a configured directory, and `skill-office`.
2. **Screenshots in tool cards.** Browser tools return images through the tool-result pipeline and attachment store. Backend image parts and serving, and thumbnails in tool cards (web), done 2026-11-26 (branch `fix/tool-images`). Subagent images after a restart done 2026-11-26 (durable subagents; API tool-image source reads child logs, API test `tool-images.spec.ts` covers restart). Remaining: shell/`command_execution` results carry no images (`docs/changes/2026-11-26-tool-images.md` in API says so; `OAICommandExecutionItem` has no `images` field) — needs an API/DSH contract change to attach image blocks to command execution results.
3. **Browser automation.** DONE 2026-11-26 on `fix/browser` (spec `docs/superpowers/specs/2026-11-26-browser-automation-design.md`, plan `docs/superpowers/plans/2026-11-26-browser-automation.md`): Playwright MCP (`@playwright/mcp` 0.0.80) per agent (`browser` field, switch on the agent form's Tools tab), running inside the sandbox through the API's envd stdio bridge; Chromium lives in the separate `agentry-sandbox-browser:1` image (built-in **Web browser** template plus a template-editor preset) and the standard image stays slim; no host browser (local chats get none and the agent is told why). Web: tool titles (`src/chat/browser-tools.ts`) and a read-only Browser tab in the side panel (`src/ui/preview/BrowserView.tsx`). Not yet: a live chat check, a composer switch for one chat, a live view of the browser (see the plan), and the providers response saying whether the image has the browser. Live view and take-over DONE 2026-11-27 (`src/chat/use-browser-live.ts`, `src/chat/browser-input.ts`, `src/ui/preview/BrowserView.tsx`; API `docs/changes/2026-11-27-browser-takeover.md`): Take control / Hand back in the Browser tab, input mapped to page pixels, agent's browser waits meanwhile. Agent cursor in the live view (2026-11-27, branch `feat/browser-cursor`, spec-less plan `docs/superpowers/plans/2026-11-27-browser-cursor.md`): arrow, click ripple and focus outline from `pointer`/`focus` stream events (`BrowserCursor.tsx`); not yet checked through a running web app. Not yet: IME composition and touch input while in control, copying out of the page, a check in a live chat through the running web app. Recording DONE 2026-11-27 (spec `docs/superpowers/specs/2026-11-27-browser-recording-design.md`): the agent's `browser_recording_start`/`stop` save `recordings/<name>.webm` plus a cursor file; the panel plays it with the cursor drawn over (`src/ui/preview/renderers/VideoView.tsx`, `src/preview/cursor-track.ts`), byte route serves `Range`; not yet checked in a live chat.
4. **Vision-capable model route.** DSH sends screenshots to the model only on an image-capable route; non-vision routes get a diagnostic. Needed for "review the screenshot" workflows.
5. **Artifacts panel (F3).** Preview panel landed 2026-11-10 (files and sandbox tree, no backend change). Spec and plan for the rest drafted 2026-11-26 (see Status). Done 2026-11-26: terminal tabs, Office files as PDF (API converts with DSH `officeToPdf`; Word has a "Text" view, spreadsheets PDF for now), changed files per turn with diff tabs and a Changes view (local chats from DSH's recorder, sandbox chats from the API's shadow git recorder; memory only, outside-workspace files hidden). Done 2026-11-28: live file tree/watch (SSE `artifacts/watch`, debounced refresh, idle fallback kept) and read-only xlsx sheet view (lazy `exceljs`, sheet tabs, 2000 rows/50 cols cap, download fallback). Remaining: browser tab (another session), sandbox port preview, persisting changes across an API restart, shell-made changes in local chats outside a git repository (DSH lists file-tool edits only there), "open links in the side panel" (decided off by default). Original scope: Agent-produced files, documents, HTML previews, and per-turn diffs in the right-hand panel; needs backend cowork endpoints (deliverables, workspace changes, uploads).
6. **Backend gaps the web app works around (F1.1).** Remove the client workaround when each lands.
   - DONE 2026-11-26 (branches `fix/stream-items` in both repos): the stream carries the full item log (user messages, reasoning, tool calls and outputs) as item frames with `<n>.<sub>` ids after the frame before them (chosen over renumbering, so saved `Last-Event-ID`s keep working; the reducer compares ids as pairs), plus live-only `agent.session.subagent.*` events (chosen: no replay, since child state is memory-only; the hook re-reads `/subagents` on open and every reconnect). The items/subagents polling is gone (full load on open only), and so is `stripReasoning`: the backend's `textFromContent` had joined DSH's `reasoning` content blocks into the message text. Details: `~/code/dsh-agents-api/docs/changes/2026-11-26-stream-items.md`. Not yet checked against a live backend.
   - Done 2026-11-26 (branches `fix/subagents` in both repos): subagents survive an API restart (`/subagents`, turns, items and their tool images are rebuilt from the child Session logs; `model` on the resource); a subagent's approval request shows on the parent session with `subagent_id` and renders inside that subagent's card (`src/chat/subagent-actions.ts`, `SubagentActions` context), answered through the normal path; the card and the trajectory Inspector show the subagent's prompt (from the `subagent` call's `prompt`, collapsed in the card) and model (resource `model`, else the call's `model`). Still a gap: subagent `ask_user_question` (DSH refuses non-root askers) and replay of `subagent.*` events (live-only; the hook re-reads `/subagents`).
   - Done (2026-11-25, API; web 2026-11-24 in `build-trajectory.ts`, `Overview.tsx`, `Inspector.tsx`): per-item timestamps and per-step token usage; the trajectory times records, draws assistant/tool lanes, TTFT and per-step usage. Older items without `timing` still show "Not recorded".
   - Done 2026-11-26 (branch `fix/api-fixes`): starring uses `metadata_merge` (atomic, no read-modify-write) and the Starred section is loaded with `GET /agents/sessions?metadata[starred]=true`, so starred chats beyond the loaded pages show.
   - Done: model and reasoning effort on follow-up messages (`model`, `reasoning.effort` on `agent.session.input.message`) reach the running agent; verified against the live backend and enabled in the open-chat composer (a refused change answers 409 `session_setting_not_live`). Auto is always offered; choosing it over a stored effort sends `reasoning.effort: null`, which clears it (2026-11-26; whether the agent then truly falls back to its default is not yet checked live).
   - Done in the API 2026-11-26 (branch `fix/api-fixes`): an unknown `model` on `agent.session.input.message` now answers 409 `session_setting_not_live`; the composer already shows that message.
7. **Owner-filtered schedule tools (DONE 2026-11-26, backend branch `fix/schedule-owner`):** the in-chat `schedule_create/list/view/edit` are shadowed per session with owner-scoped copies of DSH's tools (ownership as on `/v1/agents/schedules`; other owners' and ownerless tasks look like unknown ids). See `~/code/dsh-agents-api/docs/changes/2026-11-26-owner-scoped-schedule-tools.md`. Still to do: a live check with two owners.
8. **External coding-agent subagents (Codex, Claude Code, ACP).** Plan written 2026-11-26: `docs/superpowers/plans/2026-11-26-external-coding-agent-subagents.md` (DSH already ships the providers; they run through the `subprocess` service, so in a sandbox chat they run inside the sandbox; the open work is mounting them, per-agent choice, per-owner sealed API keys, a "Coding agents" tab on the Agents page, and a spike first). Study 2026-11-27 appended to that plan: external children do not show in `/subagents` (no Host Session), own LangGraph/CrewAI agents via an ACP wrapper or an HTTP provider behind one `agentry-external` provider, and extending the existing Subagents section of the agent editor with "Can delegate to" (keys and own agents set up once per person).
9. **Fewer Composio search steps.** Observed 2026-11-26: for every app task the agent first calls `COMPOSIO_SEARCH_TOOLS`, then runs the match with `COMPOSIO_MULTI_EXECUTE_TOOL`. That is Composio's design (Connect lists a few meta tools, not per-app tools, so DSH cannot know the app tools in advance); OpenMausBot (`~/code/OpenMausBot`, `docs/composio.md`) has the same flow but adds plain named tools for Gmail and Google Calendar (`gmail.search_emails`, ...) so common cases skip the search. Options, smallest first: (1) DONE 2026-11-26: guidance in `src/mount-composio.ts` (`COMPOSIO_GUIDANCE_TEXT`) says to search once per task, reuse the tool names and input shapes found, and batch with `COMPOSIO_MULTI_EXECUTE_TOOL` (wording not yet checked against a real conversation: see whether the agent searches less); (1b) DONE 2026-11-26: the guidance also says to keep reads small (first page of about 10 to 20 newest items, lightest fields, no paging through everything, no remote workbench unless asked), after "check my unread email" paged through 800+ messages in about a dozen calls; (2) DONE 2026-11-26 for reads, not yet checked in a live chat: `gmail_search_emails`, `gmail_read_email`, `gmail_read_email_thread`, `googlecalendar_list_events`, `googlecalendar_list_calendars` in `dsh-agents-api/src/mount-composio-app-tools.ts`, each a nested `COMPOSIO_MULTI_EXECUTE_TOOL` call with light defaults (grants and guards apply); DONE 2026-11-26 for writes, not yet checked in a live chat: `gmail_create_draft`, `gmail_send_email`, `gmail_reply_to_thread`, `googlecalendar_create_event`, `googlecalendar_update_event`, `googlecalendar_delete_event` (the nested call asks first under `send_policy: ask`; the slugs `GMAIL_REPLY_TO_THREAD` and `GOOGLECALENDAR_UPDATE_EVENT` and those two tools' argument names are unverified against a live schema); also DONE: `COMPOSIO_SEARCH_TOOLS` answers are trimmed to the agent's grants, and a failed call for an unconnected app shows a Connect link to `/settings/connectors` in the tool card; still to do: tools for other apps. Original note: named tools (`gmail.search_emails`-style) for the one or two most used apps. OpenMausBot does this for Gmail and Calendar only, each wrapping one Composio tool run through `COMPOSIO_MULTI_EXECUTE_TOOL` with its defaults set in code (`include_payload: false`, `verbose: false`, `max_results` default 10, max 50; see its `server/connector-app-tools.ts`), so grants and approvals still apply. This is the reliable fix, because it removes the model's choice. A `tools/pre-execute` hook cannot supply argument defaults instead: DSH freezes the arguments and the hook can only allow, deny, cancel or ask. So building it needs either our own tools that call Composio (check how a DSH tool can invoke the registered MCP tool, or call `connect.composio.dev/mcp` with the consumer key) or a tool that shadows `mcp__composio__COMPOSIO_MULTI_EXECUTE_TOOL`. Other generic ideas: remember the tool names and arguments from successful runs per owner and app and list the most used in the prompt; trim large results in a post-execute hook (Composio already moves big results to a workbench file, so this matters less); OpenMausBot also saves finished runs as repeatable workflows (`shared/skill-burger/draft.ts`); (3) check whether the Composio session config can limit the search to the apps the agent is granted. Not built; verify which tools the live Composio server lists first. Backend repo: `~/code/dsh-agents-api`.
10. **Drop the host `/workspace` folder dependency.** DONE 2026-11-26 (dsh-agents-api branch `fix/workspace`): the bundle disables DSH's base `working-directory` row and mounts `@agentry/api/working-directory` instead, whose `ensure()` hands a sandbox session's folder check to the working-directory service its sandbox preset mounts, so `/workspace` is checked inside the sandbox, not on the API host. New sandboxes always mount at `/workspace` (shared machines keep their unique path), the 400 `sandbox_workspace_missing` answer is gone, and the Docker image no longer creates `/workspace`. Older sandboxes mounted at the long mirrored path still work (the `/workspace` alias covers them). Live check still owed: a chat on a `/workspace` sandbox with no `/workspace` on the API host. Details: `~/code/dsh-agents-api/docs/sandbox.md`.
12. **Environment create in the background (API).** Added 2026-11-27. `POST /agents/environments` waits for the whole sandbox setup (`provisionEnvironment` awaits `provider.create`: image pull, packages, setup commands). The web app now shows a "Setting up…" card instead of holding the dialog, but the record only exists once setup finishes, so a reload or another device does not see it until then. Fix: store the environment as `provisioning` first and set it up in the background (the list already polls settling environments), like the 2026-11-27 fast session create.
11. **Background jobs in the Tasks tab.** DONE 2026-11-27 on `feat/session-jobs` (both repos), not yet checked live. API (`~/code/dsh-agents-api/docs/changes/2026-11-27-session-jobs.md`): `GET /agents/sessions/{id}/jobs` (16 KiB output tail each), `GET .../jobs/{job_id}` (64 KiB), `POST .../jobs/{job_id}/kill`, owner-scoped over DSH's `ctx.jobs`, plus ephemeral `agent.session.job.updated`/`.removed` stream events. Web: proxy allow-list entries; jobs read on open and every reconnect and kept current by the events (`src/chat/reducer.ts`, `src/chat/use-conversation.ts`); Tasks lists them after the subagents with status and a live elapsed time (`src/chat/jobs.ts`, `src/ui/preview/PanelTabs.tsx`), hiding running jobs younger than 3 s (DSH registers foreground commands as jobs too); a row opens a `job:<id>` tab (`src/ui/preview/JobView.tsx`) with the command, monospace output that follows the end, re-read every 2 s while running, and Stop with a confirmation. Not yet: jobs after an API restart (memory only), subagents' jobs, a live check in a local and a sandbox chat. Scheduled tasks stay on `/scheduled`.
13. **Sandbox capability improvements (not new place drivers).** Added 2026-11-28, idea backlog; each needs its own spec. Candidates grounded in `agentry-sandbox` current state (`docs/overview.md`, `src/places/driver.ts`, sandbox-next spec already covers snapshots/audit/metrics/MCP adoption/SSH runbook):
    - **Warm pool / prebooted sandboxes:** keep ready sandboxes per template+place to cut create/start latency; tradeoff is idle resource use and pool invalidation.
    - **Template/image build pipeline:** first-class Dockerfile/build spec, versioned artifacts, build logs, cache visibility; more reproducible than base image + packages/setup commands.
    - **Egress policy controls:** per-template outbound allowlist/domains and deny-by-default profiles; current guard only blocks private ranges/host/LAN/metadata.
    - **Managed secrets:** encrypted secret injection scoped to owner/template/sandbox, masked in logs/audit, rotation/revocation; safer than plain template env.
    - **Structured sandbox events/logs:** provision/setup/exec failure events and log stream for debugging; complements planned audit/metrics.
    - **Workspace/filesystem improvements:** resumable transfer, large-file handling, workspace quotas, git-aware helpers, better export/import.
    - **Reliability/operations:** reconciliation hardening, orphan cleanup, idempotent create/reset, clearer failed-state recovery, multi-replica service story.
    - **Security hardening:** signed/verified envd + DSH runtime manifests, image provenance/SBOM, tighter command-audit defaults.
    - **Capability/health API:** stable schema for what a sandbox/place can do (runtimes, GPU, network, ports, services, health checks) so agents and UI can adapt instead of guessing.

## Astryx conventions (installed by `pnpm exec astryx init`)

The managed block below is written by `astryx init`; refresh it with the CLI, do not hand-edit it. In short: read a component's props with `pnpm exec astryx component <Name>` before using it; build layout from astryx components (`Center`, `VStack`, `HStack`, `Layout`, …) instead of raw `<div>`s; style with component props first, then `xstyle` + StyleX tokens, never raw hex/px or `className`/`style`; colors go through the theme, never `:root` overrides; start new pages from `pnpm exec astryx build "<idea>"` / `astryx template`.

<!-- ASTRYX:START -->
Astryx v0.7.17 · 174 components
CLI: run every command as `pnpm exec astryx <cmd>` (shown below as `astryx ...`).

SETUP (once, in app entry e.g. main.tsx) — without these, components render unstyled:
  import "@astryxdesign/core/reset.css";
  import "@astryxdesign/core/astryx.css";

WORKFLOW — start every page from a template, never from scratch:
1. `astryx build "<idea>"` — names the template to scaffold from and the parts it lacks.
2. `astryx template <name> <path>` — scaffold it; keep its frame, gap and padding; replace the content.
3. `astryx component <Name>` to read props before using one; `astryx template <Block>` prints a block example to read for a part it lacks. Astryx names differ from other libraries: buttons, badges, tokens and tabs take their text in `label` (Text, Heading and Link take children), booleans start with `is` or `has` (`isOpen`, `isDisabled`), and every input takes `value` and `onChange`.
Changing an existing page? Keep it: skip step 2 and add components inside its sections; read a block example when it helps.
Before you deliver a build, run `astryx doctor --built <dir>`; don't deliver it if it fails.

RULES:
- No <div> — components handle all layout and spacing.
- Read `astryx docs layout` before changing a template's frame.
- Dense data = rows (Table, List/Item), not Card-wrapped lists. Badge = counts only.
- Style with component props first, then the xstyle prop / StyleX tokens. No raw hex/px.
- THEMES: palettes and custom colors go through the theme, never :root overrides; so does a denser or roomier app (`editor set <name> spacing tight`), never gap and padding changes page by page. A change to one kind of part (the sidebar, its selected item, the gaps in a form) is a theme change too, not props on one page: `editor how "<ask>"` names the `set … --on <part>` line. No app yet: `astryx experimental theme preview app <dir>` makes a starter app that shows the theme. To make or change a theme (colors, fonts, corners, spacing, a look from a picture), prefer the experimental theme editor over hand-written theme files: `astryx experimental theme editor new <name> --like neutral`, then `editor set <name> <thing> <value>` or `editor how "<what you want>"`; wire it with `astryx theme add <name>`; after each change look at it with `astryx experimental theme editor show <name> --png` (takes pictures of real components) and open the PNGs it writes; a theme change is not done until you have looked at the pictures. In code, extend an imported theme to customize it; `theme eject <slug>` only forks source. See `astryx docs theme`.
- SELF-CHECK: re-read the file; replace any className=, style={{…}}, raw <div>/<span>, imported .css/@apply, or hardcoded #hex/px with the component or the xstyle prop + a token.

`astryx help` lists every command. Key ones beyond the workflow:
  search "<query>"   find any component / hook / doc / template
  discover <words>   integrations you could add
  docs <topic>       getting-started, principles, tokens, theme … (`astryx docs` lists all)
  docs cli           commands and API reference
  docs authoring     build an integration package, and every field it holds
  upgrade --from <old version> --apply   run after a dependency bump
To remove this block, run `astryx init --remove-agents`, which removes it from the agent files at the project root and in the folder you run it in; from any other file it leaves, delete everything from ASTRYX:START to ASTRYX:END.
<!-- ASTRYX:END -->

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
