# Ask Agentry Everywhere Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Ask Agentry a global in-place drawer available on every signed-in page, remove the late starter chips, and stop slow backend reads from delaying the new-chat environment chooser.

**Architecture:** A tiny external store owns the drawer's open state and last session id; `Shell` mounts a floating launcher plus an astryx `Drawer`. A focused `AskAgentryPanel` reuses `useConversation`, `Message`, `Composer` and `ChatLayout` (not the route-coupled `Conversation` page), so streaming, tool cards and approvals work without touching `/c/[sessionId]`. New-chat data loads are split so each menu appears as its own request returns.

**Tech Stack:** Next.js App Router, React 19 hooks (`useSyncExternalStore`), astryx `Drawer`/`IconButton`/`ChatLayout`, StyleX layout glue, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-28-ask-agentry-everywhere-design.md`

## Global Constraints

- Never put an Agentry access token, refresh token or API key in browser JavaScript, storage or web-app requests. All calls go through `/api/agentry` with the `x-agentry-csrf` header.
- UI from astryx components and tokens; StyleX only for layout glue. No other CSS framework, no raw hex/px values in component styles, no `className` or inline `style`.
- Exact dependency versions for astryx (`0.7.17`) and StyleX (`0.19.1`) stay unchanged; add no dependency.
- Branding is “Agentry”; no Anthropic name, logo, mark, licensed fonts or exact colors.
- Do not commit. The working tree contains other uncommitted user work.
- Update `CHANGELOG.md` under `## Unreleased` with dated bullets for every behavior change.
- Before pnpm commands: `export PATH=$HOME/.nvm/versions/node/v24.19.0/bin:$PATH`.

## Review Focus

- Slow or unreachable sandbox provider: the environment chooser must still be present and usable with “Default workspace” and already-loaded environments; pinned in Task 1.
- A modal dialog has focus: the global shortcut must still open the drawer and the page/dialog underneath must keep its state; pinned in Task 5.
- First panel send before models load: the composer stays disabled and the send never navigates; pinned in Task 4.
- Approval/question cards in the panel: answering one calls the same `answer` used by the full chat; pinned in Task 4.
- Reload or deleted session: the last panel session id is restored (Task 3), and an unknown session shows a usable start state with a “New chat” button rather than a blank drawer (Task 4).

---

## Task 1: Environment chooser appears immediately

**Files:**
- Modify: `src/ui/chat/Composer.tsx` (`ComposerSettings`, `ContextMenus`)
- Modify: `src/ui/chat/NewChat.tsx` (data-loading effect)
- Test: `tests/component/new-chat-seed.spec.tsx` (`New chat environment menu` suite)

**Interfaces:**
- Consumes: `api.listAgents()`, `api.listSandboxEnvironments()`, `api.listSandboxProviders()`, `api.listSandboxTemplates()`, `api.getProject()` from earlier code.
- Produces: `ComposerSettings.environmentLoading?: boolean`; `ContextMenus` renders the environment `Selector` whenever `onEnvironmentChange` is supplied, even while `environments` is empty.

- [ ] **Step 1: Write the failing test**

Add to the `New chat environment menu` suite in `tests/component/new-chat-seed.spec.tsx`. Defer `listSandboxProviders` and `listSandboxTemplates` with a promise the test resolves later; leave `listSandboxEnvironments` resolving immediately with the existing `Data box` fixture. Assert:

```tsx
// Environment menu is usable before the slow provider/template reads finish.
expect(await screen.findByRole('combobox', { name: 'Environment' })).toBeInTheDocument()
expect(await screen.findByText('Data box (Isolated sandbox, stopped)')).toBeInTheDocument()
expect(screen.queryByText('New sandbox for this chat')).not.toBeInTheDocument()
// After resolving both deferred promises:
expect(await screen.findByText('New sandbox for this chat')).toBeInTheDocument()
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run tests/component/new-chat-seed.spec.tsx -t 'environment menu'`
Expected: FAIL — no Environment combobox exists until all deferred reads resolve.

- [ ] **Step 3: Make `ContextMenus` show the baseline menu**

In `src/ui/chat/Composer.tsx`, add `environmentLoading?: boolean` to `ComposerSettings`. Change the `hasEnvironments` guard so the environment `Selector` renders whenever `onEnvironmentChange` exists (not only when `environments.length > 0`), and pass `isLoading={environmentLoading}` to that `Selector`. Keep `environmentOptions()` as the option builder; it already supplies `{ value: '', label: 'Default workspace' }`.

- [ ] **Step 4: Split the independent loads in `NewChat`**

