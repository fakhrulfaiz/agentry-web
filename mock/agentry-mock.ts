/**
 * Mock Agentry API for local development and the Playwright e2e (Task 8).
 *
 * Run: `pnpm mock:api` (port 4010, or `MOCK_PORT`), then start the web app with
 * `AGENTRY_WEB_AUTH=apikey AGENTRY_API_URL=http://localhost:4010`.
 *
 * In-memory implementation of the routes the web app's allow-list forwards
 * (`/v1/agents`, `/v1/agents/tools`, `/v1/agents/{id}`, sessions create/list/
 * get/update/delete, events post, items, turns) plus the SSE stream
 * `GET /v1/agents/sessions/{id}/events?stream=true`. Wire shapes follow the
 * backend's `src/history/projector.ts` (frame order, deterministic `evt_<session>_<n>`
 * ids). Any `Authorization: Bearer agk_…` is accepted as owner `mock`; anything
 * else answers 401 `unauthenticated`.
 *
 * SSE replay: `Last-Event-ID: n` writes every frame with id > n, then continues
 * live (a non-numeric id replays everything). Without the header the stream
 * starts with one id-less status snapshot. Approval/question frames are id-less
 * (ephemeral) and never replayed, as in backend Task 6 (provisional). Unlike the
 * backend at 4307e21, the mock also emits `item.added`/`item.done` for user
 * messages and function calls, so the conversation renders them live.
 * `GET .../items` returns the same items with the same ids and `turn_id`s as the
 * stream's item frames, so the client's items-then-replay load (R14) collapses them.
 *
 * Scripted turns: the reply is chosen by keywords in the user's message
 * (case-insensitive, first match wins):
 *   - "fail" or "error"        → the turn fails: `turn.failed` with
 *                                 `Mock failure: the model is unavailable`, session status `failed`.
 *   - "approve" or "approval"  → a `delete_files` function call, then an approval
 *                                 (`kind: 'tool_approval'`, options approve/deny) and status
 *                                 `requires_action`. `approve` runs the tool and replies
 *                                 "Done. I deleted the files."; `deny` fails the tool and replies
 *                                 "Okay, I left the files alone.".
 *   - "question" or "ask"      → a user question (`kind: 'user_question'`, "Which color do you
 *                                 prefer?", options Red/Blue). `answer` with
 *                                 `{ selected: ['Red'] }` (or `custom`) replies "You picked Red.";
 *                                 `deny` replies "No problem, skipping the question.".
 *   - "slow"                   → streams about 60 words, one every 500 ms (~30 s): use it to
 *                                 test Stop (`agent.session.input.cancel` → `turn.cancelled`,
 *                                 notice "Stopped") and reconnect.
 *   - "tool"                   → a `search` function call that completes after 400 ms, then a reply.
 *   - "delegate" or "subagent" → a subagent turn ("researcher") that completes, then a reply.
 *   - anything else            → a reasoning summary and a short streamed Markdown reply.
 * A message sent while a turn runs is recorded as steering; the running script continues.
 *
 * Test hooks (no auth):
 *   - `POST /__mock/drop`  destroys every open SSE connection (the client must reconnect
 *                          with `Last-Event-ID`). Answers `{ dropped: n }`.
 *   - `POST /__mock/reset` forgets every session and drops streams.
 *   - `GET /health`.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type {
  OAIAgent,
  OAIAgentSession,
  OAIApprovalAction,
  OAISessionEvent,
  OAISessionItem,
  OAITurn,
  SessionStatus,
  StoredSessionItem,
} from '../src/api/types'

const PORT = Number(process.env.MOCK_PORT ?? 4010)
const DEFAULT_MODEL = 'mock-model'
const KEEPALIVE_MS = 15_000

type WireBody = OAISessionEvent extends infer E ? (E extends unknown ? Omit<E, 'event_id'> : never) : never
type Decision = { decision: 'approve' | 'deny' | 'answer'; payload?: unknown }

interface Frame {
  id: number
  event: OAISessionEvent
}

interface MockSession {
  id: string
  createdAt: number
  lastActiveAt: number
  status: SessionStatus
  error: string | null
  metadata: Record<string, string>
  agent: OAIAgent
  frames: Frame[]
  items: StoredSessionItem[]
  turns: OAITurn[]
  clients: Set<ServerResponse>
  seq: number
  turn?: { turn: OAITurn; abort: AbortController }
  pending?: { action: OAIApprovalAction; resolve: (d: Decision) => void }
}

class HttpError extends Error {
  status: number
  code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

const now = () => Math.floor(Date.now() / 1000)
const sessions = new Map<string, MockSession>()
let counter = 0

function agentConfig(id: string, model: string, name: string | null = null): OAIAgent {
  const at = now()
  return { id, object: 'agent', created_at: at, updated_at: at, name, instructions: null, model, metadata: {}, tools: [] }
}

const SAVED_AGENTS: OAIAgent[] = [
  agentConfig('agent_writer', 'mock-large', 'Writer'),
  agentConfig('agent_helper', 'mock-small', 'Helper'),
]

// ---------- session state and frames ----------

/** The session resource. Durable frames never carry approvals (they are ephemeral overlays). */
function resource(s: MockSession, withApprovals: boolean): OAIAgentSession {
  return {
    id: s.id,
    object: 'agent.session',
    created_at: s.createdAt,
    last_active_at: s.lastActiveAt,
    status: s.status,
    error: s.error,
    metadata: s.metadata,
    vault_ids: [],
    agent: s.agent,
    environment: { type: 'local' },
    required_actions: withApprovals && s.pending ? [s.pending.action] : [],
    usage: null,
  }
}

