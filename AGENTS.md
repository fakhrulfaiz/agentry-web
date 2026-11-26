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
- Agents page (2026-11-10): saved agents CRUD at `/agents`, bundled starters, agent menu in new chats, soft per-agent app limit (spec `docs/superpowers/specs/2026-11-10-agents-page-design.md`). Not yet: ECC/URL import, subagent deployment as a named agent, agent-authoring tools and skill, per-agent skills, hard app limits.
- Later specs: F2 admin, F3 artifacts/files, F4 trace inspector + subagent views (F4 also: keyboard access for the trajectory overview).

## Working-tree provenance (2026-11-10)

Parts of the current uncommitted work under `main` were authored by a different agent session (skills/commands `/` menu, the Artifacts page, the scheduled-list restyle and wire-type updates, fonts, the thinking row and single-scrollbar fixes — see their CHANGELOG entries). Commits per the user's call come later; until then:

- Scheduled tasks detail page (`/scheduled/{id}`, `src/ui/scheduled/ScheduleDetail.tsx` + route + `tests/component/schedule-detail.spec.tsx`): authored 2026-11-10 in a separate session (mockups: claude.ai detail + DeepSeek automation panel).
- `tests/component/slash-menu.spec.tsx` mock typing was fixed by the detail-page session so `pnpm typecheck` passes.
- Artifacts rewiring (2026-11-10, this session): the other agent's Artifacts page was built against the F3 cowork spec (`GET /v1/agents/artifacts`), which the backend never implemented; `src/api/client.ts` (`listSessionArtifacts`), `src/api/types.ts` (`SessionArtifactEntry/List`, slimmed `Artifact`), `src/artifacts/{artifact.ts,kind.ts}`, `src/ui/artifacts/*`, `src/ui/chat/SessionArtifacts.tsx`, `src/server/{allowlist.ts,artifact-bytes.ts}` and `app/api/agentry/agents/sessions/[id]/artifacts/[...path]/route.ts` (the old `agents/artifacts/[id]/content` route is deleted) now speak the backend's per-session endpoints. Known suite flakiness: `tests/component/reveal.spec.tsx` and `tests/component/schedule-detail.spec.tsx` fail timing-sensitive tests only under full-run parallelism — `pnpm vitest run --no-file-parallelism` shows 441/441 pass.
- Known pre-existing failures (other session's in-progress work, left untouched): `tests/component/cards.spec.tsx` 403 test (its `next/navigation` mock predates `Conversation`'s `useRouter` use) and `tests/component/trajectory.spec.tsx` draft test (composer hidden behind the new `ready` gating while the spec never delivers a session status).

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

## Backlog (agreed 2026-11-09; each needs its own spec)

Cowork capabilities beyond F1. Backend pieces live in `~/code/dsh-agents-api` (mirrored in its `AGENTS.md`).

1. **Skill picker.** `/name` in a message already invokes a DSH user-invocable skill (`dsh-tool-skill` scans user messages). Backend skill-catalog endpoint done 2026-11-10 (`GET /v1/agents/skills`); remaining: the `/` autocomplete menu in the composer. Skills come from `<workspace>/.agents/skills`, `$DSH_HOME/skills`, `~/.agents/skills`, a configured directory, and `skill-office`.
2. **Screenshots in tool cards.** Browser tools return images through the tool-result pipeline and attachment store. Add a backend attachment/image endpoint and image rendering in tool cards (F4 scope).
3. **Browser automation.** Mount `@deepseek-ai/dsh-experimental-browser-use-playwright-mcp` (or the Chrome DevTools / Stagehand variant) in the Agentry profile (backend Task 8).
4. **Vision-capable model route.** DSH sends screenshots to the model only on an image-capable route; non-vision routes get a diagnostic. Needed for "review the screenshot" workflows.
5. **Artifacts panel (F3).** Preview panel landed 2026-11-10 (files and sandbox tree, no backend change). Remaining: Office rendering (server-side conversion to PDF), per-turn diffs, terminal/browser tabs, file watches. Original scope: Agent-produced files, documents, HTML previews, and per-turn diffs in the right-hand panel; needs backend cowork endpoints (deliverables, workspace changes, uploads).
6. **Backend gaps the web app works around (F1.1).** Remove the client workaround when each lands.
   - The stream carries assistant messages only: emit reasoning, tool calls and outputs, user messages and subagent activity as stream events. Then drop the items/subagents polling in `src/chat/use-conversation.ts` and the reasoning-prefix strip (`stripReasoning`), which exists because a saved message repeats its step's reasoning in front of its text.
   - Per-item timestamps and per-step token usage, so the trajectory can time records and draw assistant/tool lanes (today: "Not recorded").
   - Session list filtering by metadata (starred chats beyond the loaded pages) and a metadata patch instead of replace-the-whole-map (concurrent writes can drop a key).
   - Done: model and reasoning effort on follow-up messages (`model`, `reasoning.effort` on `agent.session.input.message`) reach the running agent; verified against the live backend and enabled in the open-chat composer (a refused change answers 409 `session_setting_not_live`). There is still no way to clear a stored effort back to the agent's default, so Auto is offered only while none is stored.
   - An unknown `model` on `agent.session.input.message` is accepted (200), stored and queued; the turn then fails at the provider ("supported API model names are …") instead of the documented 409 `session_setting_not_live` (seen live 2026-11-09; an unsupported effort does answer 409). The composer only offers configured models, so this needs a hand-made request or a stale model list to hit.
