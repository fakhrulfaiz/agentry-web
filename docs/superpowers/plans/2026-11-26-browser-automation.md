# Browser automation: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-11-26-browser-automation-design.md`.

**Goal:** an agent with the browser turned on gets Playwright MCP tools (`mcp__browser__*`) in sandbox chats, running inside the sandbox through a stdio bridge over envd; the web app has a Browser switch on the agent form, readable titles for browser tool calls and a read-only Browser tab in the side panel.

**Repos:** `~/code/dsh-agents-api` (API), `~/code/agentry-sandbox` (image only), `~/code/agentry-web` (web). Worktrees `~/code/wt/<repo>-browser`, branch `fix/browser` from `develop`.

**Decisions (user, 2026-11-26):** Playwright MCP (`@playwright/mcp` 0.0.80, exact, the version DSH pins); Chromium in the standard sandbox image; off by default, turned on per agent (`browser` field, switch in the agent form); never a host browser: there is no `browser.host` option in v1, and a local chat gets no browser tools and a prompt line saying why.

## Global constraints

- Nothing browser-related runs on the API host except the bridge process (a Node script that only relays bytes). The service key reaches the bridge through its environment only: never its arguments, the session's saved config, the wire or a log line.
- The browser MCP tool is built in memory at mount time (create and resume), never stored in the session config, and is `required: false`.
- Every behaviour change: a dated bullet at the top of `## Unreleased` in that repo's `CHANGELOG.md`; API wire changes also update `openapi/agentry.yaml`, `docs/http-api.md` and a `docs/changes/2026-11-26-browser.md` note with a `docs/README.md` row.
- Web: astryx components and tokens only. `src/ui/preview/PreviewPanel.tsx` is being changed by other agents: keep edits there to a few lines; new UI goes in new files.
- Checks: API `pnpm typecheck && pnpm vitest run` (`DSH_ROOT=~/code/dsh-pinned`); sandbox `pnpm typecheck && pnpm test`; web `pnpm typecheck && pnpm vitest run --no-file-parallelism`.

## Task 0: spike the envd stdio bridge [Opus]

**Files:** create `dsh-agents-api/src/sandbox/remote/stdio-bridge.ts` (pure core: config from env, `runStdioBridge`), `src/sandbox/remote/stdio-bridge-main.ts` (the program), add the `sandbox-stdio-bridge` entry to `tsdown.config.ts`.

- [ ] Against the dev Agentry Sandbox: create a sandbox, start the bridge with `AGENTRY_BRIDGE_COMMAND=["npx","-y","@playwright/mcp@0.0.80",...]`, send MCP `initialize` and `tools/list` over its stdin/stdout, close stdin, see the bridge exit 0. Stop and report if this cannot work.
- [ ] With the new image (Task 1): `browser_navigate` to a page and `browser_take_screenshot`; `ps` in the sandbox shows Chromium.

## Task 1: Chromium and Playwright MCP in the sandbox image [Sonnet]

**Files:** `agentry-sandbox/images/sandbox/Dockerfile`, `CHANGELOG.md`, `docs` mention of the image's software.

- [ ] `npm install -g @playwright/mcp@0.0.80`, then its own `playwright-core` installs Chromium with system libraries into `PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright` (readable by `agent`). Label `org.agentry.tools` gains `chromium playwright-mcp` (the Providers tab lists it).
- [ ] Build locally with a credential-free `DOCKER_CONFIG`; `playwright-mcp --version` runs in the build.

## Task 2: bridge tests [Sonnet]

**Files:** `dsh-agents-api/tests/stdio-bridge.spec.ts`.

- [ ] Fake remote process (a Duplex with `exited`, `ready`, `kill`): bytes flow both ways; the remote exit code is the bridge's; a stream that breaks gives 1 and a stderr line; stdin end kills the remote after the grace period; a program that never starts gives 1 with its stderr. `bridgeConfigFromEnv` names missing variables and rejects a bad command.

## Task 3: the `browser` agent field [Sonnet]

**Files:** `src/types.ts` (`OAIAgent`, create/update params), `src/agent-records.ts`, `src/input.ts` (`overlayAgent`), `src/gateway.ts` (`validateAgentExtensions`, inline session agent), `openapi/agentry.yaml` (`Agent`, `AgentFields`), `docs/http-api.md`, tests.