function write(res: ServerResponse, frame: { id?: number; event: OAISessionEvent }): void {
  res.write(`${frame.id === undefined ? '' : `id: ${frame.id}\n`}data: ${JSON.stringify(frame.event)}\n\n`)
}

function emit(s: MockSession, body: WireBody): void {
  const id = s.frames.length + 1
  const frame: Frame = { id, event: { ...body, event_id: `evt_${s.id}_${id}` } as OAISessionEvent }
  s.frames.push(frame)
  s.lastActiveAt = now()
  for (const client of s.clients) write(client, frame)
}

function emitEphemeral(s: MockSession, body: WireBody): void {
  const event = { ...body, event_id: `evt_${s.id}_e${Date.now()}` } as OAISessionEvent
  for (const client of s.clients) write(client, { event })
}

function statusFrame(status: SessionStatus): 'agent.session.idle' | 'agent.session.in_progress' | 'agent.session.requires_action' | 'agent.session.failed' {
  return `agent.session.${status}`
}

function setOverlay(s: MockSession): void {
  s.status = s.pending ? 'requires_action' : s.turn ? 'in_progress' : 'idle'
  emitEphemeral(s, { type: statusFrame(s.status), session: resource(s, true) })
}

function itemEvents(s: MockSession, turnId: string, item: OAISessionItem): void {
  s.items.push(item)
  emit(s, { type: 'agent.session.turn.item.added', session_id: s.id, turn_id: turnId, item })
  emit(s, { type: 'agent.session.turn.item.done', session_id: s.id, turn_id: turnId, item })
}

function userMessage(s: MockSession, turnId: string, text: string): void {
  s.seq += 1
  itemEvents(s, turnId, { id: `item_msg_${s.seq}`, type: 'message', role: 'user', content: [{ type: 'input_text', text }], status: 'completed', turn_id: turnId })
}