Replace the single `Promise.all` at `src/ui/chat/NewChat.tsx:113-164` with separate background effects/`.then` chains for: agents (sets `agents` and applies `wantedAgent`), environments (sets existing options), providers + templates (appends fresh-sandbox options only when both succeed), and the optional project (applies its agent/model/effort/environment/folder overrides). Set `environmentLoading` from the pending environment/provider/templates requests. Preserve the current URL-preset clearing effect and the rule that a project's stored agent/environment wins once the project loads. Do not change `start()`'s create-session payload.

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm exec vitest run tests/component/new-chat-seed.spec.tsx -t 'environment menu'`
Expected: PASS — menu appears before deferred reads, fresh section appears after.

- [ ] **Step 6: Run the whole new-chat suite**

Run: `pnpm exec vitest run tests/component/new-chat-seed.spec.tsx`
Expected: all existing prefill, send and project tests still pass.

## Task 2: Remove starter chips

**Files:**
- Modify: `src/ui/chat/NewChat.tsx`
- Test: `tests/component/new-chat-seed.spec.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: no `AGENTRY_STARTERS`, no `PromptChips` import or render in `NewChat`.

- [ ] **Step 1: Write the failing test**

Add to `tests/component/new-chat-seed.spec.tsx`:

```tsx
it('does not show starter chips for the built-in Agentry assistant', async () => {
  nav.query = 'agent=agentry'
  apiMock.listAgents.mockResolvedValue(page([{ id: 'agentry', name: 'Agentry', built_in: true, metadata: { description: 'Setup helper' }, tools: [], model: 'm1' }]))
  render(<NewChat />)
  await waitFor(() => expect(apiMock.listAgents).toHaveBeenCalled())
  expect(screen.queryByText('Starter prompts')).not.toBeInTheDocument()
  expect(screen.queryByText(/I don.t know what to build/)).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run tests/component/new-chat-seed.spec.tsx -t 'starter chips'`
Expected: FAIL — the label and chip are rendered.

- [ ] **Step 3: Remove the chips**

Delete `AGENTRY_STARTERS`, the `PromptChips` import, and the conditional `<PromptChips …>` block from `src/ui/chat/NewChat.tsx`. Leave `wantedAgent` and the agent menu intact.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run tests/component/new-chat-seed.spec.tsx -t 'starter chips'`
Expected: PASS.

## Task 3: Ask Agentry store

**Files:**
- Create: `src/ui/shell/ask-agentry-store.ts`
- Test: `tests/unit/ask-agentry-store.spec.ts`

**Interfaces:**
- Consumes: `useSyncExternalStore` from React; `localStorage` on the client only.
- Produces:

```ts
export type AskAgentryState = { isOpen: boolean; sessionId: string | null }
export const askAgentryStore: {
  use(): AskAgentryState
  get(): AskAgentryState
  open(): void
  close(): void
  setSession(id: string | null): void
  reset(): void // tests only
}
```

- [ ] **Step 1: Write the failing test**

Create `tests/unit/ask-agentry-store.spec.ts` with assertions:

```ts
expect(askAgentryStore.get()).toEqual({ isOpen: false, sessionId: null })
askAgentryStore.setSession('sess_1')
askAgentryStore.close()
expect(localStorage.getItem('agentry_ask_session')).toBe('sess_1')
askAgentryStore.reset() // simulate a reload: drop in-memory state, keep storage
askAgentryStore.open()
expect(askAgentryStore.get()).toEqual({ isOpen: true, sessionId: 'sess_1' })
askAgentryStore.setSession(null)
expect(localStorage.getItem('agentry_ask_session')).toBeNull()
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run tests/unit/ask-agentry-store.spec.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the store**

Use a module-level state object, a `Set` of listeners and `useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)`. `getServerSnapshot` always returns `{ isOpen: false, sessionId: null }`. On first client snapshot, hydrate `sessionId` from `localStorage` key `agentry_ask_session`; persist on `setSession`. `reset()` clears in-memory state and listeners' state but deliberately leaves storage untouched. `open()` hydrates from storage if not yet hydrated and sets `isOpen: true`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run tests/unit/ask-agentry-store.spec.ts`
Expected: PASS.

## Task 4: Ask Agentry panel chat

**Files:**
- Create: `src/ui/chat/AskAgentryPanel.tsx`
- Create: `tests/component/ask-agentry-panel.spec.tsx`

