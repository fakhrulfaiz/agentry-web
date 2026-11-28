# Chat header environment chip (design)

Date: 2026-11-28. Status: proposed, awaiting approval. This is the first of two agreed pieces; subagent views come after it and get their own design.

## Intent

When a chat is open, a person cannot tell whether they are in the default server workspace or one of their named sandboxes. Show that answer in the chat header, at a glance, for both Chat and Trajectory views. The user chose **name + live state** for sandbox chats (for example `Data box · Running`), with a plain fallback for local chats.

## Goals / non-goals / anti-goals

- Goals: identify the environment of the open chat without opening another page; show whether its sandbox is running, stopped, setting up, failed, gone, etc.; stay correct when the environment was deleted or its state changes.
- Non-goals: switching environments mid-chat, starting/stopping from the chip, clicking through to the environment detail page, polling for state, API or BFF changes.
- Anti-goal: a chip that is wrong or silently stale — do not show a stopped sandbox as running after a restart, and do not pretend a deleted sandbox still exists.

## Constraints and what exists

- The header is `TopBar` in `src/ui/chat/Conversation.tsx:440-449`; `end` currently holds `PreviewControls` and `ConnectionPill`. Both views share it.
- `Conversation` already loads `OAIAgentSession` (`src/ui/chat/Conversation.tsx:263-275`) with `session.environment: OAIEnvironmentConfig` (`src/api/types.ts:271-287`). A sandbox config is `{ type: 'sandbox', environment_id: string }`; local is `{ type: 'local', workspace_directory }` and legacy rows can be `{ type: 'none' }` (`dsh-agents-api/src/session-resource.ts:20-37`).
- `api.getSandboxEnvironment(id)` already exists (`src/api/client.ts:497-498`) and the BFF allow-list already permits `GET agents/environments/{id}` (`src/server/allowlist.ts:62-63`). The wire resource has `name`, `provider`, `status` and `sandbox.state` (`src/api/types.ts:847-884`).
- Reuse the existing words: `environmentName`, `environmentLook`, `providerTitle`, `shortId` in `src/ui/sandboxes/format.ts:19-53`. The Sandboxes detail page already refreshes on focus (`src/ui/sandboxes/EnvironmentDetail.tsx:123-150`), so that is the established refresh convention.
- Astryx `Token` (`label`, `size`, `icon`, `description`) and `StatusDot` (`variant`, `label`, `tooltip`) are the right primitives; the dot's text label must stay visible, as its docs require.

## Approaches considered

1. **Chip from session config + one existing environment GET (chosen).** Read the id from the loaded session, fetch the environment resource with the existing client, render name + state. No contract change, one extra request per chat open, refresh on focus. Fits the size of the problem.
2. **Add an API route that joins session and environment.** One response and no client-side join, but it changes the wire contract (OpenAPI drift/contract tests, new route, docs) for a header label. Rejected as disproportionate.
3. **Config-only label (`Sandbox env_…`).** No extra request, but it cannot show the name or live state the user asked for. Rejected.

## Decided design

- New pure helper `src/ui/chat/environment-chip.ts`: `environmentChip(environment: OAIEnvironmentConfig | undefined, env: SandboxEnvironment | null | undefined, error?: ApiError | null)` returns `{ label, variant, description }`.
  - No sandbox id (`local`, `none`, missing): `Server`, neutral, “Default workspace on this server”.
  - Sandbox id, details not loaded yet: `Sandbox`, neutral, “Loading environment details…”.
  - Loaded: `${environmentName(env)} · ${environmentLook(env).text}`, with that look's status variant; description uses `providerTitle(env.provider)` and the state.
  - `404`: `Removed sandbox`, neutral, “This chat’s sandbox no longer exists”.
  - Other fetch failure: `Sandbox`, neutral, “Could not load environment details” (short id in the description).
- New `src/ui/chat/ChatEnvironmentChip.tsx`: astryx `Token size="sm"` with a `StatusDot` in `icon` and the description on both (`description` prop and dot `tooltip`). Non-interactive.
- In `Conversation`, render it in the header `end` `HStack`, before `PreviewControls`, under the same `session && !blank` condition as the other controls. Fetch on environment-id change and refresh on window focus / `visibilitychange`; ignore out-of-order responses with a live flag. No polling.
- Testing: unit tests for every helper branch (including legacy `none`, 404 and fetch error), and a component test that the chip renders the chosen label/variant and that opening a sandbox chat triggers `getSandboxEnvironment` with its id. Keep the existing header tests green.
- Bookkeeping: CHANGELOG bullet and the priority list in `AGENTS.md` when the behavior lands.

## Left to the plan

Exact test commands, file-by-file steps and commit boundaries. Nothing here requires an API repo change.