// ---------- scripted turns ----------

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error('aborted'))
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new Error('aborted'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

async function streamText(s: MockSession, turnId: string, chunks: string[], everyMs: number, signal: AbortSignal): Promise<void> {
  s.seq += 1
  const id = `item_msg_${s.seq}`
  const base = { session_id: s.id, turn_id: turnId }
  emit(s, { type: 'agent.session.turn.item.added', ...base, item: { id, type: 'message', role: 'assistant', content: [], status: 'in_progress', turn_id: turnId } })
  let text = ''
  try {
    for (const delta of chunks) {
      await wait(everyMs, signal)
      text += delta
      emit(s, { type: 'agent.session.turn.output_text.delta', item_id: id, output_index: 0, content_index: 0, ...base, delta })
    }
  } finally {
    // A cancelled reply is saved with the text streamed so far.
    const item: OAISessionItem = { id, type: 'message', role: 'assistant', content: [{ type: 'output_text', text }], status: 'completed', turn_id: turnId }
    s.items.push(item)
    emit(s, { type: 'agent.session.turn.output_text.done', item_id: id, output_index: 0, content_index: 0, ...base, text })
    emit(s, { type: 'agent.session.turn.item.done', ...base, item })
  }
}

const words = (text: string) => text.split(/(?<= )/)

async function functionCall(
  s: MockSession,
  turnId: string,
  name: string,
  args: Record<string, unknown>,
  run: () => Promise<{ output: string; failed?: boolean }>,
): Promise<void> {
  s.seq += 1
  const callId = `call_${s.seq}`
  const call: OAISessionItem = { id: `item_fn_${s.seq}`, type: 'function_call', name, call_id: callId, arguments: args, status: 'in_progress', turn_id: turnId }
  s.items.push(call)
  emit(s, { type: 'agent.session.turn.item.added', session_id: s.id, turn_id: turnId, item: call })
  const { output, failed } = await run()
  s.seq += 1
  const out: OAISessionItem = {
    id: `item_fn_out_${s.seq}`,
    type: 'function_call_output',
    call_id: callId,
    output,
    status: failed ? 'failed' : 'completed',
    turn_id: turnId,
    ...(failed ? { error: output } : {}),
  }
  s.items.push(out)
  emit(s, { type: 'agent.session.turn.item.done', session_id: s.id, turn_id: turnId, item: out })
}

function ask(s: MockSession, action: OAIApprovalAction, signal: AbortSignal): Promise<Decision> {
  return new Promise((resolve, reject) => {
    s.pending = {
      action,
      resolve: (d) => {
        s.pending = undefined
        setOverlay(s)
        resolve(d)
      },
    }
    setOverlay(s)
    signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
  })
}

async function script(s: MockSession, turnId: string, text: string, signal: AbortSignal): Promise<void> {
  const t = text.toLowerCase()
  if (t.includes('fail') || t.includes('error')) {
    await wait(300, signal)
    throw Object.assign(new Error('Mock failure: the model is unavailable'), { code: 'model_error' })
  }
  if (t.includes('approve') || t.includes('approval')) {
    let decision: Decision = { decision: 'deny' }
    await functionCall(s, turnId, 'delete_files', { path: '/tmp/mock' }, async () => {
      decision = await ask(s, {
        type: 'approval',
        id: `appr_${s.id}_${s.seq}`,
        kind: 'tool_approval',
        prompt: 'Allow delete_files to remove /tmp/mock?',
        options: ['approve', 'deny'],
        tool_name: 'delete_files',
        call_id: `call_${s.seq}`,
      }, signal)
      return decision.decision === 'approve' ? { output: 'Deleted 3 files.' } : { output: 'Denied by the user', failed: true }
    })
    const reply = decision.decision === 'approve' ? 'Done. I deleted the files.' : 'Okay, I left the files alone.'
    return streamText(s, turnId, words(reply), 40, signal)
  }
  if (t.includes('question') || t.includes('ask')) {
    const d = await ask(s, {
      type: 'approval',
      id: `appr_${s.id}_q${s.seq}`,
      kind: 'user_question',
      prompt: 'Which color do you prefer?',
      options: ['Red', 'Blue'],
      questions: [{ id: 'q1', question: 'Which color do you prefer?', options: [{ label: 'Red' }, { label: 'Blue' }] }],
    }, signal)
    const payload = (d.payload ?? {}) as { selected?: string[]; custom?: string; answers?: Array<{ selected?: string[]; custom?: string }> }
    const first = payload.answers?.[0] ?? payload
    const picked = first.custom || first.selected?.join(', ')
    const reply = d.decision === 'answer' && picked ? `You picked ${picked}.` : 'No problem, skipping the question.'
    return streamText(s, turnId, words(reply), 40, signal)
  }
  if (t.includes('slow')) {
    const long = Array.from({ length: 60 }, (_, i) => `word${i + 1} `)
    return streamText(s, turnId, long, 500, signal)
  }
  if (t.includes('tool')) {
    await functionCall(s, turnId, 'search', { query: text.slice(0, 40) }, async () => {
      await wait(400, signal)
      return { output: '3 results: alpha, beta, gamma' }
    })
    return streamText(s, turnId, words('I searched and found **3 results**: alpha, beta and gamma.'), 40, signal)
  }
  if (t.includes('delegate') || t.includes('subagent')) {
    const child: OAITurn = { ...newTurn(s), id: `turn_${s.id}_child${s.seq}`, subagent_id: 'researcher' }
    emit(s, { type: 'agent.session.turn.created', session_id: s.id, turn: child })
    await wait(500, signal)
    const done: OAITurn = { ...child, status: 'completed', completed_at: now() }
    emit(s, { type: 'agent.session.turn.completed', session_id: s.id, turn_id: child.id, turn: done })
    return streamText(s, turnId, words('The researcher finished: everything checks out.'), 40, signal)
  }
  s.seq += 1
  itemEvents(s, turnId, {
    id: `item_reason_${s.seq}`,
    type: 'reasoning',
    summary: [{ type: 'summary_text', text: 'The user sent a message; reply briefly with a little Markdown.' }],
    status: 'completed',
    turn_id: turnId,
  })
  const reply = `Hello from the **mock** Agentry API.\n\nYou said: _${text.replace(/[_*`]/g, '')}_\n\n- streamed\n- in chunks\n\n\`\`\`ts\nconst ok = true\n\`\`\`\n`
  return streamText(s, turnId, words(reply), 40, signal)
}

