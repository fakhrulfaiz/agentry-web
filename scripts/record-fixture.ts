/**
 * Records a real Agentry turn as a test fixture.
 *
 *   AGENTRY_API_URL=http://127.0.0.1:3080 AGENTRY_FIXTURE_KEY=... \
 *     node scripts/record-fixture.ts [name] [prompt]
 *
 * `AGENTRY_FIXTURE_MULTI_AGENT=1` enables subagent delegation on the session's agent.
 *
 * Creates a session with `stream: true`, keeps every SSE frame of the create
 * response verbatim (id, event, parsed data), then reads `GET .../items` and
 * `GET .../turns` (and, when the turn delegated, every subagent with its items
 * and turns). Writes `tests/fixtures/live/<name>.json` (default `web-search`).
 *
 * The local home directory (in workspace paths) is replaced by `/home/user`.
 * The key is read from `AGENTRY_FIXTURE_KEY` only. It is never printed or
 * written, and the script refuses to write a fixture that contains it.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_PROMPT = 'Search the web for the latest stable Node.js release and tell me its version number in one sentence.'

interface Frame {
  id?: string
  event?: string
  data: unknown
}

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}

const apiUrl = required('AGENTRY_API_URL').replace(/\/+$/, '')
const key = required('AGENTRY_FIXTURE_KEY')
const model = process.env.AGENTRY_FIXTURE_MODEL ?? 'deepseek-flash'
/** `AGENTRY_FIXTURE_MULTI_AGENT=1` lets the agent delegate to subagents. */
const multiAgent = process.env.AGENTRY_FIXTURE_MULTI_AGENT === '1'
const name = process.argv[2] ?? 'web-search'
const prompt = process.argv[3] ?? DEFAULT_PROMPT
if (!/^[a-z0-9-]+$/.test(name)) throw new Error('fixture name must match [a-z0-9-]+')

function headers(extra: Record<string, string> = {}): Headers {
  return new Headers({ ...extra, authorization: `Bearer ${key}`, 'openai-beta': 'agents=v1' })
}

async function getJson(path: string): Promise<unknown> {
  const res = await fetch(`${apiUrl}/v1${path}`, { headers: headers({ accept: 'application/json' }) })
  if (!res.ok) throw new Error(`GET ${path} answered ${res.status}`)
  return res.json()
}

/** Every page of a list endpoint, oldest first. */
async function list(path: string): Promise<unknown[]> {
  const all: unknown[] = []
  let after: string | null = null
  for (;;) {
    const query = new URLSearchParams({ limit: '100', order: 'asc' })
    if (after) query.set('after', after)
    const page = (await getJson(`${path}?${query}`)) as { data: unknown[]; has_more: boolean; last_id: string | null }
    all.push(...page.data)
    if (!page.has_more || !page.last_id || page.last_id === after) return all
    after = page.last_id
  }
}

/** Parses SSE blocks; an `id` is kept only when the block has its own `id:` line. */
async function readFrames(body: ReadableStream<Uint8Array>, stop: (frame: Frame) => boolean): Promise<Frame[]> {
  const frames: Frame[] = []
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let block: { id?: string; event?: string; data: string[] } = { data: [] }
  for (;;) {
    let chunk: ReadableStreamReadResult<Uint8Array>
    try {
      chunk = await reader.read()
    } catch {
      return frames // aborted: the read window is over
    }
    const { value, done } = chunk
    if (done) return frames
    buffer += decoder.decode(value, { stream: true })
    let match: RegExpExecArray | null
    while ((match = /\r\n|\n/.exec(buffer))) {
      const line = buffer.slice(0, match.index)
      buffer = buffer.slice(match.index + match[0].length)
      if (line === '') {
        if (block.data.length > 0) {
          const raw = block.data.join('\n')
          let data: unknown = raw
          try {
            data = JSON.parse(raw)
          } catch {
            // Keep non-JSON data as text.
          }
          const frame: Frame = { ...(block.id !== undefined && { id: block.id }), ...(block.event && { event: block.event }), data }
          frames.push(frame)
          if (stop(frame)) {
            await reader.cancel().catch(() => undefined)
            return frames
          }
        }
        block = { data: [] }
        continue
      }
      if (line.startsWith(':')) continue
      const colon = line.indexOf(':')
      const field = colon === -1 ? line : line.slice(0, colon)
      let v = colon === -1 ? '' : line.slice(colon + 1)
      if (v.startsWith(' ')) v = v.slice(1)
      if (field === 'data') block.data.push(v)
      else if (field === 'id') block.id = v
      else if (field === 'event') block.event = v
    }
  }
}

