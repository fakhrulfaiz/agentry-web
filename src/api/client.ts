/**
 * Browser API client. Every call goes to the web app's own BFF (`/api/agentry/*`,
 * `/api/models`, `/api/auth/logout`); no Agentry credential is ever in the
 * browser. Each request carries the session's CSRF token, read from
 * `<meta name="agentry-csrf">`, in `x-agentry-csrf`.
 */
import type {
  CreateSessionParams,
  OAIAgentSession,
  OAIInputEvent,
  OAIListResponse,
  OAISubagent,
  OAITurn,
  ReasoningEffort,
  StoredSessionItem,
} from './types'

export const CSRF_HEADER = 'x-agentry-csrf'
const AGENTRY = '/api/agentry'
const TITLE_MAX = 80
const ITEMS_PAGE = 100

/** A non-2xx answer from the BFF or Agentry. `status === 401` means signed out: send the user to `/login`. */
export class ApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

export function isSignedOut(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401
}

/** The CSRF token the guarded layout renders; empty when absent (the BFF then answers 403). */
export function csrfToken(): string {
  if (typeof document === 'undefined') return ''
  return document.querySelector('meta[name="agentry-csrf"]')?.getAttribute('content') ?? ''
}

function seg(id: string): string {
  return encodeURIComponent(id)
}

async function toError(res: Response): Promise<ApiError> {
  let code = `http_${res.status}`
  let message = res.statusText || `Request failed (${res.status})`
  try {
    const body = (await res.json()) as { error?: unknown }
    if (typeof body.error === 'string') {
      code = body.error
      message = body.error
    } else if (body.error && typeof body.error === 'object') {
      const err = body.error as { code?: unknown; type?: unknown; message?: unknown }
      if (typeof err.code === 'string') code = err.code
      else if (typeof err.type === 'string') code = err.type
      if (typeof err.message === 'string') message = err.message
    }
  } catch {
    // Not JSON: keep the status-based code.
  }
  return new ApiError(res.status, code, message)
}

/** Sends a request to the BFF and parses the JSON answer (`undefined` for an empty body). */
export async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json', [CSRF_HEADER]: csrfToken() }
  if (body !== undefined) headers['content-type'] = 'application/json'
  let res: Response
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
      cache: 'no-store',
    })
  } catch (error) {
    throw new ApiError(0, 'network_error', error instanceof Error ? error.message : 'Network error')
  }
  if (!res.ok) throw await toError(res)
  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}

function postEvents(id: string, events: OAIInputEvent[]): Promise<void> {
  return request<unknown>('POST', `${AGENTRY}/agents/sessions/${seg(id)}/events`, { events }).then(() => undefined)
}

export function titleFrom(text: string): string {
  const line = text.trim().split(/\s+/).join(' ')
  return line.length > TITLE_MAX ? `${line.slice(0, TITLE_MAX - 1)}…` : line
}

/** Every row of a cursor-paged list, oldest first (follows `has_more`). */
async function listAll<T extends { id: string }>(url: string): Promise<T[]> {
  const all: T[] = []
  let after: string | null = null
  for (;;) {
    const params = new URLSearchParams({ limit: String(ITEMS_PAGE) })
    if (after) params.set('after', after)
    const page: OAIListResponse<T> = await request('GET', `${url}?${params}`)
    all.push(...page.data)
    if (!page.has_more || !page.last_id || page.last_id === after) return all
    after = page.last_id
  }
}

export const api = {
  listSessions(q: { after?: string; limit?: number } = {}): Promise<OAIListResponse<OAIAgentSession>> {
    const params = new URLSearchParams()
    if (q.after) params.set('after', q.after)
    if (q.limit !== undefined) params.set('limit', String(q.limit))
    const query = params.size > 0 ? `?${params}` : ''
    return request('GET', `${AGENTRY}/agents/sessions${query}`)
  },

  getSession(id: string): Promise<OAIAgentSession> {
    return request('GET', `${AGENTRY}/agents/sessions/${seg(id)}`)
  },

  /** Starts a session with the first message (and `agent.reasoning.effort` when given); the title (session metadata) comes from that message. */
  createSession(input: { text: string; model: string; effort?: ReasoningEffort }): Promise<OAIAgentSession> {
    const body: CreateSessionParams = {
      agent: { model: input.model, ...(input.effort ? { reasoning: { effort: input.effort } } : {}) },
      input: input.text,
      metadata: { title: titleFrom(input.text) },
    }
    return request('POST', `${AGENTRY}/agents/sessions`, body)
  },

  sendMessage(id: string, text: string): Promise<void> {
    return postEvents(id, [
      { type: 'agent.session.input.message', input: [{ role: 'user', content: [{ type: 'input_text', text }] }] },
    ])
  },

  cancel(id: string): Promise<void> {
    return postEvents(id, [{ type: 'agent.session.input.cancel' }])
  },

  answerAction(
    id: string,
    actionId: string,
    answer: { decision: 'approve' | 'deny' | 'answer'; payload?: unknown },
  ): Promise<void> {
    return postEvents(id, [
      {
        type: 'agent.session.input.approval_response',
        id: actionId,
        decision: answer.decision,
        ...(answer.payload === undefined ? {} : { payload: answer.payload }),
      },
    ])
  },

  /** Agentry replaces the whole metadata map, so the other keys are read first and kept. */
  async renameSession(id: string, title: string): Promise<void> {
    const current = await api.getSession(id)
    await request('POST', `${AGENTRY}/agents/sessions/${seg(id)}`, { metadata: { ...current.metadata, title } })
  },

  async deleteSession(id: string): Promise<void> {
    await request('DELETE', `${AGENTRY}/agents/sessions/${seg(id)}`)
  },

  /** Every saved item, oldest first (follows `has_more`). */
  items(id: string): Promise<StoredSessionItem[]> {
    return listAll(`${AGENTRY}/agents/sessions/${seg(id)}/items`)
  },

  /** Every turn of the session, oldest first (follows `has_more`). */
  turns(id: string): Promise<OAITurn[]> {
    return listAll(`${AGENTRY}/agents/sessions/${seg(id)}/turns`)
  },

  /** The subagents this session's turns delegated to. */
  async subagents(id: string): Promise<OAISubagent[]> {
    const page = await request<OAIListResponse<OAISubagent>>('GET', `${AGENTRY}/agents/sessions/${seg(id)}/subagents`)
    return page.data
  },

  /** One subagent's turns (its status and timing). */
  async subagentTurns(id: string, subagentId: string): Promise<OAITurn[]> {
    const page = await request<OAIListResponse<OAITurn>>('GET', `${AGENTRY}/agents/sessions/${seg(id)}/subagents/${seg(subagentId)}/turns`)
    return page.data
  },

  /** Every item a subagent saved, oldest first (each carries `subagent_id`). */
  subagentItems(id: string, subagentId: string): Promise<StoredSessionItem[]> {
    return listAll(`${AGENTRY}/agents/sessions/${seg(id)}/subagents/${seg(subagentId)}/items`)
  },

  /** Offered models: the configured list first, then the models of the user's saved agents. */
  async models(): Promise<string[]> {
    const body = await request<{ models: string[] }>('GET', '/api/models')
    return body.models
  },

  /**
   * Signs out and returns where to go next (Keycloak's end-session URL or `/login`).
   * A 401/403 means the session is already gone, so that also lands on `/login`.
   */
  async logout(): Promise<string> {
    try {
      const body = await request<{ redirectTo?: string }>('POST', '/api/auth/logout')
      return body?.redirectTo ?? '/login'
    } catch (error) {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) return '/login'
      throw error
    }
  },
}