function newTurn(s: MockSession): OAITurn {
  const at = now()
  s.seq += 1
  return {
    id: `turn_${s.seq}`,
    object: 'agent.session.turn',
    session_id: s.id,
    agent_id: s.agent.id,
    status: 'in_progress',
    created_at: at,
    started_at: at,
    completed_at: null,
    subagent_id: null,
    error: null,
    usage: null,
  }
}

function startTurn(s: MockSession, text: string): void {
  const turn = newTurn(s)
  const abort = new AbortController()
  s.turns.push(turn)
  s.turn = { turn, abort }
  s.status = 'in_progress'
  s.error = null
  emit(s, { type: 'agent.session.in_progress', session: resource(s, false) })
  emit(s, { type: 'agent.session.turn.created', session_id: s.id, turn: { ...turn } })
  emit(s, { type: 'agent.session.turn.in_progress', session_id: s.id, turn: { ...turn } })
  userMessage(s, turn.id, text)

  script(s, turn.id, text, abort.signal).then(
    () => endTurn(s, turn, 'completed'),
    (error: Error & { code?: string }) =>
      abort.signal.aborted
        ? endTurn(s, turn, 'cancelled')
        : endTurn(s, turn, 'failed', { code: error.code ?? 'mock_error', message: error.message }),
  )
}

function endTurn(s: MockSession, turn: OAITurn, status: 'completed' | 'failed' | 'cancelled', error: OAITurn['error'] = null): void {
  if (s.turn?.turn !== turn) return
  turn.status = status
  turn.completed_at = now()
  turn.error = error
  s.turn = undefined
  s.pending = undefined
  emit(s, { type: `agent.session.turn.${status}`, session_id: s.id, turn_id: turn.id, turn: { ...turn } })
  s.status = status === 'failed' ? 'failed' : 'idle'
  s.error = error?.message ?? null
  emit(s, { type: 'agent.session.idle', session: resource(s, false) })
}

function cancelTurn(s: MockSession): void {
  if (!s.turn) return
  if (s.pending) {
    s.pending = undefined
    setOverlay(s)
  }
  s.turn.abort.abort()
}

// ---------- HTTP ----------

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

function list<T extends { id: string }>(rows: T[], url: URL): { object: 'list'; data: T[]; first_id: string | null; last_id: string | null; has_more: boolean } {
  const limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit') ?? 20) || 20))
  const after = url.searchParams.get('after')
  const start = after ? rows.findIndex((r) => r.id === after) + 1 : 0
  const data = rows.slice(start, start + limit)
  return { object: 'list', data, first_id: data[0]?.id ?? null, last_id: data.at(-1)?.id ?? null, has_more: start + limit < rows.length }
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  if (chunks.length === 0) return {}
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    throw new HttpError(400, 'invalid_json', 'Request body is not valid JSON')
  }
}

