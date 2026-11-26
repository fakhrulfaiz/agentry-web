# F4 trace inspector: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keyboard access for the trajectory overview, a subagent list and subagent tab, a raw Session log view, and (if approved) a team view.

**Architecture:** Parts 1 and 3 are web-only and use data the conversation hook already holds. Part 2 adds owner-scoped, redacted log routes to the API over `sessionQuery.readSession` and a Log view in the web. Part 4 waits on a decision to mount DSH's experimental team packages.

**Spec:** `docs/superpowers/specs/2026-11-26-f4-trace-inspector-design.md`

**Repos:** API tasks run in `~/code/dsh-agents-api` (`export DSH_ROOT=/home/mffaiz/code/dsh-pinned`; checks `pnpm typecheck && pnpm vitest run`). Web tasks run in `~/code/agentry-web` (checks `pnpm typecheck && pnpm vitest run --no-file-parallelism`). Every shell: `export PATH=$HOME/.nvm/versions/node/v24.19.0/bin:$PATH`.

**Model per task:** **Sonnet** = mechanical, interfaces fixed here. **Opus** = judgment needed (accessibility design calls, redaction, DSH service wiring).

## Global Constraints

- Every ported feature reads only through Agentry API endpoints via the BFF (`dsh-agents-api/AGENTS.md` decision 10). Never DSH's remote layer.
- API routes are owner-scoped, in `openapi/agentry.yaml` (drift test), with a CHANGELOG bullet and, for a new capability, a `docs/changes/2026-11-26-<slug>.md` note plus a `docs/README.md` row.
- Log output is redacted before it leaves the API.
- Web: astryx components and tokens, StyleX only for layout glue, no raw hex/px; read props with `pnpm exec astryx component <Name>`.
- Mouse behaviour of the overview does not change.
- CHANGELOG bullet per behaviour change in each repo. Commit as `fakhrulfaiz <fakhrulfaiz2003@gmail.com>`; no AI attribution.

## Review Focus

- Overview: every key in the spec's table works; focus is visible; screen readers hear the active span.
- Log: no secret survives redaction (header values, keys named token/secret/password/api key, MCP env).
- Log paging: `after` is exclusive; `has_more` is right at the boundary; a running session's new events appear once.
- Subagent tab renders read-only (no composer) and survives the child finishing.

---

## Part 1: keyboard access for the overview

### Task 1: Overview key logic (Sonnet)

**Files:**
- Create: `agentry-web/src/ui/trajectory/overview-keys.ts`
- Test: `agentry-web/tests/unit/overview-keys.spec.ts`

