/**
 * Mock Agentry API for local development and the Playwright e2e (Task 8).
 *
 * Run: `pnpm mock:api` (port 4010, or `MOCK_PORT`), then start the web app with
 * `AGENTRY_WEB_AUTH=apikey AGENTRY_API_URL=http://localhost:4010`.
 *
 * In-memory implementation of the routes the web app's allow-list forwards
 * (`/v1/agents`, `/v1/agents/tools`, `/v1/agents/{id}`, `/v1/agents/projects`
 * create/list/get/update/archive/unarchive/delete, sessions create/list/
 * get/update/delete, events post, items, turns, subagents with their items and turns) plus the SSE stream
 * `GET /v1/agents/sessions/{id}/events?stream=true`. Wire shapes follow the
 * backend's `src/history/projector.ts` (frame order, deterministic `evt_<session>_<n>`
 * ids). Any `Authorization: Bearer agk_…` is accepted as owner `mock`; anything
 * else answers 401 `unauthenticated`.
 *
 * SSE replay: `Last-Event-ID: n` writes every frame with id > n, then continues
 * live (a non-numeric id replays everything). Without the header the stream
 * starts with one id-less status snapshot. Approval/question frames are id-less
 * (ephemeral) and never replayed, as in backend Task 6 (provisional).
 *
 * Like the real backend (recorded in `tests/fixtures/live/web-search.json`),
 * the stream carries status, turn, and assistant-message frames only. User
 * messages, reasoning, function calls and their outputs are saved to
 * `GET .../items` only (function calls stay `in_progress`; the output item
 * finishes them), and a saved assistant message repeats its step's reasoning in
 * front of its text. Message ids match between the stream and the items, so
 * the client's items-then-replay load (R14) collapses them.
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
 *   - "web"                    → replays the recorded live turn (`tests/fixtures/live/web-search.json`):
 *                                 reasoning, `web_search` and `web_fetch` calls, and the streamed answer.
 *   - "tool"                   → a `search` function call that completes after 400 ms, then a reply.
 *   - "delegate" or "subagent" → a `subagent` call ("Research the question") that starts a child, and a
 *                                 reply. The child runs on after the turn: about 3 s, with a `glob` call,
 *                                 then a final message, all under `GET .../subagents/{id}/…` only.
 *   - anything else            → a reasoning summary and a short streamed Markdown reply.
 * A message sent while a turn runs is recorded as steering; the running script continues.
 *
 * Test hooks (no auth):
 *   - `POST /__mock/drop`  destroys every open SSE connection (the client must reconnect
 *                          with `Last-Event-ID`). Answers `{ dropped: n }`.
 *   - `POST /__mock/reset` forgets every session and Project and drops streams.
 *   - `GET /health`.
 */
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type {
  OAIAgent,
  OAIAgentSession,
  OAIApprovalAction,
  OAIEnvironmentConfig,
  OAIProject,
  OAISessionEvent,
  OAIFileContentPart,
  OAIMessageItem,
  OAISessionItem,
  OAISubagent,
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
  environment: OAIEnvironmentConfig
  projectId: string | null
  frames: Frame[]
  items: StoredSessionItem[]
  turns: OAITurn[]
  subagents: MockChild[]
  clients: Set<ServerResponse>
  seq: number
  turn?: { turn: OAITurn; abort: AbortController }
  pending?: { action: OAIApprovalAction; resolve: (d: Decision) => void }
}

