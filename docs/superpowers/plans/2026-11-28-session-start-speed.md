# Session Start Speed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Measure where session setup time goes and overlap independent MCP mounts so the first turn no longer waits for their sum.

**Architecture:** All code changes are in the API repo (`~/code/dsh-agents-api`). `mountMcpTools()` gains opt-in per-server timing and starts every DSH MCP plugin fiber before awaiting them, keeping the existing config validation, tool guards and error propagation. A dated API write-up records the dev-stack measurement recipe and findings; the web repo only gets a priority-list update.

**Tech Stack:** TypeScript, DSH/Cordis (`@deepseek-ai/dsh-mcp-client`, `ctx.plugin()` fibers), Vitest, Node 24 / pnpm 11.

**Spec:** `docs/superpowers/specs/2026-11-28-session-start-speed-design.md`

## Global Constraints

- `AGENTRY_DEBUG_TIMING=1` is the only switch for timing output; off by default.
- Timing output contains server labels and durations only — never URLs, headers, env values, workspace paths or credentials.
- No change to the wire contract, OpenAPI spec, BFF, browser, web UI or saved agent config.
- Do not patch the pinned DSH checkout (`~/code/dsh-pinned`) or add dependencies.
- Work in place on `develop` in both repos; do not stage the other sessions' uncommitted files.
- Commit as `fakhrulfaiz <fakhrulfaiz2003@gmail.com>`; no `Co-Authored-By` or AI attribution anywhere.
- Prefix pnpm shells with `export PATH=$HOME/.nvm/versions/node/v24.19.0/bin:$PATH`; API tests need `DSH_ROOT=~/code/dsh-pinned`.

## Review Focus

- Two slow MCP servers must overlap: both `ctx.plugin()` calls start before either settles — pinned by Task 1's "starts all MCP fibers" test.
- A failed mount must reject the whole call without an unhandled rejection from its siblings — pinned by Task 1's "rejects if one mount fails" test.
- Duplicate `server_label` values must throw before any fiber starts — pinned by Task 1's "rejects duplicate labels before mounting" test.
- The opt-in log must not echo transport secrets or URLs, and must be silent without the flag — pinned by both Task 1 timing tests.
- `allowed_tools` guards must still apply to every server after overlapping mounts — pinned by Task 1's guard assertions.

---

### Task 1: Concurrent MCP mounts with opt-in timing

**Files:**
- Modify: `~/code/dsh-agents-api/src/mount-mcp-tools.ts` (`mountMcpTools`, lines 95–111)
- Test: `~/code/dsh-agents-api/tests/mount-mcp-tools.spec.ts`

**Interfaces:**
- Consumes: `resolveMcpConfigs()` and `applyAllowedToolsGuard()` (unchanged private helpers), `Context.plugin()`, `Context.tools.guard()`.
- Produces: `mountMcpTools(agentCtx, tools, sessionCwd): Promise<void>` with the same signature; no caller changes. Timing is an internal side effect gated by `AGENTRY_DEBUG_TIMING=1`.

- [ ] **Step 1: Write the failing concurrency test**

Add to `describe('mountMcpTools')` in `tests/mount-mcp-tools.spec.ts` (the existing `vi.mock('@deepseek-ai/dsh-mcp-client')` and `httpTool` fixture are reusable). Use a second HTTP tool with `server_label: 'local'` and a different URL. The fake context's `plugin` pushes `config.serverName` into a `starts` array, then awaits a promise that the test resolves only after asserting, so a sequential implementation cannot pass. Assert `starts` equals `['docs', 'local']` while gated, then release, await the call, and assert two guards were installed that allow `mcp__docs__search` / `mcp__local__search` and deny `mcp__docs__delete`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `export PATH=$HOME/.nvm/versions/node/v24.19.0/bin:$PATH DSH_ROOT=~/code/dsh-pinned && cd ~/code/dsh-agents-api && pnpm vitest run tests/mount-mcp-tools.spec.ts`
Expected: FAIL — `starts` still contains one entry while the first fiber is awaited (test times out or sees `['docs']`).

- [ ] **Step 3: Write the remaining failing tests**

In the same file, add:
- "rejects if one mount fails": a fake `plugin` that throws for `docs` and waits on a releasable gate for `local`; assert `mountMcpTools()` rejects with `boom`, then release the gate so no promise is left pending.
- "rejects duplicate labels before mounting": pass `[httpTool, { ...httpTool }]` with a fake `plugin` spy; assert rejection matches `/duplicate MCP/` and the spy was not called.
- "logs per-server and total durations when AGENTRY_DEBUG_TIMING=1": with the env var set (restore the previous value in `finally`), spy on `process.stderr.write`, mount one tool, and assert the joined output matches `/\[agentry-timing\] mcp mounts: docs=\d+ms; total=\d+ms/` and contains neither `example.com` nor `Bearer t`.
- "does not log without the flag": with the env var unset, assert the stderr spy saw no output.

- [ ] **Step 4: Run the new tests to verify they fail**

Run: `export PATH=$HOME/.nvm/versions/node/v24.19.0/bin:$PATH DSH_ROOT=~/code/dsh-pinned && cd ~/code/dsh-agents-api && pnpm vitest run tests/mount-mcp-tools.spec.ts`
Expected: FAIL — no timing line, and failure/duplicate tests fail against the sequential loop.