- [ ] Tests first: create/update keep `browser`; `browser: "yes"` answers 400 `browser must be a boolean or null`; an inline session agent with a bad value answers 400; overlay copies it.
- [ ] Config `browser.default` (boolean, default false) used when the field is null or absent.

## Task 4: mount the browser per session [Opus]

**Files:** create `src/mount-browser.ts`; modify `src/gateway.ts` (`buildAgentSetup`, `mountSessionPreset` returns the sandbox it mounted); tests `tests/mount-browser.spec.ts`.

- [ ] `browserMcpTool({ sandbox, credentials, bridgePath })` returns the wire MCP tool: `server_label: 'browser'`, `required: false`, stdio `process.execPath` + `[bridgePath]`, env with the service URL and key, owner, sandbox id, workspace and `["playwright-mcp","--browser","chromium","--isolated","--headless","--output-dir","<workspace>/.browser"]`. Undefined for a local chat.
- [ ] `buildAgentSetup` mounts it with `mountMcpTools` (host `cwd` = `os.tmpdir()`, because the sandbox workspace path need not exist on the host), only when the browser is on and the session runs in a sandbox. Never added to `resolved.tools`.
- [ ] System prompt section `agentry:browser`: usage guidance while `mcp__browser__browser_navigate` is visible; in a local chat with the browser on, one line saying the browser runs only in sandbox chats; in a sandbox chat whose browser did not start, one line saying a reset to the current image adds it.
- [ ] Tests: tool shape, env holds the key but args do not, nothing for local chats, guidance text per state.

## Task 5: web, agent form switch and tool titles [Sonnet]

**Files:** `agentry-web/src/api/types.ts` (`browser` on agent types), the agent form (Tools tab) and its save mapping, create `src/chat/browser-tools.ts`, the tool-card title hook, tests.

- [ ] A "Web browser" switch with the hint "Runs in sandbox chats only"; saved as `browser: true|false`.
- [ ] `browserToolTitle(name, args)`: "Opened example.com", "Clicked Submit", "Typed into Search", "Took a screenshot", "Read the page", and so on; unknown browser tools get a readable fallback. Used where tool cards get their titles.

## Task 6: web, Browser tab [Sonnet]

**Files:** create `src/chat/browser-state.ts` (pure: from the conversation's tool items, the current URL, the latest screenshot and the visited pages), `src/ui/preview/BrowserView.tsx`; a few lines in `src/ui/preview/PreviewPanel.tsx` (the tab, its Start-page entry, open by itself when a browser tool runs).

- [ ] Tests first: state from navigate/click/screenshot items (URL from args and from `### Page state`/`Page URL:` text in results, screenshot from `output_image` parts), history de-duplicated in order; component test renders URL, image and the list.
- [ ] Read-only in v1.

## Task 7: docs

- [ ] Both `AGENTS.md` backlog item 3, CHANGELOGs, `docs/sandboxes.md` (image software), API `docs/changes/2026-11-26-browser.md`.

## Review focus

The bridge's handling of stdin end and signals (no orphaned Playwright process in the sandbox), the key never leaving the bridge env, the tool never reaching saved config, and no browser for local chats.

## Results (2026-11-26)

- Spike passed: MCP over the bridge into a sandbox, `browser_navigate` to example.com and a screenshot image part, Chromium processes in the sandbox only. Found on the way: envd processes do not get the image's `ENV`, so the bridge passes `PLAYWRIGHT_BROWSERS_PATH`; Playwright writes its own state under `~/.cache/ms-playwright`, so that folder must not be linked to the read-only browsers folder.
- Image builds locally (about 1.9 GB, up from 0.9 GB); arm64 not built.

## Later: a live view

The Browser tab is read-only and shows the latest screenshot. A live view could work like this, smallest first:

1. **Polling screenshots:** a BFF route that asks the API for a fresh screenshot of the session's browser every second or two while the tab is open. Needs an API route that calls `browser_take_screenshot` outside the model's turn (a side channel to the same MCP client) and must not count as agent activity.
2. **CDP screencast:** start Playwright MCP with `--cdp-endpoint` against a Chromium the bridge launches, and have a second envd process stream relay the DevTools protocol to the API, which sends `Page.startScreencast` frames to the web app over SSE or a WebSocket (as the terminal does). Read-only, low latency, no VNC.
3. **Take over (interactive):** forward mouse and keyboard events back through `Input.dispatch*` on the same CDP channel, with a lock so the agent and the user do not act at once. This is the security-sensitive one (the user acts as the agent's browser, logins persist only for the session) and needs its own spec.