**Interfaces:**
- Consumes: `askAgentryStore` is *not* used inside the panel; `useConversation(sessionId)`, `Message`, `Composer`, `ChatLayout`, `ChatMessageList`, `Thinking`, `StreamScrollButton`, `api.createSession`, `setPendingFirst`, `SESSIONS_CHANGED`, `useChatSettings`, `PanelConversationContext`, `splitSubagentActions`/`deriveTasks`/`deriveTodos`/`browserState`, `useSkillCommands`/`useSkillsLoader`.
- Produces:

```ts
export function AskAgentryPanel({ sessionId, onSessionCreated, onNewChat }: {
  sessionId: string | null
  onSessionCreated(id: string): void
  /** Clears the stored session and returns to the start state (slash command / deleted session). */
  onNewChat?(): void
}): React.JSX.Element
```

- [ ] **Step 1: Write the failing tests**

Create `tests/component/ask-agentry-panel.spec.tsx` with `next/navigation` mocked (`push`, `replace`, `usePathname: () => '/scheduled'`), `@/api/client` mocked (`models` → `['m1']`, `getSession` → a session fixture, `createSession` → `{ id: 'sess_1' }`), `@/chat/pending-first` mocked, and `@/chat/use-conversation` mocked. Assert:

```tsx
// Start state: the composer waits for the model list and never navigates on send.
apiMock.models.mockReturnValueOnce(new Promise(() => {}))
render(<AskAgentryPanel sessionId={null} onSessionCreated={vi.fn()} />)
expect(screen.getByRole('button', { name: /Send/ })).toBeDisabled()
// Re-render with models loaded, then send:
apiMock.models.mockResolvedValue(['m1'])
render(<AskAgentryPanel sessionId={null} onSessionCreated={vi.fn()} />)
await user.type(screen.getByRole('combobox', { name: 'Message input' }), 'Help me plan{Enter}')
expect(apiMock.createSession).toHaveBeenCalledWith(expect.objectContaining({ text: 'Help me plan', agentId: 'agentry' }))
expect(onSessionCreated).toHaveBeenCalledWith('sess_1')
expect(nav.push).not.toHaveBeenCalled()

// Session state: an approval card answers through the session hook.
render(<AskAgentryPanel sessionId="sess_1" onSessionCreated={vi.fn()} />)
await user.click(await screen.findByRole('button', { name: 'Allow' }))
expect(answerMock).toHaveBeenCalledWith('act_1', { decision: 'approve' })

// A deleted session offers a way back instead of a blank drawer.
useConversationMock.mockReturnValue({ ...baseState, closedReason: 'not_found' })
render(<AskAgentryPanel sessionId="missing" onSessionCreated={vi.fn()} onNewChat={onNewChat} />)
await user.click(await screen.findByRole('button', { name: 'New chat' }))
expect(onNewChat).toHaveBeenCalled()
```

Use an action-view fixture with `kind: 'action'`, `action.type === 'approval'`, `action.kind === 'tool_approval'`, `id: 'act_1'`; see `tests/component/cards.spec.tsx` for the exact shape.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run tests/component/ask-agentry-panel.spec.tsx`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the start state**

In `src/ui/chat/AskAgentryPanel.tsx`, load `api.models()` into state. With `sessionId === null`, render a compact `ChatLayout` with a `Composer` configured with models/model/effort only (no agent/environment menus), `onSend` that calls `api.createSession({ text, model, ...(effort === 'auto' ? {} : { effort }), agentId: 'agentry' })`, then `setPendingFirst(id, { text })`, `window.dispatchEvent(new Event(SESSIONS_CHANGED))`, and `onSessionCreated(id)`. Show a pending message + `Thinking` while the create is in flight; on failure keep the draft and show an `ErrorBanner`/composer error. Never call `router.push` here.

- [ ] **Step 4: Implement the session state**

With a non-null `sessionId`, call `useConversation(sessionId)` and load the session resource with `api.getSession(sessionId)` for `useChatSettings(session)`. Render `ChatMessageList` with one `Message` per `state.items`, `Thinking` while waiting, `StreamScrollButton`, inline errors/connection pill, and a `Composer` whose `onSend` calls `send(text)` and whose model/effort menus use `useChatSettings(session)` with the same 409 `session_setting_not_live` revert behavior as `Conversation`. Provide `PanelConversationContext` from `state` (`deriveTasks`, `state.jobs`, `splitSubagentActions(state.items)`, `deriveTodos`, `browserState`, subagent items, `answer`) so subagent approval cards work. If `closedReason === 'not_found'`, render an `EmptyState` with a “New chat” button that calls `onNewChat` instead of the thread. Map slash-command `new`/`clear` to `onNewChat`, not navigation.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm exec vitest run tests/component/ask-agentry-panel.spec.tsx`
Expected: PASS.