7. **Owner-filtered schedule tools:** `schedule_list/view/edit` see every Host task; filter by owner (upstream DSH change or replacement tool) before multi-user containers. (Backend AGENTS.md item 6.)
8. **External coding-agent subagents (Codex, Claude Code, ACP).** Plan written 2026-11-26: `docs/superpowers/plans/2026-11-26-external-coding-agent-subagents.md` (DSH already ships the providers; they run through the `subprocess` service, so in a sandbox chat they run inside the sandbox; the open work is mounting them, per-agent choice, per-owner sealed API keys, a "Coding agents" tab on the Agents page, and a spike first).
9. **Fewer Composio search steps.** Observed 2026-11-26: for every app task the agent first calls `COMPOSIO_SEARCH_TOOLS`, then runs the match with `COMPOSIO_MULTI_EXECUTE_TOOL`. That is Composio's design (Connect lists a few meta tools, not per-app tools, so DSH cannot know the app tools in advance); OpenMausBot (`~/code/OpenMausBot`, `docs/composio.md`) has the same flow but adds plain named tools for Gmail and Google Calendar (`gmail.search_emails`, ...) so common cases skip the search. Options, smallest first: (1) DONE 2026-11-26: guidance in `src/mount-composio.ts` (`COMPOSIO_GUIDANCE_TEXT`) says to search once per task, reuse the tool names and input shapes found, and batch with `COMPOSIO_MULTI_EXECUTE_TOOL` (wording not yet checked against a real conversation: see whether the agent searches less); (1b) DONE 2026-11-26: the guidance also says to keep reads small (first page of about 10 to 20 newest items, lightest fields, no paging through everything, no remote workbench unless asked), after "check my unread email" paged through 800+ messages in about a dozen calls; (2) DONE 2026-11-26 for reads, not yet checked in a live chat: `gmail_search_emails`, `gmail_read_email`, `gmail_read_email_thread`, `googlecalendar_list_events`, `googlecalendar_list_calendars` in `dsh-agents-api/src/mount-composio-app-tools.ts`, each a nested `COMPOSIO_MULTI_EXECUTE_TOOL` call with light defaults (grants and guards apply); DONE 2026-11-26 for writes, not yet checked in a live chat: `gmail_create_draft`, `gmail_send_email`, `gmail_reply_to_thread`, `googlecalendar_create_event`, `googlecalendar_update_event`, `googlecalendar_delete_event` (the nested call asks first under `send_policy: ask`; the slugs `GMAIL_REPLY_TO_THREAD` and `GOOGLECALENDAR_UPDATE_EVENT` and those two tools' argument names are unverified against a live schema); also DONE: `COMPOSIO_SEARCH_TOOLS` answers are trimmed to the agent's grants, and a failed call for an unconnected app shows a Connect link to `/settings/connectors` in the tool card; still to do: tools for other apps. Original note: named tools (`gmail.search_emails`-style) for the one or two most used apps. OpenMausBot does this for Gmail and Calendar only, each wrapping one Composio tool run through `COMPOSIO_MULTI_EXECUTE_TOOL` with its defaults set in code (`include_payload: false`, `verbose: false`, `max_results` default 10, max 50; see its `server/connector-app-tools.ts`), so grants and approvals still apply. This is the reliable fix, because it removes the model's choice. A `tools/pre-execute` hook cannot supply argument defaults instead: DSH freezes the arguments and the hook can only allow, deny, cancel or ask. So building it needs either our own tools that call Composio (check how a DSH tool can invoke the registered MCP tool, or call `connect.composio.dev/mcp` with the consumer key) or a tool that shadows `mcp__composio__COMPOSIO_MULTI_EXECUTE_TOOL`. Other generic ideas: remember the tool names and arguments from successful runs per owner and app and list the most used in the prompt; trim large results in a post-execute hook (Composio already moves big results to a workbench file, so this matters less); OpenMausBot also saves finished runs as repeatable workflows (`shared/skill-burger/draft.ts`); (3) check whether the Composio session config can limit the search to the apps the agent is granted. Not built; verify which tools the live Composio server lists first. Backend repo: `~/code/dsh-agents-api`.
10. **Drop the host `/workspace` folder dependency.** Verified working 2026-11-26: a chat on a sandbox mounted at `/workspace` runs once an empty `/workspace` folder exists on the API host (Docker image creates it; dev machine: `sudo mkdir /workspace && sudo chown "$USER" /workspace`); without it the turn fails with `working-directory: directory does not exist: "/workspace"`. Cause (read from config, not traced): `@deepseek-ai/dsh-base` mounts a host-level `working-directory` whose `system-prompt/assemble` hook (`prepend: true`) calls `ensure()` for every agent, sandbox agents included, and stats the folder through the host `fs`. New sandboxes mount at `/workspace` only when the host folder exists, else at the long mirrored path (`sharedWorkspace` in the provider); attaching to a sandbox whose folder is missing answers 400 `sandbox_workspace_missing`. Long-term options: (a) our `@agentry/api` plugin mounts a replacement `working-directory` that defers to the sandbox group's copy for sandbox agents (check first whether a base profile row can be replaced or disabled by a patch), (b) a DSH change so each service handles only agents in its own scope (upstream, new pin). Do not wrap the running service's `ensure` (two copies would disagree on the prompt's directory line). Details: `~/code/dsh-agents-api/docs/sandbox.md`.

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
