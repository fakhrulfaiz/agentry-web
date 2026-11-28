# Session start speed: measurement and parallel MCP mounts — design

*Status: 2026-11-28, approved for planning. P2 "session start speed and prompt cache", first slice.*

## Intent and why

`POST /v1/agents/sessions` already answers early (`docs/changes/2026-11-27-fast-session-create.md` in the API), but the first message still waits for the background setup. The largest known setup cost is MCP activation: `@deepseek-ai/dsh-mcp-client` deliberately blocks fiber activation on the first connection and `tools/list`, and `mountMcpTools()` mounts servers one after another. With two slow servers the wait is their sum. Before optimising further we need numbers from the actual dev setup, and the safe first optimisation is to overlap independent mounts.

Already landed, and therefore out of scope here: the Composio relay caches its upstream `tools/list` and warms it in the background (`2026-11-27-composio-relay.md`); token usage including `input_tokens_details.cached_tokens` is reconstructed in the web Trajectory and shown in its Inspector (`src/ui/trajectory/Inspector.tsx`).

## Goals

- A repeatable way to see, for one session setup, how long each MCP server mount took and how long mounting took in total.
- A recorded comparison of a lean agent (no MCP tools) and a full agent (MCP tools, including the owner's Composio connector), with prompt/input token counts from the Trajectory.
- MCP servers mount concurrently, so setup time tracks the slowest server instead of the sum; tool availability, `allowed_tools` guards and failure behaviour stay the same.

## Non-goals and anti-goals

- Generic caching of every MCP server's tool list. Only Composio has the shared relay today; extending caching needs a DSH client option or our own wrapper and is deferred until the measurements say it matters.
- Restructuring the system prompt for a cross-session stable prefix. DSH owns the early sections (`system-prompt` service, runtime context, tool schemas); our own instruction sections are static and come after the persona prefix. Document the finding, do not patch the pinned DSH checkout.
- Changes to the wire contract, BFF, browser, web UI, or credentials. No new dependencies.
- Anti-goal: starting every MCP fiber before checking for duplicate server labels, or logging URLs, headers, env values or workspace paths.

## Approaches

1. **Instrument setup + parallelize the existing mounts (chosen).** Keep the DSH plugin and config path as-is; add opt-in timing output around `mountMcpTools()`, switch its sequential loop to overlapping `ctx.plugin()` calls, and write a measurement note with the dev-stack numbers. Small diff, testable with the existing fake contexts, and it yields the data needed for the deferred items.
2. **Cache all MCP tool lists behind our own relay.** Rejected for now: much larger, needs a design for invalidation and per-owner isolation, and the Composio relay already covers the slow server we know about.
3. **Only benchmark, no code change.** Rejected: the sequential mount loop is a known avoidable cost and can be changed safely without a wire change.

## Decided design

### Timing

- `mountMcpTools()` starts a monotonic clock before the first plugin call and records elapsed milliseconds per server label (the display `server_label`, never URL/header/env values) as each fiber settles, plus the total mount duration.
- When `AGENTRY_DEBUG_TIMING=1`, emit one line to stderr, matching the existing `AGENTRY_DEBUG_ERRORS` debug-aid pattern: `[agentry-timing] mcp mounts: docs=123ms, composio=456ms; total=457ms`. Off by default; no change to normal logging.
- The measurement note (`docs/changes/2026-11-28-session-start-speed.md` in the API) records the recipe and observed numbers: start the dev stack, enable the flag, create a lean session and a full session, note the timing lines and time to first reply, and read `Input` / `Cached` token counts from the Trajectory Inspector. A single run is a sample, not a benchmark claim.

### Parallel mounts

- `resolveMcpConfigs()` still validates and rejects duplicate namespaces before anything starts.
- `mountMcpTools()` calls `agentCtx.plugin(McpClient, config)` for every config in order, keeping the returned fibers, then awaits all of them. Cordis creates and starts a fiber on each `plugin()` call (`vendor/cordis/src/registry.ts`, `fiber.ts`), so the connections overlap; awaiting later does not delay activation.
- `applyAllowedToolsGuard()` runs for each server after all mounts succeed, in tool order. Guards only match public tool-name prefixes and no tools execute during setup, so their relative timing does not matter.
- A failed mount still rejects `mountMcpTools()`; the setup callback's existing rollback disposes the agent context and therefore the other fibers. The error is not reworded, so callers and error tests keep their current behaviour.

### Prompt cache

- State in the measurement note that `cached_tokens` is already visible in the Trajectory, that our agent identity/instructions/guidance sections are static, and that any cross-session prefix instability comes from DSH-owned sections or the tool list. No API code change in this pass.

## Verification

- API: `DSH_ROOT=~/code/dsh-pinned pnpm vitest run tests/mount-mcp-tools.spec.ts`, then the full `pnpm vitest run` and `pnpm typecheck`.
- New tests: both plugin fibers are started before either resolves; guards are installed for both servers; a rejected mount rejects the whole call; duplicate labels still throw before any plugin call; timing output names labels and durations only.
- A dev-stack measurement run fills in the numbers in the write-up. If the stack is not available, leave the recipe and mark the numbers as unmeasured rather than inventing them.

## Docs and bookkeeping

- API: dated `CHANGELOG.md` bullet, `docs/changes/2026-11-28-session-start-speed.md`, and a row in `docs/README.md`.
- Web: update the P2 priority item in `AGENTS.md` with what landed and what remains; no web CHANGELOG entry (no web behaviour change).
- Commit in place on `develop` in both repos as `fakhrulfaiz <fakhrulfaiz2003@gmail.com>`, with no AI attribution. Do not commit the other sessions' uncommitted files.