## Task 5: Global launcher, shell wiring and changelog

**Files:**
- Create: `src/ui/shell/AskAgentryLauncher.tsx`
- Create: `tests/component/ask-agentry-launcher.spec.tsx`
- Modify: `src/ui/shell/Shell.tsx`
- Modify: `src/ui/shell/Sidebar.tsx` (`Ask Agentry` row)
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: `askAgentryStore` (Task 3), `AskAgentryPanel` (Task 4), astryx `Drawer`, `DrawerHeader`, `IconButton`, `Icon`/`SparklesIcon`, `VStack`.
- Produces: `<AskAgentryLauncher />` mounted once by `Shell`; both the launcher and the sidebar icon call `askAgentryStore.open()`.

- [ ] **Step 1: Write the failing test**

Create `tests/component/ask-agentry-launcher.spec.tsx`. Mock `next/navigation` and `@/ui/chat/AskAgentryPanel` to a visible stub labelled `AskAgentryPanel`. Assert:

```tsx
render(<AskAgentryLauncher />)
await user.click(await screen.findByRole('button', { name: /Ask Agentry/ }))
expect(screen.getByText('AskAgentryPanel')).toBeInTheDocument()
expect(nav.push).not.toHaveBeenCalled()

fireEvent.keyDown(window, { key: 'a', ctrlKey: true, shiftKey: true })
expect(askAgentryStore.get().isOpen).toBe(true)
```

Also render `Shell` with a stub identity and assert clicking the sidebar's `Ask Agentry` icon opens the same drawer without `router.push`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run tests/component/ask-agentry-launcher.spec.tsx`
Expected: FAIL — launcher module does not exist.

- [ ] **Step 3: Implement the launcher**

Create `src/ui/shell/AskAgentryLauncher.tsx`. Use `askAgentryStore.use()` for `{ isOpen, sessionId }`. Render a floating `IconButton` (`label="Ask Agentry"`, `tooltip="Ask Agentry (Ctrl/⌘+Shift+A)"`, `icon={<Icon icon={SparklesIcon} />}`, `elevation="high"`, `onClick={askAgentryStore.open}`) in a StyleX-positioned fixed container using spacing/color tokens. Render an astryx `Drawer` (`isOpen`, `onOpenChange={(open) => open ? askAgentryStore.open() : askAgentryStore.close()}`, `label="Ask Agentry"`, `side="end"`, `width={440}`) containing `DrawerHeader` with title “Ask Agentry”, a close icon button, and a `Link` to `/c/${sessionId}` labelled “Open full chat” only when a session exists. Below it render `<AskAgentryPanel sessionId={sessionId} onSessionCreated={askAgentryStore.setSession} onNewChat={() => askAgentryStore.setSession(null)} />`. Add a `keydown` effect that calls `open()` on `Ctrl/⌘+Shift+A` and stops only that event's default; do not interfere with other shortcuts.

- [ ] **Step 4: Wire the shell and sidebar**

In `src/ui/shell/Shell.tsx`, render `<AskAgentryLauncher />` as a sibling of `<AppShell>` so it survives route changes. In `src/ui/shell/Sidebar.tsx:533`, replace `href="/?agent=agentry"` with `onClick={() => askAgentryStore.open()}` and keep the label, tooltip and icon; update the comment to say it opens the global helper drawer.

- [ ] **Step 5: Run the launcher test to verify it passes**

Run: `pnpm exec vitest run tests/component/ask-agentry-launcher.spec.tsx`
Expected: PASS.

- [ ] **Step 6: Update the changelog**

Add dated bullets under `## Unreleased` in `CHANGELOG.md` for: the global Ask Agentry drawer (including no navigation and the shortcut), removal of starter chips, and the environment chooser appearing immediately with incremental choices.

- [ ] **Step 7: Do not commit**

Leave all changes uncommitted. Report the files changed instead.

## Final verification

Run from the repo root after all tasks:

```bash
export PATH=$HOME/.nvm/versions/node/v24.19.0/bin:$PATH
pnpm typecheck
pnpm test
pnpm build
pnpm exec astryx doctor --built src
```

Expected: typecheck, build and astryx doctor clean; Vitest green apart from the known pre-existing `tests/component/browser-tab.spec.tsx` “stops the stream while the page is hidden and reopens it when shown” failure if it still occurs on this machine. Report any failure with its exact output; do not claim success without fresh evidence.