interface MockChild {
  subagent: OAISubagent
  turns: OAITurn[]
  items: StoredSessionItem[]
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
const projects = new Map<string, OAIProject>()
let counter = 0
let projectCounter = 0

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
    environment: s.environment,
    project_id: s.projectId,
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

/**
 * Saves a reasoning or tool item and streams it as an item frame, as the API does since 2026-11-26
 * (`item.added` for a tool call still waiting for its output, `item.done` otherwise). Assistant
 * messages keep their own delta frames and are saved with `s.items.push`.
 */
function saveItem(s: MockSession, item: OAISessionItem, state: 'added' | 'done' = 'done'): void {
  s.items.push(item)
  emit(s, { type: `agent.session.turn.item.${state}`, session_id: s.id, turn_id: (item as { turn_id?: string | null }).turn_id ?? null, item } as WireBody)
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

/** User messages are saved only; the backend stream never carries them. */
function userMessage(s: MockSession, turnId: string, text: string, attached: OAIFileContentPart[] = []): void {
  s.seq += 1
  const content: OAIMessageItem['content'] = [...(text ? [{ type: 'input_text' as const, text }] : []), ...attached]
  s.items.push({ id: `item_msg_${s.seq}`, type: 'message', role: 'user', content, status: 'completed', turn_id: turnId })
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

/**
 * Streams an assistant message. Its `reasoning`, if any, is saved with it as
 * `item_reason_N` (items only), and the saved message repeats it in front of
 * the text, as the backend does.
 */
async function streamText(s: MockSession, turnId: string, chunks: string[], everyMs: number, signal: AbortSignal, reasoning?: string): Promise<void> {
  s.seq += 1
  const id = `item_msg_${s.seq}`
  const seq = s.seq
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
    if (reasoning) {
      saveItem(s, { id: `item_reason_${seq}`, type: 'reasoning', summary: [{ type: 'summary_text', text: reasoning }], status: 'completed', turn_id: turnId })
    }
    s.items.push({ ...item, content: [{ type: 'output_text', text: (reasoning ?? '') + text }] })
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
  saveItem(s, call, 'added') // left `in_progress` in the saved log, as the backend does
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
  saveItem(s, out)
}

// ---------- the recorded live turn ----------

interface Recording {
  session_id: string
  frames: Array<{ id?: string; data: OAISessionEvent }>
  items: OAISessionItem[]
  turns: OAITurn[]
}

let recording: Recording | undefined
function loadRecording(): Recording {
  recording ??= JSON.parse(readFileSync(new URL('../tests/fixtures/live/web-search.json', import.meta.url), 'utf8')) as Recording
  return recording
}

/**
 * Replays the recorded turn in this session: its items are saved in log order
 * (a call stays running for a moment before its output), and each assistant
 * message's recorded frames are emitted with a short pause per delta. Ids are
 * shifted past this session's sequence; session and turn ids are swapped in.
 */
async function replayRecording(s: MockSession, turnId: string, signal: AbortSignal): Promise<void> {
  const rec = loadRecording()
  const recTurn = rec.turns[0]?.id ?? ''
  const offset = s.seq
  let top = 0
  const rewrite = <T>(value: T): T =>
    JSON.parse(
      JSON.stringify(value)
        .replaceAll(rec.session_id, s.id)
        .replaceAll(`"${recTurn}"`, `"${turnId}"`)
        .replace(/\b(item_(?:msg|reason|fn_out|fn)_)(\d+)\b/g, (_, prefix: string, n: string) => {
          top = Math.max(top, Number(n))
          return `${prefix}${Number(n) + offset}`
        }),
    ) as T
  const framesOf = (itemId: string) =>
    rec.frames.filter(({ data }) => ('item_id' in data && data.item_id === itemId) || ('item' in data && data.item.id === itemId))
  let reasoning: OAISessionItem | undefined
  for (const recorded of rec.items.slice(1)) {
    // The user message is already saved by startTurn.
    const item = rewrite(recorded)
    if (item.type === 'reasoning') {
      reasoning = item
    } else if (item.type === 'message') {
      for (const frame of framesOf(recorded.id)) {
        const { event_id: _id, ...body } = rewrite(frame.data)
        if (body.type === 'agent.session.turn.output_text.delta') await wait(60, signal)
        if (body.type === 'agent.session.turn.item.done') {
          // Saved when the step commits, together with its reasoning.
          if (reasoning) saveItem(s, reasoning)
          reasoning = undefined
          s.items.push(item)
        }
        emit(s, body as WireBody)
      }
    } else {
      saveItem(s, item, item.type === 'function_call' ? 'added' : 'done')
      await wait(item.type === 'function_call' ? 900 : 300, signal)
    }
  }
  s.seq = offset + top
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
  if (t.includes('web')) return replayRecording(s, turnId, signal)
  if (t.includes('tool')) {
    await functionCall(s, turnId, 'search', { query: text.slice(0, 40) }, async () => {
      await wait(400, signal)
      return { output: '3 results: alpha, beta, gamma' }
    })
    return streamText(s, turnId, words('I searched and found **3 results**: alpha, beta and gamma.'), 40, signal)
  }
  if (t.includes('delegate') || t.includes('subagent')) {
    const childId = randomUUID()
    await functionCall(s, turnId, 'subagent', { description: 'Research the question', prompt: `Research this: ${text}` }, async () => {
      void runChild(s, childId, text)
      return { output: `started subagent ${childId}` }
    })
    return streamText(s, turnId, words('I asked a researcher; it will report back.'), 40, signal)
  }
  const reasoning = 'The user sent a message; reply briefly with a little Markdown.'
  const reply = `Hello from the **mock** Agentry API.\n\nYou said: _${text.replace(/[_*`]/g, '')}_\n\n- streamed\n- in chunks\n\n\`\`\`ts\nconst ok = true\n\`\`\`\n`
  return streamText(s, turnId, words(reply), 40, signal, reasoning)
}

