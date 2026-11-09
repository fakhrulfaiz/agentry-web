# Agentry Web — agent guide

Read this first in every session. `CLAUDE.md` is a symlink to this file; edit `AGENTS.md`.

## What this is

**Agentry Web**: the claude.ai-style frontend for Agentry. Next.js (App Router) + astryx design system + StyleX, with a backend-for-frontend (BFF) that keeps every Agentry credential out of the browser. Backend: Agentry API in `~/code/dsh-agents-api` (`@agentry/api`, OpenAI Agents API–compatible; see its `AGENTS.md`).

## Status

- F1 (shell + sign-in + chat): spec approved, plan written, **implementation in progress** (Task 1 scaffold done).
  - Spec: `docs/superpowers/specs/2026-11-08-agentry-web-f1-design.md`
  - Plan: `docs/superpowers/plans/2026-11-08-agentry-web-f1.md` (8 tasks)
- Later specs: F2 admin, F3 artifacts/files, F4 trace inspector + subagent views.

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
- Cookie `agentry_session`: `httpOnly`, `SameSite=Lax`, `Secure` when `NODE_ENV=production`; secret `AGENTRY_WEB_SESSION_SECRET` ≥ 32 bytes, required at startup.
- `AGENTRY_WEB_AUTH` ∈ `keycloak` | `apikey`; keycloak mode requires `AGENTRY_WEB_KEYCLOAK_ISSUER`, `AGENTRY_WEB_KEYCLOAK_CLIENT_ID`, `AGENTRY_WEB_KEYCLOAK_CLIENT_SECRET`; `AGENTRY_API_URL` is required and server-only. Missing or invalid values fail startup with a named error (`ConfigError`).
- Proxy allow-list only (spec §5); other paths answer `404`. State-changing calls need same-origin plus an `x-agentry-csrf` header matching the session's CSRF token.
- Reconnect backoff: 1s doubling to a 30s cap; always resend `Last-Event-ID`.
- UI from astryx components and tokens; StyleX only for layout glue; no other CSS framework. Branding "Agentry"; no Anthropic name, logo, mark, licensed fonts, or exact colors.
- Exact dependency versions (no `^`/`~`) for astryx (`0.7.11`) and StyleX (`0.19.1`, including the `@stylexswc/*` compiler packages).

## Toolchain and commands

- The `pnpm` on the default WSL PATH is a Windows binary. Prefix shells with `export PATH=$HOME/.nvm/versions/node/v24.19.0/bin:$PATH` (Node 24, pnpm 11).
- `pnpm dev` · `pnpm build` · `pnpm start` · `pnpm typecheck` · `pnpm test` (Vitest) · `pnpm test:e2e` (Playwright).
- pnpm 11 blocks dependency build scripts; decisions live in `pnpm-workspace.yaml` (`allowBuilds`).

## Project conventions

- Layout: routes in `app/` (repo root); all other code in `src/` (`src/config`, `src/server`, `src/api`, `src/chat`, `src/ui`). The `@/*` alias maps to `src/*` (tsconfig and Vitest).
- Configuration: read it only through `getConfig()` from `@/config/env` (server-only, memoized). `instrumentation.ts` validates it when the Node server starts and exits on a `ConfigError`. Pages and routes that call `getConfig()` must render dynamically so `pnpm build` works without env vars.
- Server-only modules import `server-only`; Vitest aliases it to `tests/stubs/server-only.ts`.
- Tests: `tests/unit/**/*.spec.ts` and `tests/component/**/*.spec.tsx` (Vitest, `node` environment by default; DOM tests start with `// @vitest-environment jsdom`), `tests/e2e/` (Playwright). Vitest does not compile StyleX: `tests/stubs/stylex-setup.ts` (a setup file) makes our `stylex.create()` return empty styles. `pnpm test:e2e` starts the mock API (port 4019) and `next dev` (port 3019, apikey mode) itself, so stop other dev servers first; Chromium needs its system libraries (`sudo pnpm exec playwright install-deps chromium` once).
- Styling: astryx ships prebuilt CSS (`app/globals.css` imports `reset.css` + `astryx.css`; the theme CSS is the prebuilt Agentry theme, see Theme). Our own `stylex.create()` code compiles with `@stylexswc/nextjs-plugin/turbopack`, and `@stylexswc/postcss-plugin` extracts it into the `@stylex;` directive in `app/globals.css`. The compiler only scans `app/` and `src/`, never `node_modules/@astryxdesign`.
- Theme: `src/ui/theme/brand.ts` defines the Agentry theme (`theme-neutral` plus one teal accent); `pnpm exec astryx theme build src/ui/theme/brand.ts --out src/ui/theme/agentry.css` writes the generated `agentry.{css,js,d.ts}` (do not edit; rebuild after changing `brand.ts` or upgrading astryx). `src/ui/theme/AppTheme.tsx` applies it in the mode from the `agentry_theme` cookie (`system` | `light` | `dark`, helpers in `src/ui/theme/theme-cookie.ts`), read by `app/layout.tsx`. `src/astryx-themes.ts` is the CLI's theme registry and is not imported by the app.
- Shell: `app/(app)/layout.tsx` guards every signed-in page (`requirePageSession()`), renders `<meta name="agentry-csrf">`, and wraps pages in `src/ui/shell/Shell.tsx` (astryx `AppShell` + `Sidebar`). DOM tests import `tests/helpers/dom.ts` for jsdom's missing `<dialog>` methods.