**Interfaces (produce):**
- Consumes `TimelineSpan` from `src/ui/trajectory/build-trajectory.ts` (`id`, `lane`, `start`, `end?`).
- `LANE_ORDER = ['turn', 'assistant', 'tool', 'subagent'] as const` (match the `lane` values used by `Overview.tsx`'s `LANES`; read it first).
- `orderSpans(spans): TimelineSpan[]`: by `start`, then lane order, then id.
- `moveActive(spans, activeId: string | null, key: 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown' | 'Home' | 'End'): string | null`. Left/Right step in `orderSpans` order (clamped). Up/Down go to the adjacent lane that has spans, picking the span whose `start` is nearest the active span's `start`. Null active → first span for any key.
- `growInterval(spans, interval: { from: number; to: number } | null, activeId, dir: 'left' | 'right', now: number): { interval; activeId }`: extends the interval to cover the previous/next span (uses `end ?? now`).
- `zoomAround(domain, at: number, factor: number, full): { from; to } | null` (null when zoomed out to full), the same math as `onWheel` in `Overview.tsx`. Then make `onWheel` call it.

- [ ] **Step 1: Write failing tests** with four spans over two lanes: Right from null → first; Right at the end stays; Down from an assistant span picks the nearest tool span; Up from the top lane stays; Home/End; growInterval twice to the right covers three spans; zoomAround returns null at full width.
- [ ] **Step 2: Run** `pnpm vitest run tests/unit/overview-keys.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement**, and switch `onWheel` to `zoomAround`.
- [ ] **Step 4: Run** it plus `tests/component/trajectory.spec.tsx`. Expected: the new test PASS; `trajectory.spec.tsx` as before (its draft test is a known pre-existing failure, see AGENTS.md).
- [ ] **Step 5: Commit** `feat(trajectory): overview key logic`.

### Task 2: Keyboard in the Overview component (Opus)

**Files:**
- Modify: `agentry-web/src/ui/trajectory/Overview.tsx` (props `selectedId`, `onSelect(recordId)`; state `activeId`)
- Modify: `agentry-web/src/ui/trajectory/TrajectoryView.tsx` (pass `selectedId`, `onSelect`)
- Modify: `agentry-web/src/ui/trajectory/build-trajectory.ts` (`recordId` on `TimelineSpan`)
- Test: `agentry-web/tests/component/trajectory-overview-keys.spec.tsx`

**Interfaces:**
- The area `VStack` gets `tabIndex={0}`, `role="listbox"`, `aria-label="Timeline overview"`, `aria-activedescendant={activeId ? \`span-${activeId}\` : undefined}`, `onKeyDown`. Each span: `id={\`span-${span.id}\`}`, `role="option"`, `aria-selected={span.recordId === selectedId}`, and the existing `aria-label`.
- Keys per the spec table. Enter/Space → `onSelect(span.recordId)`. `TimelineSpan` has no record id today: add `recordId?: string` in `timelineSpans` (`build-trajectory.ts`, with a unit test in `tests/unit/build-trajectory.spec.ts`). Turn spans have none; Enter on a turn span sets the focused interval to that turn instead. `+`/`-` → `zoomAround` at the active span's middle. `0` → `setZoom(null)`. Escape → clear interval if any, else zoom. Shift+Left/Right → `growInterval` then `onIntervalChange`.
- Focus ring on the active span: StyleX `outline` with `colorVars['--color-accent']`, only while the area has focus (`:focus-within` is not available on the child; track `focused` state with onFocus/onBlur).
- A visually hidden live region (`aria-live="polite"`) inside the overview announces `${span.label}, ${duration}, ${status}` when `activeId` changes. Use astryx's visually-hidden helper if it has one (`pnpm exec astryx search "visually hidden"`), else a StyleX clip rule.
- When the active span is outside the zoomed domain, shift the zoom to include it.

- [ ] **Step 1: Write failing component tests** (jsdom, `tests/helpers/dom.ts`): Tab focuses the overview; ArrowRight sets `aria-activedescendant` to the first span; Enter calls `onSelect` with its record id; Escape after Shift+ArrowRight clears the "Focused" line; the live region text changes.
- [ ] **Step 2: Run** `pnpm vitest run tests/component/trajectory-overview-keys.spec.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it plus `tests/component/trajectory.spec.tsx tests/component/trajectory-inspector-timing.spec.tsx`. Expected: PASS except the known pre-existing failure.
- [ ] **Step 5:** CHANGELOG bullet; remove "keyboard access for the trajectory overview" from `AGENTS.md` "Later specs". Commit `feat(trajectory): keyboard access for the overview`.

---

## Part 3: subagent views (web only)

### Task 3: Subagent catalog logic (Sonnet)

**Files:**
- Create: `agentry-web/src/chat/subagent-catalog.ts`
- Test: `agentry-web/tests/unit/subagent-catalog.spec.ts` (use `tests/fixtures/live/subagent.json`)

**Interfaces (produce):**
- Read `SubagentActivity` in `src/chat/reducer.ts` and how `SubagentCard.tsx` finds the description first.
- `type CatalogRow = { subagentId: string; parentId: string | null; depth: number; title: string; status: 'running' | 'completed' | 'failed' | 'cancelled'; startedAt: number; endedAt?: number; tokens?: number }`.
- `subagentCatalog(state: ConversationState): CatalogRow[]`: one row per subagent, parents before children, siblings by `startedAt`. `title` = the delegating call's description, else `Subagent <n>`. `tokens` = sum of `usage.total_tokens` over the child's items (undefined when none). Status from the child's last turn.

- [ ] **Step 1: Write failing tests** from the live fixture: row count, titles, a running child, token sum, nesting order.
- [ ] **Step 2: Run** `pnpm vitest run tests/unit/subagent-catalog.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(chat): subagent catalog`.

### Task 4: Subagent tab in the panel (Sonnet)

**Files:**
- Create: `agentry-web/src/ui/chat/SubagentTranscript.tsx` (extracted from the expanded body of `SubagentCard.tsx`)
- Modify: `agentry-web/src/ui/chat/SubagentCard.tsx` (use `SubagentTranscript`; add an "Open in panel" `IconButton`)
- Modify: `agentry-web/src/preview/store.ts` (`agents: { key; subagentId; title }[]`, `openSubagent(s, { subagentId, title })` reusing an open key, `closeSubagent(s, key)`; `active` may be `agent:<key>`; add to actions and no-op default)
- Modify: `agentry-web/src/ui/preview/PreviewPanel.tsx` (tab chips and body for `agent:` tabs: header with title, status, "Show in parent", Chat | Trajectory `ToggleButtonGroup`; Chat = `SubagentTranscript`, Trajectory = `TrajectoryView` over `buildTrajectory(child turns, child items)`)
- Modify: `agentry-web/src/ui/chat/Conversation.tsx` (pass the subagent state to the panel; "Show in parent" reuses the existing reveal of a chat item by id)
- Test: `agentry-web/tests/unit/preview-store.spec.ts`, `agentry-web/tests/component/subagent.spec.tsx`

- [ ] **Step 1: Write failing tests:** reducers (open twice keeps one tab; close falls back to `'start'`); component: "Open in panel" on a card opens a tab whose body shows the child's messages and has no composer; the Trajectory toggle renders ledger rows for the child.
- [ ] **Step 2: Run** `pnpm vitest run tests/unit/preview-store.spec.ts tests/component/subagent.spec.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.** Keep `SubagentCard`'s existing behaviour and tests green.
- [ ] **Step 4: Run** plus `tests/component/preview-panel.spec.tsx tests/component/cards.spec.tsx`. Expected: PASS except known pre-existing failures.
- [ ] **Step 5: Commit** `feat(chat): open a subagent in the side panel`.

### Task 5: Subagents header trigger (Sonnet)

**Files:**
- Create: `agentry-web/src/ui/chat/SubagentsMenu.tsx`
- Modify: `agentry-web/src/ui/chat/Conversation.tsx` (render it in the chat header actions when the catalog is not empty)
- Test: `agentry-web/tests/component/subagents-menu.spec.tsx`

**Interfaces:**
- `SubagentsMenu({ rows: CatalogRow[], onOpen(row) })`: astryx `Button` label `${n} subagents` (singular for 1) opening a `Popover`; rows as astryx `List`/`Item`, indented by `depth`, with a `Spinner` while running, a status icon otherwise, title, duration (`formatSeconds` from `src/ui/trajectory/format.ts`), tokens. Arrow keys move, Enter opens (`actions.openSubagent`), Escape closes.

- [ ] **Step 1: Write failing tests:** hidden for zero rows; label pluralisation; Enter on the second row calls `onOpen` with it; nested row is indented (check a data attribute, not pixels).
- [ ] **Step 2: Run** `pnpm vitest run tests/component/subagents-menu.spec.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.** Read `pnpm exec astryx component Popover` and `List` first.
- [ ] **Step 4: Run.** Expected: PASS. `pnpm typecheck`.
- [ ] **Step 5:** CHANGELOG bullet. Commit `feat(chat): subagents menu in the chat header`.

---

## Part 2: session log

### Task 6: Spike, read a subagent's Session log (Opus)

**Files:** none committed.

- [ ] **Step 1:** Read `dsh-agents-api/src/gateway.ts` `listSubagentItems` and how subagent session ids map to DSH Session ids. Read `~/code/dsh-pinned/packages/session-query` (exports) for `readSession`.
- [ ] **Step 2:** Write a throwaway test with `FakeSessionQuery` to confirm the call shape; then ask the user to run one chat with a subagent on the dev stack and check whether `readSession(<child id>)` returns events both live and after an API restart.
- [ ] **Step 3:** Record the answer under "Spike results". If child logs are not readable after restart, Task 8's subagent routes answer 404 for closed children after a restart, and the spec's open question 4 goes to the user.

### Task 7: API log mapper and redaction (Opus)

**Files:**
- Create: `dsh-agents-api/src/history/session-log.ts`
- Modify: `dsh-agents-api/src/redact.ts` (add `redactDeep(value: unknown): unknown`)
- Test: `dsh-agents-api/tests/history/session-log.spec.ts`, `dsh-agents-api/tests/redact.spec.ts`

**Interfaces (produce):**
- `type LogEvent = { seq: number; type: string; time: number; turn_id?: string; step?: number; data: unknown; truncated?: true }`
- `toLogEvents(events: readonly SessionEvent[], opts: { after: number; limit: number; types?: string[]; maxString: number }): { data: LogEvent[]; has_more: boolean; last_seq: number }`. `turn_id` = `turn_<seq>` of the enclosing `turn/start` (between its start and its `turn/end`); `step` from `data.step` when numeric. `types` are prefixes. Strings longer than `maxString` cut with `…` and `truncated: true`. `last_seq` = seq of the last returned event (or `after` when none).
- `redactDeep`: walks objects and arrays; replaces the value of any key matching `/^(authorization|api[_-]?key|token|access[_-]?token|refresh[_-]?token|secret|client[_-]?secret|password|x-consumer-api-key)$/i` with `MASKED_SECRET`; masks every value under keys `headers` and `env` (as `redactTool` does for MCP). Applied before truncation.

- [ ] **Step 1: Write failing tests:** paging (`after` exclusive, `has_more` at exactly `limit`), turn ids across two turns and events between turns (no `turn_id`), type prefix filter, truncation flag, nested secret masking (`{ config: { headers: { Authorization: 'x' } } }`, `{ apiKey: 'x' }`, arrays of objects).
- [ ] **Step 2: Run** `pnpm vitest run tests/history/session-log.spec.ts tests/redact.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(history): session log mapper with redaction`.

### Task 8: API log routes (Sonnet)

**Files:**
- Modify: `dsh-agents-api/src/history/session-history.ts` (`events(sessionId)` if not added by F3 Task 7)
- Modify: `dsh-agents-api/src/gateway.ts` (routes; config `sessionLog.enabled`)
- Modify: `dsh-agents-api/src/index.ts` and the config schema (`sessionLog: { enabled: boolean }`, default true)
- Modify: `openapi/agentry.yaml`, `CHANGELOG.md`, `docs/README.md`; create `docs/changes/2026-11-26-session-log.md`
- Test: `dsh-agents-api/tests/gateway-log.spec.ts`

**Interfaces:**
- `GET /agents/sessions/:session_id/log?after&limit&types` → `toLogEvents(..., { maxString: 4000 })`; `limit` 1..500 (400 otherwise), default 200.
- `GET /agents/sessions/:session_id/log/:seq` → one `LogEvent` with `maxString: 1_000_000`; 404 if no such seq.
- `GET /agents/sessions/:session_id/subagents/:subagent_id/log` and `/log/:seq`: the same over the child's log (per Task 6).
- Disabled → 404 `not_found` on all four. Every response passes through `redactDeep`.

- [ ] **Step 1: Write failing gateway tests** (server setup as `tests/gateway-history.spec.ts`): paging, `types`, bad `limit` 400, one-event route, other owner 404, disabled 404, a seeded secret masked in output.
- [ ] **Step 2: Run** `pnpm vitest run tests/gateway-log.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Place `/log/:seq` before `/log` and both before the catch-all session routes in `routeTable()`.
- [ ] **Step 4: Run** plus `tests/openapi-drift.spec.ts tests/openapi-contract.spec.ts`. Expected: PASS. `pnpm typecheck && pnpm vitest run`.
- [ ] **Step 5:** Docs. Commit `feat(api): session log routes`.

### Task 9: Web client and allow-list for the log (Sonnet)

**Files:**
- Modify: `agentry-web/src/api/types.ts` (`LogEvent`, `LogPage`), `agentry-web/src/api/client.ts` (`sessionLog(id, { after, limit, types })`, `sessionLogEvent(id, seq)`, `subagentLog(...)`, `subagentLogEvent(...)`)
- Modify: `agentry-web/src/server/allowlist.ts` (GET `.../log`, `.../log/{seq}` with `seq` `^[0-9]{1,12}$`, and the subagent pair)
- Test: `agentry-web/tests/unit/allowlist.spec.ts`, `agentry-web/tests/unit/api-client.spec.ts`

- [ ] **Step 1: Write failing tests** for the four allowed paths (GET only), `log/abc` rejected, query string passed through by the proxy, client URLs.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(api-client): session log`.

### Task 10: Log grouping and summaries (Sonnet)

**Files:**
- Create: `agentry-web/src/ui/log/group-log.ts`
- Create: `agentry-web/tests/fixtures/live/session-log.json` (record from the dev backend with the user's help, or build from `two-turns.json` shapes if no live stack is available; note which in the file's first key `"_source"`)
- Test: `agentry-web/tests/unit/group-log.spec.ts`

**Interfaces (produce):**
- `type LogGroup = { kind: 'turn'; turnId: string; index: number; status?: string; seconds?: number; steps: LogStep[]; loose: LogEvent[] } | { kind: 'loose'; events: LogEvent[] }`, `type LogStep = { step: number; events: LogEvent[] }`.
- `groupLog(events: LogEvent[]): LogGroup[]` (stable for appended pages: grouping a+b equals grouping a then appending b).
- `summarize(e: LogEvent): string`: `tool/call` → `<name>: <first line of args>`; `tool/result` → `<name> → ok|error, <n> chars`; `assistant/message` → first line of text plus tokens if present; `user/message` → first line; `turn/end` → status; otherwise the top-level keys of `data`, comma-joined, 80 chars max.
- `typesIn(events): string[]` (sorted unique) for the filter.

- [ ] **Step 1: Write failing tests** on the fixture.
- [ ] **Step 2: Run** `pnpm vitest run tests/unit/group-log.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(log): group and summarize session events`.

### Task 11: Log view (Sonnet)

**Files:**
- Create: `agentry-web/src/ui/log/LogView.tsx`, `agentry-web/src/ui/log/use-session-log.ts`
- Modify: `agentry-web/src/ui/chat/Conversation.tsx` (`View = 'chat' | 'trajectory' | 'log'`; show "Log" after the first page answers 200; render `LogView`)
- Modify: `agentry-web/src/ui/trajectory/Inspector.tsx` ("Show in log" action) and `TrajectoryView.tsx` (pass the handler)
- Test: `agentry-web/tests/component/log-view.spec.tsx`

**Interfaces:**
- `useSessionLog(sessionId, { running, visible })`: loads pages of 500 from 0 until `has_more` is false (a "Load more" button after 2,000 events instead of loading everything); while `running && visible`, polls `after=last_seq` every 2 s; 404 on the first page → `{ enabled: false }`.
- `LogView({ sessionId, running, focus?: { turnId; step? }, onShowInChat, onShowInTrajectory })`: toolbar (type `MultiSelector`, search `TextInput`, Fold all, Unfold all, Follow tail `ToggleButton`); astryx `Table` rows Seq, Time, Type, Summary under foldable turn and step header rows; selecting a row opens the side panel (`SidePanelLayout` as `TrajectoryView` does) with `JsonView` of `data`, "Load full event" when `truncated` (`api.sessionLogEvent`), "Show in trajectory", "Show in chat". `focus` scrolls to and selects the first event of that turn/step.

- [ ] **Step 1: Write failing component tests** with a mocked client: groups render with turn headers; the type filter hides rows; selecting a truncated row and clicking "Load full event" shows the full text; a 404 first page hides the Log switch in `Conversation`.
- [ ] **Step 2: Run** `pnpm vitest run tests/component/log-view.spec.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.** Read `pnpm exec astryx component Table`, `MultiSelector` first.
- [ ] **Step 4: Run** plus `tests/component/trajectory.spec.tsx`. Expected: PASS except the known pre-existing failure. `pnpm typecheck`.
- [ ] **Step 5:** CHANGELOG bullet. Commit `feat(chat): session log view`.

### Task 12: Subagent log in the subagent tab (Sonnet)

**Files:**
- Modify: `agentry-web/src/ui/preview/PreviewPanel.tsx` (the `agent:` tab's toggle gains "Log", rendering `LogView` with the subagent client calls)
- Modify: `agentry-web/src/ui/log/use-session-log.ts` (accept a loader so it serves both parent and child logs)
- Test: extend `agentry-web/tests/component/subagent.spec.tsx`

- [ ] **Step 1: Write the failing test:** the subagent tab's Log toggle lists the child's events from a mocked `subagentLog`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(chat): subagent session log`.

---

## Part 4: team view (only after the user approves mounting the experimental team packages)

### Task 13: Spike, mount Agent Teams (Opus)

- [ ] **Step 1:** Read `~/code/dsh-pinned/packages/experimental/{agent-team,tool-agent-team,agent-team-profile}/README.md` and their `src/` for the Team service API (`ctx.<name>`), the tool names, and the `agentTeam` projection shape.
- [ ] **Step 2:** Draft the `cordis.patch.yml` rows in `dsh-agents-api` (do not commit); list the tool names to compare with `GET /v1/agents/tools`.
- [ ] **Step 3:** Write the exact `GET /v1/agents/sessions/{id}/team` wire shape from the real projection and the follow-up tasks (API route, web tab, Agents page switch) into this plan, replacing this section. Stop for review.

## Wrap-up (Sonnet)

- [ ] Update `agentry-web/AGENTS.md` "Later specs" (F4 parts done, team pending) and `dsh-agents-api/AGENTS.md` status (log routes).
- [ ] Full checks in both repos. One final review of the whole branch.

## Spike results

(Filled in by Tasks 6 and 13.)