/**
 * A subagent, as the backend shows one: a child with its own turns and items
 * (each item carries `subagent_id`), never on the parent stream. It outlives
 * the parent turn that started it.
 */
async function runChild(s: MockSession, childId: string, text: string): Promise<void> {
  const never = new AbortController().signal
  const child: MockChild = {
    subagent: { id: childId, object: 'agent.session.subagent', session_id: childId, parent_session_id: s.id, status: 'active', created_at: now() },
    turns: [],
    items: [],
  }
  s.subagents.push(child)
  const turn: OAITurn = { ...newTurn(s), id: `turn_${randomUUID().replaceAll('-', '')}`, session_id: childId, subagent_id: childId }
  child.turns.push(turn)
  const add = (item: OAISessionItem) => child.items.push({ ...item, subagent_id: childId })
  add({ id: 'item_msg_1', type: 'message', role: 'user', content: [{ type: 'input_text', text: `Research this: ${text}` }], status: 'completed', turn_id: turn.id })
  await wait(800, never)
  add({ id: 'item_reason_2', type: 'reasoning', summary: [{ type: 'summary_text', text: 'Look for relevant files first.' }], status: 'completed', turn_id: turn.id })
  add({ id: 'item_msg_2', type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Look for relevant files first.I will look around.' }], status: 'completed', turn_id: turn.id })
  add({ id: 'item_fn_3', type: 'function_call', name: 'glob', call_id: 'call_child_1', arguments: { pattern: '**/*.md' }, status: 'in_progress', turn_id: turn.id })
  await wait(1_000, never)
  add({ id: 'item_fn_out_4', type: 'function_call_output', call_id: 'call_child_1', output: 'README.md\nCHANGELOG.md', status: 'completed', turn_id: turn.id })
  await wait(1_000, never)
  add({ id: 'item_msg_5', type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Found **2** Markdown files: README.md and CHANGELOG.md.' }], status: 'completed', turn_id: turn.id })
  turn.status = 'completed'
  turn.completed_at = now()
  child.subagent = { ...child.subagent, status: 'closed', closed_at: now() }
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

function startTurn(s: MockSession, text: string, attached: OAIFileContentPart[] = []): void {
  const turn = newTurn(s)
  const abort = new AbortController()
  s.turns.push(turn)
  s.turn = { turn, abort }
  s.status = 'in_progress'
  s.error = null
  emit(s, { type: 'agent.session.in_progress', session: resource(s, false) })
  emit(s, { type: 'agent.session.turn.created', session_id: s.id, turn: { ...turn } })
  emit(s, { type: 'agent.session.turn.in_progress', session_id: s.id, turn: { ...turn } })
  userMessage(s, turn.id, text, attached)

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

const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const MOCK_PDF = Buffer.from('%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n')

/** Sample artifacts for the Artifacts page, newest first. */
const ARTIFACTS: Array<{ meta: Record<string, unknown>; body: Buffer }> = [
  ['art_png', 'chart.png', '/workspace/chart.png', 'image/png', PNG_1X1],
  ['art_docx', 'report.docx', '/workspace/report.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', Buffer.from('PK mock docx')],
  ['art_xlsx', 'budget.xlsx', '/workspace/budget.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', Buffer.from('PK mock xlsx')],
  ['art_pdf', 'summary.pdf', '/workspace/summary.pdf', 'application/pdf', MOCK_PDF],
  ['art_md', 'notes.md', '/workspace/notes.md', 'text/markdown', Buffer.from('# Notes\n\n- first\n- second\n')],
].map(([id, name, path, mime, body], i) => ({
  meta: {
    id,
    name,
    path,
    mime_type: mime,
    size: (body as Buffer).length,
    session_id: 'sesn_mock',
    session_title: 'Quarterly planning',
    created_at: new Date(Date.UTC(2026, 10, 10 - i, 9)).toISOString(),
    updated_at: new Date(Date.UTC(2026, 10, 10 - i, 9)).toISOString(),
    content_url: `/v1/agents/artifacts/${id}/content`,
  },
  body: body as Buffer,
}))

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

function list<T extends { id: string }>(rows: T[], url: URL): { object: 'list'; data: T[]; first_id: string | null; last_id: string | null; has_more: boolean } {
  const limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit') ?? 20) || 20))
  const after = url.searchParams.get('after')
  // Sessions filter before paging, as Agentry does: an empty `project_id` means Unfiled.
  const projectId = url.searchParams.get('project_id')
  const metadata = [...url.searchParams.entries()].filter(([key]) => key.startsWith('metadata[') && key.endsWith(']'))
  if (projectId !== null || metadata.length > 0) {
    rows = rows.filter((row) => {
      const r = row as T & { project_id?: string | null; metadata?: Record<string, string> }
      if (projectId !== null && (projectId ? r.project_id !== projectId : r.project_id)) return false
      return metadata.every(([key, value]) => r.metadata?.[key.slice(9, -1)] === value)
    })
  }
  if (url.searchParams.get('order') === 'desc') rows = rows.slice().reverse()
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

// ---------- staged files ----------

interface StagedFile {
  meta: { id: string; object: 'file'; bytes: number; created_at: number; filename: string; purpose: 'user_data'; media_type: string; status: 'staged' | 'attached' }
  body: Buffer
}
const files = new Map<string, StagedFile>()
const MOCK_MAX_FILE = 25 * 1024 * 1024

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks)
}

/** Stages the single `file` part of a multipart body (enough of RFC 7578 for the web app's uploads). */
function stageFile(contentType: string, raw: Buffer): StagedFile {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/.exec(contentType)
  if (!boundary) throw new HttpError(400, 'invalid_file', 'Not a multipart body')
  const delimiter = Buffer.from(`--${boundary[1] ?? boundary[2]}`)
  for (let at = raw.indexOf(delimiter); at !== -1; at = raw.indexOf(delimiter, at + delimiter.length)) {
    const headEnd = raw.indexOf('\r\n\r\n', at)
    if (headEnd === -1) break
    const name = /filename="([^"]*)"/.exec(raw.subarray(at, headEnd).toString('utf8'))
    if (!name) continue
    const end = raw.indexOf(delimiter, headEnd)
    const body = raw.subarray(headEnd + 4, end === -1 ? raw.length : end - 2)
    if (body.length === 0) throw new HttpError(400, 'invalid_file', 'The file is empty')
    if (body.length > MOCK_MAX_FILE) throw new HttpError(413, 'file_too_large', 'The file is over 25 MiB')
    const filename = name[1].split(/[\\/]/).pop() || 'file'
    const id = `file_mock${files.size + 1}_${randomUUID().slice(0, 6)}`
    const mediaType = contentTypeFor(filename)
    return { meta: { id, object: 'file', bytes: body.length, created_at: now(), filename, purpose: 'user_data', media_type: mediaType, status: 'staged' }, body: Buffer.from(body) }
  }
  throw new HttpError(400, 'invalid_file', 'No file part')
}

function contentTypeFor(filename: string): string {
  const ext = filename.slice(filename.lastIndexOf('.') + 1).toLowerCase()
  return ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', pdf: 'application/pdf', txt: 'text/plain', md: 'text/plain', csv: 'text/csv' } as Record<string, string>)[ext] ?? 'application/octet-stream'
}

/** `input_image` / `input_file` parts of a message input, resolved against the staged files (each used once). */
function attachedParts(input: unknown): OAIFileContentPart[] {
  if (!Array.isArray(input)) return []
  const out: OAIFileContentPart[] = []
  for (const message of input as Array<{ content?: Array<{ type?: string; file_id?: string }> }>) {
    for (const part of message.content ?? []) {
      if (part.type !== 'input_image' && part.type !== 'input_file') continue
      const file = part.file_id ? files.get(part.file_id) : undefined
      if (!file) throw new HttpError(404, 'file_not_found', `No file '${String(part.file_id)}'`)
      if (file.meta.status === 'attached') throw new HttpError(400, 'duplicate_file_id', 'A file may be used once')
      file.meta.status = 'attached'
      out.push({ type: part.type, file_id: file.meta.id, filename: file.meta.filename, bytes: file.meta.bytes, media_type: file.meta.media_type })
    }
  }
  if (out.length > 10) throw new HttpError(400, 'too_many_files', 'At most 10 files per message')
  return out
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
  const project = typeof body.project_id === 'string' ? projects.get(body.project_id) : undefined
  if (typeof body.project_id === 'string' && !project) throw new HttpError(404, 'resource_not_found', `No project found with id '${body.project_id}'`)
  if (project?.status === 'archived') throw new HttpError(409, 'project_archived', 'The project is archived')
  const agentBody = (body.agent ?? {}) as { model?: unknown }
  const agentId = typeof body.agent_id === 'string' ? body.agent_id : project?.agent_id
  const saved = typeof agentId === 'string' ? SAVED_AGENTS.find((a) => a.id === agentId) : undefined
  if (typeof agentId === 'string' && !saved) throw new HttpError(404, 'resource_not_found', `No agent found with id '${agentId}'`)
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
    environment: (body.environment as OAIEnvironmentConfig | undefined) ?? project?.environment ?? { type: 'local' },
    projectId: project?.id ?? null,
    frames: [],
    items: [],
    turns: [],
    subagents: [],
    clients: new Set(),
    seq: 0,
  }
  sessions.set(id, s)
  emit(s, { type: 'agent.session.created', session: resource(s, false) })
  const text = inputText(body.input)
  const attached = attachedParts(body.input)
  if (text || attached.length > 0) startTurn(s, text, attached)
  return s
}

function postEvents(s: MockSession, body: Record<string, unknown>): void {
  const events = Array.isArray(body.events) ? (body.events as Array<Record<string, unknown>>) : []
  if (events.length === 0) throw new HttpError(400, 'invalid_request_error', 'events must be a non-empty array')
  for (const event of events) {
    switch (event.type) {
      case 'agent.session.input.message': {
        const text = inputText(event.input)
        const attached = attachedParts(event.input)
        if (!text && attached.length === 0) throw new HttpError(400, 'invalid_request_error', 'message input is empty')
        if (s.turn) userMessage(s, s.turn.turn.id, text, attached)
        else startTurn(s, text, attached)
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

const MOCK_COMMANDS = [
  { name: 'compact', description: 'Compact the conversation history', accepts_attachments: false },
  { name: 'feedback', description: 'Send feedback about this chat', input_hint: 'what happened', accepts_attachments: false },
  { name: 'goal', description: 'Set or show the session goal', input_hint: 'objective, clear, pause or resume', accepts_attachments: false },
]

/** Runs a scripted slash command: `/compact` and `/goal` succeed, `/feedback` without text is a usage error. */
function runCommand(s: MockSession, name: string, input: string): Record<string, unknown> {
  if (!MOCK_COMMANDS.some((c) => c.name === name)) throw new HttpError(404, 'command_not_found', `Command "${name}" not found`)
  if (s.status === 'in_progress' || s.status === 'requires_action') {
    throw new HttpError(409, 'session_busy', 'The session is busy: wait for the current turn or command to finish')
  }
  const ok = !(name === 'feedback' && !input.trim())
  const text = name === 'compact' ? 'Compacted the conversation.' : name === 'goal' ? (input.trim() ? `Goal set: ${input.trim()}` : 'No goal is set.') : ok ? 'Thanks for the feedback.' : 'Usage: /feedback <text>'
  s.seq += 1
  const item = {
    id: `item_cmd_${s.seq}`,
    type: 'slash_command' as const,
    command_id: `cmd_${s.seq}`,
    name,
    ...(input.trim() ? { args: input.trim() } : {}),
    status: ok ? ('completed' as const) : ('failed' as const),
    text,
    turn_id: null,
  }
  s.items.push(item)
  emit(s, { type: 'agent.session.item.done', session_id: s.id, turn_id: null, item } as WireBody)
  return { command_id: item.command_id, name, status: ok ? 'success' : 'error', text, item }
}

/** Installed skills (library), for the Plugins page journey. Uploads are not unzipped: the name is the file name. */
interface MockSkill { id: string; object: 'agent.skill'; scope: 'library'; agent_id: null; name: string; description: string; source: 'upload' | 'editor'; origin: null; content_hash: string; has_scripts: boolean; status: 'pending_review' | 'active'; created_at: number; updated_at: number; used_by: string[] }
const installedSkills = new Map<string, MockSkill>()
const BUILTIN_SKILLS = [
  { name: 'review', description: 'Review the open diff', source: 'builtin', kind: 'builtin', enabled: true },
  { name: 'plan', description: 'Write a plan before changing code', source: 'builtin', kind: 'builtin', enabled: true },
  { name: 'summarize', description: 'Summarize a long document', source: 'bundled', kind: 'bundled', enabled: true },
]

function mockSkill(name: string, source: MockSkill['source'], status: MockSkill['status']): MockSkill {
  const id = `skill_${randomUUID().replaceAll('-', '')}`
  const now = Math.floor(Date.now() / 1000)
  return { id, object: 'agent.skill', scope: 'library', agent_id: null, name, description: `${name} skill`, source, origin: null, content_hash: 'mock', has_scripts: source === 'upload', status, created_at: now, updated_at: now, used_by: [] }
}

async function routeSkills(req: IncomingMessage, res: ServerResponse, method: string, parts: string[]): Promise<boolean> {
  const [, , c, d] = parts
  if (parts.length === 3 && c === 'installed' && method === 'GET') { send(res, 200, { object: 'list', data: [...installedSkills.values()] }); return true }
  if (parts.length === 2 && method === 'POST') {
    const type = req.headers['content-type'] ?? ''
    if (type.startsWith('multipart/form-data')) {
      const raw = await readBody(req)
      const filename = /filename="([^"]+)"/.exec(raw.toString('latin1'))?.[1] ?? 'skill.zip'
      const skill = mockSkill(filename.replace(/\.zip$/i, '').toLowerCase(), 'upload', 'pending_review')
      installedSkills.set(skill.id, skill)
      send(res, 201, skill)
      return true
    }
    const body = await readJson(req)
    const skill = mockSkill(String(body.name ?? 'skill'), 'editor', 'active')
    installedSkills.set(skill.id, skill)
    send(res, 201, skill)
    return true
  }
  const skill = c ? installedSkills.get(c) : undefined
  if (!skill) return false
  if (parts.length === 3 && method === 'GET') { send(res, 200, { skill, files: [{ path: 'SKILL.md', bytes: 64 }, { path: 'scripts/run.sh', bytes: 12 }], skill_md: `---\nname: ${skill.name}\n---\nDo ${skill.name}.` }); return true }
  if (parts.length === 4 && d === 'activate' && method === 'POST') { skill.status = 'active'; send(res, 200, skill); return true }
  if (parts.length === 3 && method === 'DELETE') { installedSkills.delete(skill.id); send(res, 200, { id: skill.id, object: 'agent.skill.deleted', deleted: true }); return true }
  return false
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
    projects.clear()
    files.clear()
    installedSkills.clear()
    return send(res, 200, { ok: true })
  }

  if (!path.startsWith('/v1/')) throw new HttpError(404, 'not_found', `No route ${method} ${path}`)
  if (!/^Bearer agk_\S+$/.test(req.headers.authorization ?? '')) {
    res.setHeader('www-authenticate', 'Bearer')
    throw new HttpError(401, 'unauthenticated', 'Missing or invalid credential')
  }

  const parts = path.split('/').slice(2) // after "/v1"
  const [a, b, c, d, e, f] = parts
  if (a !== 'agents') throw new HttpError(404, 'not_found', `No route ${method} ${path}`)

  if (parts.length === 1 && method === 'GET') return send(res, 200, list(SAVED_AGENTS, url))
  if (b === 'files') {
    if (parts.length === 2 && method === 'POST') {
      const staged = stageFile(req.headers['content-type'] ?? '', await readBody(req))
      files.set(staged.meta.id, staged)
      return send(res, 201, staged.meta)
    }
    const file = c ? files.get(c) : undefined
    if (!file) throw new HttpError(404, 'resource_not_found', `No file found with id '${String(c)}'`)
    if (parts.length === 3 && method === 'DELETE') {
      if (file.meta.status === 'attached') throw new HttpError(409, 'file_attached', 'The file is attached to a message')
      files.delete(file.meta.id)
      return send(res, 200, { id: file.meta.id, object: 'file.deleted', deleted: true })
    }
    if (parts.length === 4 && d === 'content' && method === 'GET') {
      const image = file.meta.media_type.startsWith('image/')
      res.writeHead(200, {
        'content-type': image ? file.meta.media_type : 'application/octet-stream',
        'content-disposition': `${image ? 'inline' : 'attachment'}; filename="${file.meta.filename}"`,
        'content-length': file.body.length,
      })
      return void res.end(file.body)
    }
  }
  if (b === 'environments' && c === 'providers' && parts.length === 3 && method === 'GET') {
    const places = [
      { id: 'local-docker', name: 'This server', kind: 'docker', default: true, available: true, capabilities: { reset: true, isolated: true, gpu: false } },
      { id: 'gpu-box', name: 'GPU box', kind: 'docker-ssh', default: false, available: true, gpus: { count: 2, models: ['NVIDIA A100', 'NVIDIA A100'] }, capabilities: { reset: false, isolated: true, gpu: true } },
      { id: 'lab-pc', name: 'Lab PC', kind: 'ssh-machine', default: false, available: true, capabilities: { reset: false, isolated: false, gpu: false } },
      { id: 'e2b', name: 'E2B', kind: 'e2b', default: false, available: true, capabilities: { reset: true, isolated: true, gpu: false } },
    ]
    const providers = [
      { object: 'sandbox.provider', name: 'local', default: false, available: true, capabilities: { templateFields: ['files'], files: true, exec: true } },
      { object: 'sandbox.provider', name: 'sandbox', default: true, available: true, version: '0.2.0', capabilities: { templateFields: ['image', 'packages', 'setup_commands', 'env', 'network', 'files', 'resources', 'gpus'], files: true, exec: true }, places },
    ]
    return send(res, 200, { object: 'list', data: providers, has_more: false })
  }
  if (b === 'artifacts' && method === 'GET') {
    if (parts.length === 2) {
      const rows = ARTIFACTS.map((x) => x.meta as { id: string })
      const page = list(rows, url)
      return send(res, 200, { object: 'list', data: page.data, has_more: page.has_more, ...(page.last_id ? { last_id: page.last_id } : {}) })
    }
    const found = parts.length === 4 && d === 'content' ? ARTIFACTS.find((x) => x.meta.id === c) : undefined
    if (!found) throw new HttpError(404, 'resource_not_found', `No artifact found at '${path}'`)
    const name = String(found.meta.name)
    res.writeHead(200, {
      'content-type': String(found.meta.mime_type),
      'content-disposition': `${url.searchParams.get('download') === '1' ? 'attachment' : 'inline'}; filename="${name}"`,
      'cache-control': 'no-store',
    })
    return void res.end(found.body)
  }
  if (parts.length === 2 && b === 'skills' && method === 'GET') {
    const library = [...installedSkills.values()].filter((x) => x.status === 'active')
      .map((x) => ({ name: x.name, description: x.description, source: x.source, kind: 'library', id: x.id, has_scripts: x.has_scripts, enabled: true }))
    return send(res, 200, { object: 'list', data: [...BUILTIN_SKILLS, ...library] })
  }
  if (b === 'skills' && (await routeSkills(req, res, method, parts))) return
  if (parts.length === 2 && b === 'commands' && method === 'GET') {
    const id = url.searchParams.get('session_id')
    if (id) getSession(id)
    return send(res, 200, { object: 'list', data: id ? MOCK_COMMANDS : [] })
  }
  if (parts.length === 2 && b === 'tools' && method === 'GET') return send(res, 200, { object: 'list', data: [], first_id: null, last_id: null, has_more: false })
  if (b === 'projects') {
    if (parts.length === 2) {
      if (method === 'GET') {
        const status = url.searchParams.get('status') ?? 'active'
        const rows = [...projects.values()].filter((p) => status === 'all' || p.status === status)
        return send(res, 200, list(rows, url))
      }
      if (method === 'POST') {
        const body = await readJson(req)
        const name = typeof body.name === 'string' ? body.name.trim() : ''
        if (!name) throw new HttpError(400, 'invalid_request_error', 'name is required')
        const at = now()
        const project: OAIProject = {
          id: `proj_mock${++projectCounter}`,
          object: 'project',
          name,
          status: 'active',
          pinned: body.pinned === true,
          agent_id: typeof body.agent_id === 'string' && body.agent_id ? body.agent_id : null,
          environment: (body.environment as OAIEnvironmentConfig | null) ?? null,
          archived_at: null,
          created_at: at,
          updated_at: at,
        }
        projects.set(project.id, project)
        return send(res, 201, project)
      }
    }
    const project = c ? projects.get(c) : undefined
    if (!project) throw new HttpError(404, 'resource_not_found', `No project found with id '${String(c)}'`)
    if (parts.length === 3) {
      if (method === 'GET') return send(res, 200, project)
      if (method === 'POST') {
        const body = await readJson(req)
        if (typeof body.name === 'string') {
          const name = body.name.trim()
          if (!name) throw new HttpError(400, 'invalid_request_error', 'name is required')
          project.name = name
        }
        if ('agent_id' in body) {
          if (body.agent_id !== null && typeof body.agent_id !== 'string') throw new HttpError(400, 'invalid_request_error', 'agent_id must be a string or null')
          project.agent_id = body.agent_id as string | null
        }
        if ('environment' in body) {
          if (body.environment !== null && typeof body.environment !== 'object') throw new HttpError(400, 'invalid_request_error', 'environment must be an object or null')
          project.environment = body.environment as OAIEnvironmentConfig | null
        }
        if (typeof body.pinned === 'boolean') project.pinned = body.pinned
        project.updated_at = now()
        return send(res, 200, project)
      }
      if (method === 'DELETE') {
        if ([...sessions.values()].some((s) => s.projectId === project.id)) {
          throw new HttpError(409, 'project_has_sessions', 'Move the project chats to Unfiled before deleting it')
        }
        projects.delete(project.id)
        return send(res, 200, { id: project.id, object: 'project.deleted', deleted: true })
      }
    }
    if (parts.length === 4 && method === 'POST' && (d === 'archive' || d === 'unarchive')) {
      project.status = d === 'archive' ? 'archived' : 'active'
      project.archived_at = d === 'archive' ? now() : null
      project.updated_at = now()
      return send(res, 200, project)
    }
  }
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
        // Like the API: `metadata_merge` sets keys and removes those given as null (starring uses it).
        if (body.metadata_merge && typeof body.metadata_merge === 'object') {
          const next = { ...s.metadata }
          for (const [key, value] of Object.entries(body.metadata_merge as Record<string, string | null>)) {
            if (value === null) delete next[key]
            else next[key] = value
          }
          s.metadata = next
        }
        if ('project_id' in body) {
          const next = body.project_id
          if (next !== null && typeof next !== 'string') throw new HttpError(400, 'invalid_request_error', 'project_id must be a string or null')
          const target = typeof next === 'string' ? projects.get(next) : undefined
          if (typeof next === 'string' && !target) throw new HttpError(404, 'resource_not_found', `No project found with id '${next}'`)
          if (target?.status === 'archived') throw new HttpError(409, 'project_archived', 'The project is archived')
          s.projectId = target?.id ?? null
        }
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
    if (parts.length === 5 && d === 'commands' && method === 'POST') {
      const body = await readJson(req)
      return send(res, 200, runCommand(s, e, typeof body.input === 'string' ? body.input : ''))
    }
    if (parts.length === 4 && d === 'items' && method === 'GET') return send(res, 200, list(s.items, url))
    if (parts.length === 4 && d === 'turns' && method === 'GET') return send(res, 200, list(s.turns, url))
    if (d === 'subagents' && method === 'GET') {
      if (parts.length === 4) return send(res, 200, list(s.subagents.map((x) => x.subagent), url))
      const child = s.subagents.find((x) => x.subagent.id === e)
      if (!child) throw new HttpError(404, 'resource_not_found', 'subagent not found')
      if (parts.length === 5) return send(res, 200, child.subagent)
      if (parts.length === 6 && f === 'items') return send(res, 200, list(child.items, url))
      if (parts.length === 6 && f === 'turns') return send(res, 200, list(child.turns, url))
    }
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