function inputText(input: unknown): string {
  if (typeof input === 'string') return input
  if (!Array.isArray(input)) return ''
  return input
    .flatMap((m: { content?: Array<{ text?: string }> }) => (m.content ?? []).map((c) => c.text ?? ''))
    .join('')
}

function getSession(id: string): MockSession {
  const s = sessions.get(id)
  if (!s) throw new HttpError(404, 'resource_not_found', `No session found with id '${id}'`)
  return s
}

function openStream(req: IncomingMessage, res: ServerResponse, s: MockSession): void {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
  res.flushHeaders()
  const header = req.headers['last-event-id']
  const last = Array.isArray(header) ? header[0] : header
  if (last === undefined) {
    write(res, { event: { type: statusFrame(s.status), event_id: `evt_${s.id}_snapshot`, session: resource(s, true) } as OAISessionEvent })
  } else {
    const after = /^\d+$/.test(last) ? Number(last) : 0
    for (const frame of s.frames) if (frame.id > after) write(res, frame)
  }
  s.clients.add(res)
  const ping = setInterval(() => res.write(': ping\n\n'), KEEPALIVE_MS)
  res.on('close', () => {
    clearInterval(ping)
    s.clients.delete(res)
  })
}

function createSession(body: Record<string, unknown>): MockSession {
  const agentBody = (body.agent ?? {}) as { model?: unknown }
  const saved = typeof body.agent_id === 'string' ? SAVED_AGENTS.find((a) => a.id === body.agent_id) : undefined
  if (typeof body.agent_id === 'string' && !saved) throw new HttpError(404, 'resource_not_found', `No agent found with id '${body.agent_id}'`)
  const model = typeof agentBody.model === 'string' && agentBody.model ? agentBody.model : saved?.model
  if (!model) throw new HttpError(400, 'invalid_request_error', 'agent.model is required when agent_id is omitted')
  counter += 1
  const id = `sess_mock${counter}`
  const at = now()
  const s: MockSession = {
    id,
    createdAt: at,
    lastActiveAt: at,
    status: 'idle',
    error: null,
    metadata: (body.metadata as Record<string, string> | undefined) ?? {},
    agent: { ...(saved ?? agentConfig(`agent_${id}`, model)), model },
    frames: [],
    items: [],
    turns: [],
    clients: new Set(),
    seq: 0,
  }
  sessions.set(id, s)
  emit(s, { type: 'agent.session.created', session: resource(s, false) })
  const text = inputText(body.input)
  if (text) startTurn(s, text)
  return s
}