- [ ] **Step 5: Implement the new `mountMcpTools`**

In `src/mount-mcp-tools.ts`: keep the early return for an empty tool list and the dynamic client import. Build configs via `resolveMcpConfigs()` first. Start one promise per config with `configs.map(async (config, i) => ...)`, calling `agentCtx.plugin(McpClient as never, config as never)` and recording `wire.server_label` plus a rounded `performance.now()` duration in a local array on settle (success or failure). `await Promise.all(fibers)`, then call `applyAllowedToolsGuard()` for each entry in tool order. Emit one stderr line in a `finally` around the await when `process.env['AGENTRY_DEBUG_TIMING'] === '1'`, formatted as `[agentry-timing] mcp mounts: <label>=<ms>ms, ...; total=<ms>ms`, using only labels and numbers. Do not reword errors or catch them.

- [ ] **Step 6: Run the focused suite**

Run: `export PATH=$HOME/.nvm/versions/node/v24.19.0/bin:$PATH DSH_ROOT=~/code/dsh-pinned && cd ~/code/dsh-agents-api && pnpm vitest run tests/mount-mcp-tools.spec.ts`
Expected: PASS (all existing and new tests).

- [ ] **Step 7: Commit**

```bash
cd ~/code/dsh-agents-api
git add src/mount-mcp-tools.ts tests/mount-mcp-tools.spec.ts
git commit -m "feat(api): overlap MCP mounts and time them"
```

### Task 2: Measurement write-up and priority bookkeeping

**Files:**
- Create: `~/code/dsh-agents-api/docs/changes/2026-11-28-session-start-speed.md`
- Modify: `~/code/dsh-agents-api/CHANGELOG.md`, `~/code/dsh-agents-api/docs/README.md`
- Modify: `~/code/agentry-web/AGENTS.md` (P2 session-start item only)
- Create: `~/code/agentry-web/docs/superpowers/sdd/2026-11-28-session-start-speed/progress.md` (execution ledger, git-ignored)

**Interfaces:**
- Consumes: Task 1's `AGENTRY_DEBUG_TIMING=1` stderr line and the existing Trajectory Inspector's `Input` / `Cached` rows.
- Produces: a dated measurement note; no code interface.

- [ ] **Step 1: Run the measurement recipe against the dev stack**

Start the API dev stack with `AGENTRY_DEBUG_TIMING=1` (per its README). Create two sessions with an input message: a lean agent with no `mcp` tools, and a full agent with the owner's MCP tools (Composio connector plus any other configured server). Record the timing lines, wall time to first reply, and `Input` / `Cached` token counts from the web Trajectory Inspector. If the stack is not available, do not invent numbers — write the recipe and mark results as unmeasured.

- [ ] **Step 2: Write the change note**

Create `docs/changes/2026-11-28-session-start-speed.md` with sections: Problem, Decision (parallel mounts; opt-in timing), Measurement (recipe and observed numbers or "not measured"), and Deferred (generic MCP tool-list caching; prompt-prefix work in DSH; `cached_tokens` already shown in the Trajectory). State explicitly that the config path, guards and error messages are unchanged, and that all fibers are torn down by the agent-context rollback if a mount fails.

- [ ] **Step 3: Update API changelog and docs index**

Add a dated `## 2026-11-28` (or the existing same-day section) `CHANGELOG.md` bullet for parallel MCP mounts and the timing flag, linking the change note; add one row for the note to `docs/README.md` following its existing table format.

- [ ] **Step 4: Update the web priority list**

In `~/code/agentry-web/AGENTS.md`, mark the P2 "Session start speed and prompt cache" item DONE for this pass, summarising what landed and pointing to the API change note; keep the deferred items (generic tool-list caching, prompt-prefix stability) in a short follow-up sentence. Do not touch the other uncommitted files in that repo.

- [ ] **Step 5: Verify docs**

Run: `cd ~/code/dsh-agents-api && git diff --check && grep -n "2026-11-28-session-start-speed" CHANGELOG.md docs/README.md`
Expected: no whitespace errors; both files reference the new note. Read the new note once to confirm it contains the recipe and no invented numbers.

- [ ] **Step 6: Commit each repo separately**

```bash
cd ~/code/dsh-agents-api
git add CHANGELOG.md docs/README.md docs/changes/2026-11-28-session-start-speed.md
git commit -m "docs(api): record session start timing and findings"

cd ~/code/agentry-web
git add -p AGENTS.md   # stage only the P2 session-start hunk; other people's edits stay unstaged
git commit -m "docs: update session start priority"
```

- [ ] **Step 7: Final verification**

Run the full API suite and typecheck:
`export PATH=$HOME/.nvm/versions/node/v24.19.0/bin:$PATH DSH_ROOT=~/code/dsh-pinned && cd ~/code/dsh-agents-api && pnpm vitest run && pnpm typecheck`
Expected: all tests pass (known flaky `tests/sandbox-remote.spec.ts` needs Docker; rerun it alone before calling it a failure) and typecheck clean. Update the ledger with the commands and results.
