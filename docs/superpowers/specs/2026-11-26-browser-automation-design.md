# Browser automation (design)

Status: 2026-11-26, implemented on `fix/browser` with the user's decisions: Playwright MCP, off by default per agent, and **no host browser** (`browser.host` was dropped: local chats never get one). The web side also has a read-only Browser tab. On 2026-11-27 the browser moved out of the standard sandbox image into a separate `agentry-sandbox-browser:1` image, offered through a built-in **Web browser** template and a template-editor preset. Backlog item 3 in `AGENTS.md`. Plan: `docs/superpowers/plans/2026-11-26-browser-automation.md`.

## Goal

An agent can open web pages in a real (headless) Chromium, read them, click, type and fill forms, and take screenshots. In a sandbox chat the browser runs inside that sandbox, under the sandbox's network rules, never on the API host.

## What DSH ships (read from `~/code/dsh-pinned`, pinned version)

- `@deepseek-ai/dsh-browser-use` (`packages/browser-use/browser-use`): only a registration slot (`ctx.browserUse.register(name)`), one provider per process.
- Three experimental providers (`packages/experimental/`): `browser-use-playwright-mcp` (`@playwright/mcp` 0.0.80), `browser-use-chrome-devtools-mcp` (`chrome-devtools-mcp` 1.9.0), `browser-use-stagehand-native` (Stagehand with its own separately configured model). All share `browser-use-runtime/src/mcp.ts` `mountSessionMcp`.
- How the Playwright provider runs (`browser-use-playwright-mcp/src/index.ts`, `browser-use-runtime/src/mcp.ts`):
  - It listens to `agent/created` for **every** agent in the process and starts one stdio MCP client per live session, tools named `mcp__playwright-mcp__*`.
  - The server process is `process.execPath` (the API host's Node) running the pinned `@playwright/mcp` CLI with `--browser chromium --isolated --headless`. The MCP client's stdio transport (`packages/mcp/mcp-client/src/transport.ts`) spawns it with the MCP SDK's `StdioClientTransport`, directly on the host. It does not go through the `subprocess` service.
  - Its working directory comes from the host `workingDirectory.ensure(agent)`.
- Screenshots go through the normal tool-result pipeline. An image block is kept only when the session's exact model route declares image input (`mcp-client/src/tools.ts` `resolveImageAdmission`); otherwise the model gets the text `[image unavailable: image/png; model "x" does not declare image input; ...]`. Playwright MCP mostly works from accessibility snapshots (text), so it is useful without a vision model.

### Why the DSH provider cannot be mounted as is

If we add the provider row to `cordis.patch.yml`, every session, sandbox chats included, gets a browser started on the API host. That breaks the sandbox rule ("a sandbox chat never runs anything on the host", sandbox integration plan), gives the browser the host's network (the API itself, Postgres, cloud metadata addresses) and the host's file system as `file://` roots, and depends on the host `/workspace` folder problem (backlog item 10). Mounting it inside the per-sandbox preset group would not help either: the spawn still happens on the host.

## Design

Agentry starts its own per-session browser MCP server, using the API's existing agent-scoped MCP mounting (`src/mount-mcp-tools.ts`), and decides per session where it runs.

### One server per session, mounted by the API

- New `src/mount-browser.ts` in `@agentry/api`. In `AgentsGateway.buildAgentSetup` (`src/gateway.ts`), when the session's agent has the browser turned on (below), it builds one extra wire MCP tool in memory, `server_label: 'browser'`, `required: false`, and passes it to `mountMcpTools`. Tools appear as `mcp__browser__browser_navigate`, `mcp__browser__browser_snapshot`, `mcp__browser__browser_click`, ... It is never written to the session's saved config; it is rebuilt on resume.
- **Local chat:** stdio, command `process.execPath`, args `[<@playwright/mcp cli.js>, '--browser', 'chromium', '--isolated', '--headless', '--output-dir', <session workspace>/.browser]`. `@playwright/mcp` becomes an exact-version dependency of `@agentry/api`, the same version DSH pins (0.0.80). Allowed only when the deployment says so (`browser.host: true`, default false), because a host browser reaches whatever the host reaches. Off by default for multi-user deployments.
- **Sandbox chat:** stdio, command `process.execPath`, args `[<@agentry/api lib/sandbox-stdio-bridge.js>]`, with the sandbox id, owner and the service URL and key passed in the child's `env` (the MCP client merges explicit `env` over its scrubbed parent environment; the env never reaches the wire or the session log). The bridge is a small Node script that uses the existing `EnvdProcessStream` (`src/sandbox/remote/envd-stream.ts`, a Duplex over one envd process: writes become `SendInput`, stdout is the readable side) to start `playwright-mcp --browser chromium --isolated --headless` **inside the sandbox** as user `agent` in `/workspace`, and pipes its own stdin and stdout to that process. Exit or a broken stream ends the bridge, which the MCP client sees as a closed server. The browser therefore uses the sandbox's CPU and memory limits and its egress rules (`agentry-sandbox` net guard), and `file://` access is the sandbox's file system only.
- The bridge is generic (any stdio MCP command inside a sandbox). It is used only for the browser in this piece; see open questions for inline stdio MCP tools.

### Turning it on

- New agent field `browser: boolean | null` (Agentry extension on `OAIAgent`, saved agents and inline agents). `null` or absent uses the server default `browser.default` (false). Validation: boolean or null, otherwise 400.
- The web app shows a "Web browser" switch in the agent form (Tools tab) and in the new-chat composer's settings beside the environment menu, sending `agent.browser` on session create. A local chat on a server without `browser.host: true` shows the switch disabled with "Available in sandbox chats only on this server."
- `GET /agents/environments/providers` (or a new small `GET /agents/capabilities`) reports `browser: { host: boolean, sandbox: boolean }` so the web app can say what is possible. Recommended: add `browser` to the existing providers response (`sandbox` entry gains `browser: true` when the image has it, see below) to avoid a new route.
- Why opt-in: the browser adds about 20 tool definitions to every request and one Node process per session (Chromium itself starts on the first browser call).

### The sandbox image

- `agentry-sandbox/images/sandbox-browser/Dockerfile` builds `agentry-sandbox-browser:1` from the standard image with the pinned `@playwright/mcp` (`npm install -g @playwright/mcp@0.0.80` and `playwright install --with-deps chromium`). The slim standard image is unchanged. The Providers tab lists each image's software, and the API's built-in **Web browser** template (`tpl_builtin_web_browser`) points at the browser image.
- A sandbox made from an older image has no `playwright-mcp`: the bridge's process exits at once with "command not found"; the session starts without browser tools (`required: false`) and the guidance line (below) is not shown. The web switch says "Reset this sandbox to get the browser" when the environment's `image` is older than the first image that has it.

### Model guidance and screenshots

- A short system prompt section (`agents-api:browser-guidance`, only while `mcp__browser__*` tools are present): use the browser for pages that need JavaScript, logins or interaction; prefer `web_fetch` for plain reading; work from snapshots; take a screenshot only when the layout matters; never type passwords or payment details unless the user gave them for that site in this chat.
- When the session's model cannot see images, screenshots reach the model as the DSH diagnostic text. The vision spec (`2026-11-26-vision-model-route-design.md`) adds the user-facing notice and the image endpoint the tool card needs.

### Web side

- Tool cards (`src/ui/chat/ToolCard.tsx`) for `mcp__browser__*` show a friendly title ("Opened example.com", "Clicked Submit", "Took a screenshot") from the tool name and arguments (`src/chat/browser-tools.ts`, pure), and the page URL as a link.
- Screenshots inside tool cards need the attachment route from the vision spec (backlog item 2); until then the card shows "Screenshot taken" without the image.

## Failure modes

- Playwright MCP fails to start (missing Chromium, old sandbox image, out of memory): `required: false`, the session starts without browser tools and the API logs one warning naming the session and reason.
- The sandbox stops while a browser call runs: the bridge's stream breaks, the call fails with the MCP client's closed-server error; the next session start on a running sandbox gets a fresh browser. Browser state (cookies, open pages) never survives a resume, as in DSH.
- Cancellation (Stop) does not undo clicks already delivered (DSH behaviour, stated in the tool guidance).

## Security notes

- Host browsers are off unless `browser.host: true`. Multi-user deployments should leave it off and use sandboxes, whose egress guard decides what the browser can reach.
- The bridge's env carries the Agentry Sandbox service key to a child process on the API host only. It never enters the sandbox: the bridge talks to the service, and only the Playwright command runs inside.
- `--isolated` keeps the browser profile in memory; nothing about logins persists between sessions.
- Playwright's `--allowed-origins`/`--blocked-origins` are explicitly "not a security boundary" upstream, so they are not used as one.

## Testing

- API unit tests: the tool built for a local and a sandbox session (args, env, `required: false`), not built when `browser` is off or the host is not allowed, not written to saved config, the `browser` field validation, the guidance section appearing only with browser tools.
- Bridge: unit test with a fake envd client (bytes in both directions, exit code ends the stream, stderr kept for the log); one integration test against a running Agentry Sandbox, skipped when the service is absent (as the sandbox tests do).
- Web: unit tests for the tool titles; component test for the switch states.
- One live check per mode before merge: "open example.com and tell me the heading" in a local chat (with `browser.host: true`) and in a sandbox chat; check `ps` in the sandbox shows Chromium and the host does not.

## Out of scope

Chrome DevTools MCP and Stagehand (Stagehand needs its own model configuration and API key); a live view of the browser in the web app (a later "browser tab" in the preview panel); attaching to the user's own browser; saving logins between sessions.

## Open questions for the user

1. **Provider:** Playwright MCP (recommended: DSH pins it, works from text snapshots, no extra model) or Chrome DevTools MCP?
2. **Host browser for local chats:** allow it behind `browser.host` for single-user/dev setups (recommended), or sandbox-only everywhere?
3. **Image size:** ~~put Chromium into the standard sandbox image or ship a separate "Browser" template image?~~ Resolved 2026-11-27: separate browser image with a built-in template; the standard image stays slim.
4. **Default:** browser off unless turned on per agent or chat (recommended), or on by default in sandbox chats?
5. **Inline stdio MCP tools in sandbox chats** run on the API host today (the MCP client spawns them directly). Should all of them go through the new bridge (a separate, security-relevant change)?