function eventType(frame: Frame): string | undefined {
  const data = frame.data as { type?: unknown } | null
  return typeof data?.type === 'string' ? data.type : undefined
}

async function main(): Promise<void> {
  const res = await fetch(`${apiUrl}/v1/agents/sessions`, {
    method: 'POST',
    headers: headers({ 'content-type': 'application/json', accept: 'text/event-stream' }),
    body: JSON.stringify({ agent: { model, ...(multiAgent && { multi_agent: { enabled: true } }) }, input: prompt, metadata: { title: `fixture: ${name}` }, stream: true }),
  })
  if (!res.ok || !res.body) throw new Error(`POST /agents/sessions answered ${res.status}`)

  // The top-level turn ends with a terminal turn event followed by a session status frame.
  let topTurnEnded = false
  const frames = await readFrames(res.body, (frame) => {
    const type = eventType(frame)
    const data = frame.data as { turn?: { subagent_id?: string | null } }
    if (type && /^agent\.session\.turn\.(completed|failed|cancelled)$/.test(type) && !data.turn?.subagent_id) topTurnEnded = true
    return topTurnEnded && (type === 'agent.session.idle' || type === 'agent.session.failed')
  })

  const created = frames.find((f) => eventType(f) === 'agent.session.created')
  const sessionId = (created?.data as { session?: { id?: string } } | undefined)?.session?.id
  if (!sessionId) throw new Error('no agent.session.created frame')

  const base = `/agents/sessions/${sessionId}`

  if (multiAgent) {
    // Subagents run on after the turn that started them, and their results may
    // start a follow-up turn: wait until every child turn and the session are done.
    const deadline = Date.now() + 240_000
    let settled = 0
    while (settled < 2 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 2_000))
      const session = (await getJson(base)) as { status: string }
      let running = session.status === 'in_progress' || session.status === 'requires_action'
      for (const child of (await list(`${base}/subagents`)) as Array<{ id: string }>) {
        const turns = (await list(`${base}/subagents/${child.id}/turns`)) as Array<{ status: string }>
        if (turns.some((t) => t.status === 'in_progress' || t.status === 'queued')) running = true
      }
      settled = running ? 0 : settled + 1
    }
    // The frames written since: replay after the last id for a short window.
    const lastId = frames.findLast((f) => f.id !== undefined)?.id ?? '0'
    const window = new AbortController()
    const timer = setTimeout(() => window.abort(), 3_000)
    const more = await fetch(`${apiUrl}/v1${base}/events?stream=true`, {
      headers: headers({ accept: 'text/event-stream', 'last-event-id': lastId }),
      signal: window.signal,
    }).catch(() => undefined)
    if (more?.ok && more.body) frames.push(...(await readFrames(more.body, () => false)))
    clearTimeout(timer)
  }
  const items = await list(`${base}/items`)
  const turns = await list(`${base}/turns`)
  const subagentList = await list(`${base}/subagents`).catch(() => [])
  const subagents = []
  for (const child of subagentList as Array<{ id: string }>) {
    subagents.push({
      subagent: child,
      items: await list(`${base}/subagents/${child.id}/items`),
      turns: await list(`${base}/subagents/${child.id}/turns`),
    })
  }

  const fixture = {
    recorded_at: new Date().toISOString(),
    source: 'live Agentry backend via scripts/record-fixture.ts',
    prompt,
    model,
    session_id: sessionId,
    frames,
    items,
    turns,
    subagents,
  }
  // The workspace path names the local user's home directory: keep it out of the repo.
  const out = `${JSON.stringify(fixture, null, 2)}\n`.split(homedir()).join('/home/user')
  if (out.includes(key)) throw new Error('refusing to write: the fixture contains the API key')

  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const file = join(root, 'tests', 'fixtures', 'live', `${name}.json`)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, out)
  const types = new Map<string, number>()
  for (const f of frames) types.set(eventType(f) ?? '?', (types.get(eventType(f) ?? '?') ?? 0) + 1)
  console.log(`wrote ${file}: ${frames.length} frames, ${items.length} items, ${turns.length} turns, ${subagents.length} subagents`)
  for (const [type, n] of types) console.log(`  ${type} × ${n}`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'recording failed')
  process.exit(1)
})
