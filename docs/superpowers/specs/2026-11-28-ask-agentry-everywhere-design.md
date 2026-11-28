# Ask Agentry Everywhere — Design

**Date:** 2026-11-28
**Status:** Approved in conversation; written up for the implementation plan.

## Intent

The built-in Agentry assistant is useful on every screen, not just the empty new-chat page. Today its only entry is a sidebar link to `/?agent=agentry`, which navigates away from whatever the user was doing. The user wants a helper available on every signed-in page — including while a page dialog is open — that answers in place without changing the URL. Two smaller frictions came with the request: the starter chips under the composer arrive late and are unwanted, and the new-chat environment chooser appears only after several slow backend reads finish.

## Goals

- A ✨ Ask Agentry launcher is visible on every signed-in page.
- Clicking it (or the existing sidebar ✨ icon) opens a right-side chat drawer over the current page; no route change happens on ask or send.
- The drawer streams a real Agentry session with the built-in `agentry` agent, including tool cards, approval/question cards, subagent cards and a working composer.
- The current page and any dialog underneath stay mounted and keep their state while the drawer is open.
- An explicit “Open full chat” action moves the session to `/c/<id>` only when chosen.
- The drawer keeps its last session id across a full reload.
- The starter chips under the new-chat composer are gone.
- The new-chat environment chooser is present immediately with “Default workspace”, and fills in real choices as each independent request returns.

## Non-goals

- No new backend endpoints; the existing session create/stream/send/answer APIs are used.
- No attempt to make the launcher clickable through a browser-native modal dialog top layer; a global `Ctrl/⌘+Shift+A` shortcut opens the drawer while a dialog has focus.
- No trajectory view, workspace preview panel, chat title menu or sidebar selection state inside the drawer — those remain full-chat features.
- No change to the built-in agent's instructions or tools.

## Constraints

- Follow the repo's global constraints: browser code never holds Agentry credentials; all API calls go through the BFF with the CSRF header.
- UI comes from astryx components and tokens; StyleX is layout glue only. No other CSS framework, no raw hex colors or raw pixel sizes in component styles.
- Exact dependency versions for astryx (`0.7.17`) and StyleX (`0.19.1`) stay unchanged; no new dependency is needed.
- Do not commit; the working tree has other uncommitted work owned by the user.
- Update `CHANGELOG.md` with dated Unreleased bullets for each behavior change.
- Use `export PATH=$HOME/.nvm/versions/node/v24.19.0/bin:$PATH` before pnpm commands.

## Approaches considered

1. **Extract a shell-agnostic chat body from `Conversation`, then wrap it in a drawer.** Reuses the most code but touches the heavily tested full-chat page, its trajectory reveal logic, per-session view state, workspace panel and router callbacks. Higher regression risk for a helper that needs only the message row + composer surface.
2. **Mount the existing `Conversation` page inside the drawer and suppress its chrome via props.** Small diff, but leaves route pushes, `?file=` handling, `TopBar`, title menu and preview panel inside a page component used as a panel. Rejected as fragile.
3. **Build a focused panel chat from the route-agnostic primitives (`useConversation`, `Message`, `Composer`, `ChatLayout`).** Duplicates a small amount of composer/settings wiring but reuses all stream, reconnect, reducer, approval and tool-card machinery, and leaves `Conversation` untouched. **Chosen.**

## Design

### Shell and launcher

- A tiny external store `askAgentryStore` owns `{ isOpen, sessionId }`. It exposes `use()` for React components plus `open()`, `close()` and `setSession(id)`; it persists `sessionId` in `localStorage` and hydrates it on first client read.
- `Shell` renders `AskAgentryLauncher` as a sibling of `AppShell`, so it survives client-side route changes and is available on every signed-in page.
- The launcher renders a floating `IconButton` (Sparkles, `elevation="high"`) and an astryx `Drawer` (`side="end"`, default modal scrim). Drawer top-layer semantics keep it above page content; sibling drawers stack correctly, so no manual z-index is needed.
- A global `keydown` listener opens the same drawer on `Ctrl/⌘+Shift+A`, which still works when a modal dialog has focus.
- The sidebar's existing ✨ icon calls `open()` instead of navigating to `/?agent=agentry`. Its label/tooltip stay “Ask Agentry” and mention the shortcut.

### Panel chat

- `AskAgentryPanel` receives the stored `sessionId` and `onSessionCreated`.
- With no session it shows a compact composer. The model list loads with `api.models()`; the built-in agent is fixed, so no agent/environment/project menus appear. On send it calls `api.createSession` with the same payload shape as `NewChat`, including `agentId: 'agentry'`, writes the first message via `setPendingFirst`, dispatches `SESSIONS_CHANGED`, then calls `onSessionCreated(id)` — no `router.push`.
- With a session it calls `useConversation(sessionId)` and renders `ChatMessageList` + `Message` rows, `Composer`, `Thinking`, `StreamScrollButton`, inline errors and the connection pill. Approval/question cards keep working through `answer`; subagent approval actions are supplied through `PanelConversationContext`.
- The drawer header has “Ask Agentry”, a close button, and an “Open full chat” link to `/c/<id>` (Next `Link`, only followed on explicit click).
- Composer slash commands in the panel map `new`/`clear` to “start a fresh helper chat” (set session id to `null`) rather than navigating.
- A failed create/stream keeps the draft and shows the same error handling as the new-chat page; it never leaves a blank panel.

### New chat fixes

- `ComposerSettings` gains `environmentLoading?: boolean`; `ContextMenus` renders the environment `Selector` whenever `onEnvironmentChange` exists, showing “Default workspace” while the list is empty.
- `NewChat` splits its single `Promise.all` into independent effects: agents, environments, providers/templates (only for fresh-sandbox choices) and the optional project each update their own state when they resolve. URL presets still apply when the relevant list arrives, and a project's stored agent/environment still wins once the project loads.
- `AGENTRY_STARTERS` and the `PromptChips` usage are removed from `NewChat`.

## Testing

- Component test: environment chooser is present before providers/templates resolve; existing environment appears from the fast request; fresh sandbox choices appear later.
- Component test: `?agent=agentry` no longer renders starter chips.
- Unit test: store opens/closes, persists and restores a session id; `open()` after a simulated reload restores the last session.
- Component test: floating launcher and sidebar icon open the drawer without calling `router.push`; the keyboard shortcut opens it too.
- Component test: first panel send creates a session with `agentId: 'agentry'` and no navigation; a streamed reply/approval card renders and `answer` is called.
- Full verification: `pnpm typecheck`, `pnpm build`, `pnpm test`, and `pnpm exec astryx doctor --built src`.