## Backlog (agreed 2026-11-09; each needs its own spec)

Cowork capabilities beyond F1. Backend pieces live in `~/code/dsh-agents-api` (mirrored in its `AGENTS.md`).

1. **Skill picker.** `/name` in a message already invokes a DSH user-invocable skill (`dsh-tool-skill` scans user messages). Add a backend skill-catalog endpoint and a `/` autocomplete menu in the composer. Skills come from `<workspace>/.agents/skills`, `$DSH_HOME/skills`, `~/.agents/skills`, a configured directory, and `skill-office`.
2. **Screenshots in tool cards.** Browser tools return images through the tool-result pipeline and attachment store. Add a backend attachment/image endpoint and image rendering in tool cards (F4 scope).
3. **Browser automation.** Mount `@deepseek-ai/dsh-experimental-browser-use-playwright-mcp` (or the Chrome DevTools / Stagehand variant) in the Agentry profile (backend Task 8).
4. **Vision-capable model route.** DSH sends screenshots to the model only on an image-capable route; non-vision routes get a diagnostic. Needed for "review the screenshot" workflows.
5. **Artifacts panel (F3).** Agent-produced files, documents, HTML previews, and per-turn diffs in the right-hand panel; needs backend cowork endpoints (deliverables, workspace changes, uploads).

## Astryx conventions (installed by `pnpm exec astryx init`)

The managed block below is written by `astryx init`; refresh it with the CLI, do not hand-edit it. In short: read a component's props with `pnpm exec astryx component <Name>` before using it; build layout from astryx components (`Center`, `VStack`, `HStack`, `Layout`, …) instead of raw `<div>`s; style with component props first, then `xstyle` + StyleX tokens, never raw hex/px or `className`/`style`; colors go through the theme, never `:root` overrides; start new pages from `pnpm exec astryx build "<idea>"` / `astryx template`.

<!-- ASTRYX:START -->
Astryx v0.7.11 · 174 components
CLI: run every command as `pnpm exec astryx <cmd>` (shown below as `astryx ...`).

SETUP (once, in app entry e.g. main.tsx) — without these, components render unstyled:
  import "@astryxdesign/core/reset.css";
  import "@astryxdesign/core/astryx.css";

WORKFLOW — start every page from a template, never from scratch:
1. `astryx build "<idea>"` — names the template to scaffold from and the parts it lacks.
2. `astryx template <name> <path>` — scaffold it; keep its frame, gap and padding; replace the content.
3. `astryx template <Block>` for parts it lacks; `astryx component <Name>` to read props before using one.
Changing an existing page? Keep it: skip step 2 and add blocks/components inside its sections.
Before you deliver a build, run `astryx doctor --built <dir>`; don't deliver it if it fails.

RULES:
- No <div> — components handle all layout and spacing.
- Read `astryx docs layout` before changing a template's frame.
- Dense data = rows (Table, List/Item), not Card-wrapped lists. Badge = counts only.
- Style with component props first, then the xstyle prop / StyleX tokens. No raw hex/px.
- Palettes and custom colors go through the theme, never :root overrides. Run `astryx theme add <slug>` to import; `theme eject <slug>` only forks source. See `astryx docs theme`.
- SELF-CHECK: re-read the file; replace any className=, style={{…}}, raw <div>/<span>, imported .css/@apply, or hardcoded #hex/px with the component or the xstyle prop + a token.

`astryx help` lists every command. Key ones beyond the workflow:
  search "<query>"   find any component / hook / doc / template
  discover <words>   integrations you could add
  docs <topic>       getting-started, principles, tokens, theme … (`astryx docs` lists all)
  docs cli           commands and API reference
  docs authoring     build an integration package, and every field it holds
  upgrade --from <old version> --apply   run after a dependency bump
<!-- ASTRYX:END -->

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
