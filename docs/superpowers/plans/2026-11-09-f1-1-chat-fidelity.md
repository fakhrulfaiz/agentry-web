# F1.1 Chat fidelity — spec addendum and plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (or executing-plans) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

Date: 2026-11-09 · Scope approved by the user in chat ("yes" to items 1–3 plus the composer layout). Extends [F1 spec](../specs/2026-11-08-agentry-web-f1-design.md); F1's Global Constraints still apply (no credentials in the browser, astryx-only UI, no AI attribution in commits, CHANGELOG per task).

## Problem (observed on the live backend, 2026-11-09)

In a real chat (`sess_6525375c3c174bbcb4895574e068a533`) the backend returned 16 items: 2 user messages, 4 `reasoning`, 4 assistant messages, 3 `function_call`, 3 `function_call_output`. The UI rendered reasoning text as ordinary assistant prose and showed no tool cards, no thinking block, and no visible streaming. The backend data is correct; the frontend mapping and rendering are wrong.

## Goal

The conversation shows what the agent is doing, at DSH-web fidelity: a collapsible streaming Thinking block, a tool card per call with live status and output, expandable subagent activity, and a per-turn trace timeline. The composer uses astryx's full-featured ChatComposer.

## Out of scope

Real file upload (needs a new backend upload endpoint — added to the backend backlog), raw Session log and exact per-step model request (backend Task 7 / F2), screenshots (backlog item 2).

## Global constraints for this plan

- Use astryx `@astryxdesign/core/Chat` components and templates: `ChatMessage`, `ChatToolCalls`, `ChatSystemMessage`, `ChatMessageMetadata`, `ChatComposer` (start from template `ChatComposerFullFeatured`, plus `ChatComposerAttachments` / `ChatComposerFooterActions` for missing parts), `CodeBlock`, `Markdown`. Read props with `pnpm exec astryx component <Name>` before use; follow the AGENTS.md astryx rules.
- Proxy allow-list additions (GET only, owner-scoped upstream): `/agents/sessions/{id}/subagents`, `/agents/sessions/{id}/subagents/{subagentId}`, `/agents/sessions/{id}/subagents/{subagentId}/items`, `/agents/sessions/{id}/subagents/{subagentId}/turns`. Same `{id}` segment rule as F1 (R8).
- Every fix is pinned by a test built from a fixture recorded from the real backend.

---

### Task 1: Record real fixtures; fix reasoning, tool, and streaming rendering

**Files:** Create `scripts/record-fixture.ts`, `tests/fixtures/live/*.json`, `tests/unit/reducer-live.spec.ts`. Modify `src/chat/reducer.ts`, `src/ui/chat/ReasoningBlock.tsx`, `src/ui/chat/ToolCard.tsx` (or replace with `ChatToolCalls`), `src/ui/chat/Message.tsx`, `mock/agentry-mock.ts`.

- [ ] **Step 1:** `scripts/record-fixture.ts` (run with `tsx`): reads `AGENTRY_API_URL` and a key from `AGENTRY_FIXTURE_KEY` (never printed, never written), creates a session asking for a web lookup, records (a) the full SSE frames of the turn and (b) `GET /items` and `GET /turns` afterwards, and writes `tests/fixtures/live/web-search.json`. Keep event types and payload fields verbatim. The script asserts the output contains no key before writing. Commit the fixture.
- [ ] **Step 2: Failing tests** `tests/unit/reducer-live.spec.ts` on that fixture: every `reasoning` item becomes a `reasoning` view (never assistant text); each `function_call` pairs with its `function_call_output` by `call_id` into one `tool` view with `status: 'done'` and output; the live SSE fold equals `applyItems` for the same turn; reasoning and text deltas stream into the open views (assistant `streaming: true` until the turn ends); order matches the log.
- [ ] **Step 3:** Fix the reducer. Rendering: Thinking = collapsible block, open while streaming, collapsed to a one-line summary afterwards; tool calls = astryx `ChatToolCalls` (name, short argument summary, status running/done/failed, expandable full arguments and output via `CodeBlock`/`Markdown`).
- [ ] **Step 4:** The mock server emits the fixture's event sequence; update `tests/e2e/f1.spec.ts` so a thinking block and a tool card appear and stream.
- [ ] **Step 5:** `pnpm test && pnpm test:e2e && pnpm build` pass. Commit `fix: render reasoning and tool calls from real backend events`.

### Task 2: Subagent activity

**Files:** Modify `src/server/allowlist.ts`, `src/api/client.ts`, `src/chat/reducer.ts`, `src/ui/chat/SubagentCard.tsx`; tests `tests/unit/allowlist.spec.ts`, `tests/component/subagent.spec.tsx`.

- [ ] Failing tests: the four new allow-list routes are allowed (GET only) and traversal is still rejected; the reducer turns subagent wire events into a `subagent` view with live status; `SubagentCard` collapsed shows name, status, and duration; expanded it loads `/subagents/{sid}/items` and renders them with the same message/thinking/tool components (recursive, depth limit 3).
- [ ] Implement `api.subagents(sessionId)` and `api.subagentItems(sessionId, subagentId)`; implement the card.
- [ ] Record a subagent fixture with `record-fixture.ts` (a prompt that delegates) if the live profile delegates; otherwise build it from the backend's subagent event shapes in `~/code/dsh-agents-api/tests` and say so in the report.
- [ ] Gate + commit `feat: expandable subagent activity`.

### Task 3: Trace view

**Files:** Create `src/ui/trace/TracePanel.tsx`, `src/ui/trace/build-trace.ts`, `tests/unit/build-trace.spec.ts`; modify the conversation page and top bar.

**Interfaces:** `buildTrace(turns: OAITurn[], items: StoredSessionItem[]): TraceTurn[]` with `TraceTurn = { id: string; status: string; startedAt: number; endedAt?: number; usage?: OAITokenUsage; steps: TraceStep[] }` and `TraceStep = { kind: 'user' | 'reasoning' | 'tool' | 'assistant' | 'subagent'; itemId: string; label: string; startedAt?: number; endedAt?: number }`.

- [ ] Failing tests on the live fixture: turns grouped with their items in order; tool steps labeled with the tool name; turn duration and token usage from the turn record; clicking a step scrolls the conversation to that item.
- [ ] Implement; a "Trace" toggle in the top bar opens it in the right panel slot reserved in F1; it updates live.
- [ ] Gate + commit `feat: per-turn trace panel`.

### Task 4: Composer from astryx Full Featured

**Files:** Modify `src/ui/chat/Composer.tsx`; tests `tests/component/composer.spec.tsx`.

- [ ] Scaffold from `pnpm exec astryx template ChatComposerFullFeatured` (and the Attachments / FooterActions variants for parts it lacks), keeping its frame.
- [ ] Footer: model menu (from `api.models()`), reasoning-effort menu (low/medium/high; sent as `reasoning.effort` on session create; for follow-ups disabled with a hint until backend Task 6 lands), send/stop.
- [ ] Attachments drawer and attach button present but disabled, with the tooltip "File attachments need backend support" (backend backlog: upload endpoint).
- [ ] Keep F1 behaviors and their tests: Enter sends, Shift+Enter newline, Stop while running, focus rules.
- [ ] Gate + commit `feat: full-featured composer`.

### Final

- [ ] Manual check against the live backend (`AGENTRY_API_URL=http://127.0.0.1:3080`, dev key): a web-search question shows Thinking, tool cards, and streaming; the trace panel matches.
- [ ] One whole-change review (Sonnet), fix wave, merge to `main` locally.
