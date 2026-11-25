# Sandbox terminal (2026-11-25)

Short design, approved in conversation 2026-11-25 (review limited on purpose; a full review is due when the user's token budget resets).

## Why

A sandbox has no SSH, no sshd and no published port by design. The user wants what DeepSeek's web has: a terminal in the product, running inside the sandbox, without opening any port.

## Goals / non-goals

- Goals: a real PTY shell (`agent`, bash, in the sandbox workspace) usable from the browser: vim, top, colours, resize, copy/paste; on the environment detail page (phase 1) and in a chat's right-hand panel for chats that run on a sandbox environment (phase 2).
- Non-goals: terminals for local-environment chats (a host shell); per-terminal permissions; sharing a terminal between users.

## Approaches considered

A. PTY straight through envd (E2B `process` service with `pty`), new Agentry API routes, SSE out and POST in. Chosen for phase 1.
B. Bridge DSH's terminal controller (`remote.terminal`: create/attach/list/close, screen recovery, 8 per session, idle reclaim) to HTTP. Chosen for phase 2 (chats on a sandbox environment), after a spike on the bridge.
C. A line-at-a-time shell over `sandbox_exec`. Rejected: no interactive programs.

## Phase 1 design (A)

API (`dsh-agents-api`), owner-scoped, environment must be a running-or-startable `sandbox` provider environment:

- `POST /agents/environments/{id}/terminals` `{cols,rows}` → `{id, object:'environment.terminal'}`. Starts `bash -l` with a PTY through envd (starts the sandbox first). Max 4 open per owner.
- `GET  /agents/environments/{id}/terminals/{tid}/stream` SSE: `output` events `{data: base64}` (the retained buffer first, then live; 256 KB ring), `exit` `{code}`. Several readers allowed.
- `POST /agents/environments/{id}/terminals/{tid}/input` `{data: string}` (UTF-8, ≤ 64 KB).
- `POST /agents/environments/{id}/terminals/{tid}/resize` `{cols,rows}`.
- `DELETE /agents/environments/{id}/terminals/{tid}`.
- A terminal with no reader for 30 minutes is closed; closing an environment's sandbox or deleting it closes its terminals.

Web: BFF allow-list entries for those routes (state-changing ones need CSRF as usual); one `Terminal` component (xterm.js + fit addon) that opens, streams, sends input (batched), resizes; used on the environment detail page (Terminal tab/section for sandbox environments).

## Phase 2 (B)

Spike first. If the DSH controller bridges cleanly, chats on a sandbox environment get a Terminal tab in the preview panel with the same component, reconnect with scrollback and multiple terminals. If not, phase 2 reuses phase 1's endpoints keyed by the chat's environment.

## Security

The shell runs inside the container as `agent`; the sandbox key stays server-side; the browser only sees terminal ids. Terminals are owner-checked on every route.