function postEvents(s: MockSession, body: Record<string, unknown>): void {
  const events = Array.isArray(body.events) ? (body.events as Array<Record<string, unknown>>) : []
  if (events.length === 0) throw new HttpError(400, 'invalid_request_error', 'events must be a non-empty array')
  for (const event of events) {
    switch (event.type) {
      case 'agent.session.input.message': {
        const text = inputText(event.input)
        if (!text) throw new HttpError(400, 'invalid_request_error', 'message input is empty')
        if (s.turn) userMessage(s, s.turn.turn.id, text)
        else startTurn(s, text)
        break
      }
      case 'agent.session.input.cancel':
        cancelTurn(s)
        break
      case 'agent.session.input.approval_response': {
        if (!s.pending || s.pending.action.id !== event.id) throw new HttpError(404, 'approval_not_found', `No pending approval '${String(event.id)}'`)
        const decision = event.decision
        if (decision !== 'approve' && decision !== 'deny' && decision !== 'answer') {
          throw new HttpError(400, 'invalid_approval_response', 'decision must be approve, deny or answer')
        }
        const question = s.pending.action.kind === 'user_question'
        if ((decision === 'answer') !== question && !(question && decision === 'deny')) {
          throw new HttpError(400, 'decision_not_applicable', `decision '${decision}' does not apply to this action`)
        }
        s.pending.resolve({ decision, payload: event.payload })
        break
      }
      default:
        throw new HttpError(400, 'invalid_request_error', `Unsupported input event type '${String(event.type)}'`)
    }
  }
}

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://mock')
  const method = req.method ?? 'GET'
  const path = url.pathname.replace(/\/+$/, '') || '/'

  if (path === '/health') return send(res, 200, { ok: true, service: 'agentry-mock' })
  if (method === 'POST' && path === '/__mock/drop') {
    let dropped = 0
    for (const s of sessions.values()) for (const client of s.clients) {
      client.destroy()
      dropped += 1
    }
    return send(res, 200, { dropped })
  }
  if (method === 'POST' && path === '/__mock/reset') {
    for (const s of sessions.values()) {
      s.turn?.abort.abort()
      for (const client of s.clients) client.destroy()
    }
    sessions.clear()
    return send(res, 200, { ok: true })
  }

  if (!path.startsWith('/v1/')) throw new HttpError(404, 'not_found', `No route ${method} ${path}`)
  if (!/^Bearer agk_\S+$/.test(req.headers.authorization ?? '')) {
    res.setHeader('www-authenticate', 'Bearer')
    throw new HttpError(401, 'unauthenticated', 'Missing or invalid credential')
  }

  const parts = path.split('/').slice(2) // after "/v1"
  const [a, b, c, d] = parts
  if (a !== 'agents') throw new HttpError(404, 'not_found', `No route ${method} ${path}`)

  if (parts.length === 1 && method === 'GET') return send(res, 200, list(SAVED_AGENTS, url))
  if (parts.length === 2 && b === 'tools' && method === 'GET') return send(res, 200, { object: 'list', data: [], first_id: null, last_id: null, has_more: false })
  if (parts.length === 2 && b === 'sessions') {
    if (method === 'GET') {
      const rows = [...sessions.values()].reverse().map((s) => resource(s, true))
      return send(res, 200, list(rows, url))
    }
    if (method === 'POST') return send(res, 200, resource(createSession(await readJson(req)), true))
  }
  if (parts.length === 2 && method === 'GET') {
    const agent = SAVED_AGENTS.find((x) => x.id === b)
    if (!agent) throw new HttpError(404, 'resource_not_found', `No agent found with id '${b}'`)
    return send(res, 200, agent)
  }
  if (b === 'sessions' && c) {
    const s = getSession(c)
    if (parts.length === 3) {
      if (method === 'GET') return send(res, 200, resource(s, true))
      if (method === 'POST') {
        const body = await readJson(req)
        if (body.metadata && typeof body.metadata === 'object') s.metadata = body.metadata as Record<string, string>
        const model = (body.agent as { model?: unknown } | undefined)?.model
        if (typeof model === 'string' && model) s.agent = { ...s.agent, model }
        return send(res, 200, resource(s, true))
      }
      if (method === 'DELETE') {
        s.turn?.abort.abort()
        for (const client of s.clients) client.end()
        sessions.delete(s.id)
        return send(res, 200, { id: s.id, object: 'agent.session.deleted', deleted: true })
      }
    }
    if (parts.length === 4 && d === 'events') {
      if (method === 'GET') return openStream(req, res, s)
      if (method === 'POST') {
        postEvents(s, await readJson(req))
        return send(res, 200, { object: 'list', data: [] })
      }
    }
    if (parts.length === 4 && d === 'items' && method === 'GET') return send(res, 200, list(s.items, url))
    if (parts.length === 4 && d === 'turns' && method === 'GET') return send(res, 200, list(s.turns, url))
  }
  throw new HttpError(404, 'not_found', `No route ${method} ${path}`)
}

const server = createServer((req, res) => {
  route(req, res).catch((error: unknown) => {
    if (res.headersSent) {
      res.destroy()
      return
    }
    if (error instanceof HttpError) {
      return send(res, error.status, { error: { type: error.status >= 500 ? 'server_error' : 'invalid_request_error', code: error.code, message: error.message } })
    }
    console.error(error)
    send(res, 500, { error: { type: 'server_error', code: 'internal_error', message: 'Mock server error' } })
  })
})

server.listen(PORT, () => {
  console.log(`Mock Agentry API on http://localhost:${PORT} (any "Bearer agk_..." key)`)
})
