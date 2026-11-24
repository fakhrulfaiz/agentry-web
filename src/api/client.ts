/**
 * Browser API client. Every call goes to the web app's own BFF (`/api/agentry/*`,
 * `/api/models`, `/api/auth/logout`); no Agentry credential is ever in the
 * browser. Each request carries the session's CSRF token, read from
 * `<meta name="agentry-csrf">`, in `x-agentry-csrf`.
 */
import { sessionEnvironment } from '@/ui/sandboxes/format'
import { isImageType, type UserFile } from '@/chat/attachments'
import type {
  AgentSchedule,
  InstalledSkill,
  SkillManifest,
  SkillView,
  OAIFileObject,
  AgentCommandList,
  AgentSkillList,
  CommandRunResponse,
  SessionArtifactList,
  SessionDeliverableList,
  CreateScheduleParams,
  CreateTemplateParams,
  EnvironmentFile,
  SandboxEnvironment,
  SandboxPage,
  SandboxProvider,
  SandboxRuntimes,
  SandboxTemplate,
  CreateSessionParams,
  OAIAgentSession,
  OAIInputEvent,
  CreateAgentParams,
  HostToolInfo,
  OAIAgent,
  OAIListResponse,
  OAISubagent,
  OAITurn,
  ReasoningEffort,
  ScheduleRunList,
  ScheduleStatus,
  StoredSessionItem,
  UpdateAgentParams,
  UpdateScheduleParams,
} from './types'

export const CSRF_HEADER = 'x-agentry-csrf'
const AGENTRY = '/api/agentry'
const TITLE_MAX = 80
const ITEMS_PAGE = 100

/** Model and reasoning effort changed for the next message; absent fields keep the session's. */
export interface SettingsChange {
  model?: string
  effort?: ReasoningEffort
}

/** Agentry's answer when a model or effort change cannot reach the running agent. */
export const SETTING_NOT_LIVE = 'session_setting_not_live'

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

/** `?session_id=<id>`, or nothing without an id. */
function sessionQuery(sessionId: string | undefined): string {
  return sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : ''
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
export async function request<T>(method: string, url: string, body?: unknown, signal?: AbortSignal): Promise<T> {
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
      ...(signal ? { signal } : {}),
    })
  } catch (error) {
    if (signal?.aborted) throw new ApiError(0, 'aborted', 'Request cancelled')
    throw new ApiError(0, 'network_error', error instanceof Error ? error.message : 'Network error')
  }
  if (!res.ok) throw await toError(res)
  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}

/** Message content: the text (when there is any), then one part per staged file. */
function contentParts(text: string, files: UserFile[] = []): Array<{ type: string; text?: string; file_id?: string }> {
  return [
    ...(text ? [{ type: 'input_text', text }] : []),
    ...files.flatMap((file) => (file.id ? [{ type: isImageType(file.mediaType) ? 'input_image' : 'input_file', file_id: file.id }] : [])),
  ]
}

/** Uploads one file (multipart) and reports progress in `0..1`; aborting `signal` cancels it. */
function uploadFile(file: File, onProgress: (fraction: number) => void, signal?: AbortSignal): Promise<OAIFileObject> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${AGENTRY}/agents/files`)
    xhr.setRequestHeader('accept', 'application/json')
    xhr.setRequestHeader(CSRF_HEADER, csrfToken())
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total)
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve(JSON.parse(xhr.responseText) as OAIFileObject)
      toError(new Response(xhr.responseText, { status: xhr.status })).then(reject, reject)
    }
    xhr.onerror = () => reject(new ApiError(0, 'network_error', 'Network error'))
    xhr.onabort = () => reject(new ApiError(0, 'aborted', 'Upload cancelled'))
    signal?.addEventListener('abort', () => xhr.abort(), { once: true })
    const form = new FormData()
    form.append('purpose', 'user_data')
    form.append('file', file, file.name)
    xhr.send(form)
  })
}

function postEvents(id: string, events: OAIInputEvent[]): Promise<void> {
  return request<unknown>('POST', `${AGENTRY}/agents/sessions/${seg(id)}/events`, { events }).then(() => undefined)
}

/** Session metadata key that marks a starred chat (value `"true"`). */
export const STARRED_KEY = 'starred'

/** `current` with `patch` applied: a string sets a key, `null` removes it. Never mutates `current`. */
export function mergeMetadata(
  current: Record<string, string> | null | undefined,
  patch: Record<string, string | null>,
): Record<string, string> {
  const next: Record<string, string> = { ...current }
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete next[key]
    else next[key] = value
  }
  return next
}

export function titleFrom(text: string): string {
  const line = text.trim().split(/\s+/).join(' ')
  return line.length > TITLE_MAX ? `${line.slice(0, TITLE_MAX - 1)}…` : line
}

/** Every row of a cursor-paged list, oldest first (follows `has_more`), or only the rows after `from`. */
async function listAll<T extends { id: string }>(url: string, from?: string): Promise<T[]> {
  const all: T[] = []
  let after: string | null = from ?? null
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
  createSession(input: { text: string; model: string; effort?: ReasoningEffort; files?: UserFile[]; agentId?: string; environmentId?: string }): Promise<OAIAgentSession> {
    const body: CreateSessionParams = {
      ...(input.agentId ? { agent_id: input.agentId } : {}),
      agent: { model: input.model, ...(input.effort ? { reasoning: { effort: input.effort } } : {}) },
      // An environment id, or `new:` / `new:<template id>` for a fresh sandbox that belongs to this chat.
      ...(sessionEnvironment(input.environmentId ?? '') ? { environment: sessionEnvironment(input.environmentId ?? '') } : {}),
      input: input.files?.length ? [{ role: 'user', content: contentParts(input.text, input.files) }] : input.text,
      metadata: { title: titleFrom(input.text || input.files?.[0]?.name || '') },
    }
    return request('POST', `${AGENTRY}/agents/sessions`, body)
  },

  /**
   * Sends a follow-up message. `change` carries only the settings the user
   * changed; Agentry applies them before queueing the message, and answers 409
   * `session_setting_not_live` (queueing nothing) when it cannot.
   */
  sendMessage(id: string, text: string, change: SettingsChange = {}, files?: UserFile[]): Promise<void> {
    return postEvents(id, [
      {
        type: 'agent.session.input.message',
        input: [{ role: 'user', content: contentParts(text, files) }],
        ...(change.model ? { model: change.model } : {}),
        ...(change.effort ? { reasoning: { effort: change.effort } } : {}),
      },
    ])
  },

  uploadFile,

  /** Your installed skills, optionally only the library or one agent's. */
  listInstalledSkills(scope?: 'library' | 'agent', agentId?: string): Promise<InstalledSkill[]> {
    const params = new URLSearchParams({ ...(scope ? { scope } : {}), ...(agentId ? { agent_id: agentId } : {}) })
    return request<{ data: InstalledSkill[] }>('GET', `${AGENTRY}/agents/skills/installed${params.size > 0 ? `?${params}` : ''}`).then((r) => r.data)
  },

  /** A skill's files and SKILL.md by name (your installed skills and Agentry built-ins). */
  viewSkill(name: string): Promise<SkillView> {
    return request('GET', `${AGENTRY}/agents/skills/view/${seg(name)}`)
  },

  /** One skill file as text. */
  readSkillFile(name: string, path: string): Promise<{ path: string; bytes: number; content: string }> {
    return request('GET', `${AGENTRY}/agents/skills/view/${seg(name)}/files/${path.split('/').map(encodeURIComponent).join('/')}`)
  },

  getSkill(id: string): Promise<SkillManifest> {
    return request('GET', `${AGENTRY}/agents/skills/${seg(id)}`)
  },

  /** Uploads a skill .zip for review. */
  async uploadSkill(file: File, scope: 'library' | 'agent', agentId?: string): Promise<InstalledSkill> {
    const form = new FormData()
    form.append('scope', scope)
    if (agentId) form.append('agent_id', agentId)
    form.append('file', file, file.name)
    const res = await fetch(`${AGENTRY}/agents/skills`, { method: 'POST', body: form, headers: { accept: 'application/json', [CSRF_HEADER]: csrfToken() }, credentials: 'same-origin' })
    if (!res.ok) throw await toError(res)
    return (await res.json()) as InstalledSkill
  },

  /** Writes a one-file skill; it is active at once. */
  createSkill(input: { name: string; description: string; body: string; scope: 'library' | 'agent'; agentId?: string }): Promise<InstalledSkill> {
    const { agentId, ...rest } = input
    return request('POST', `${AGENTRY}/agents/skills`, { ...rest, ...(agentId ? { agent_id: agentId } : {}) })
  },

  /** Imports a public GitHub folder for review. */
  importSkill(input: { repo: string; path: string; ref?: string; scope: 'library' | 'agent'; agentId?: string }): Promise<InstalledSkill> {
    const { agentId, ref, ...rest } = input
    return request('POST', `${AGENTRY}/agents/skills/import`, { ...rest, ...(ref ? { ref } : {}), ...(agentId ? { agent_id: agentId } : {}) })
  },

  activateSkill(id: string): Promise<InstalledSkill> {
    return request('POST', `${AGENTRY}/agents/skills/${seg(id)}/activate`, {})
  },

  /** Re-imports a GitHub skill; changed content returns it to review. */
  updateSkill(id: string): Promise<InstalledSkill> {
    return request('POST', `${AGENTRY}/agents/skills/${seg(id)}/update`, {})
  },

  editSkill(id: string, input: { description?: string; body?: string }): Promise<InstalledSkill> {
    return request('POST', `${AGENTRY}/agents/skills/${seg(id)}`, input)
  },

  deleteSkill(id: string): Promise<void> {
    return request<unknown>('DELETE', `${AGENTRY}/agents/skills/${seg(id)}`).then(() => undefined)
  },

  /** Removes a staged file (a removed attachment card). */
  deleteFile(id: string): Promise<void> {
    return request<unknown>('DELETE', `${AGENTRY}/agents/files/${seg(id)}`).then(() => undefined)
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

  /**
   * Changes some session metadata keys (a string sets one, `null` removes it)
   * and returns the map saved. Agentry replaces the whole map on update, so
   * the current one is read first and the other keys are kept.
   */
  async updateMetadata(id: string, patch: Record<string, string | null>): Promise<Record<string, string>> {
    const current = await api.getSession(id)
    const metadata = mergeMetadata(current.metadata, patch)
    await request('POST', `${AGENTRY}/agents/sessions/${seg(id)}`, { metadata })
    return metadata
  },

  /** Sets the chat's title; returns the whole metadata map saved. */
  renameSession(id: string, title: string): Promise<Record<string, string>> {
    return api.updateMetadata(id, { title })
  },

  /** Stars (`metadata.starred = "true"`) or unstars (key removed) a chat; returns the map saved. */
  setStarred(id: string, starred: boolean): Promise<Record<string, string>> {
    return api.updateMetadata(id, { [STARRED_KEY]: starred ? 'true' : null })
  },

  async deleteSession(id: string): Promise<void> {
    await request('DELETE', `${AGENTRY}/agents/sessions/${seg(id)}`)
  },

  /**
   * Every saved item, oldest first (follows `has_more`). With `after` (an item
   * id), only the items saved after it: the log is append-only.
   */
  items(id: string, after?: string): Promise<StoredSessionItem[]> {
    return listAll(`${AGENTRY}/agents/sessions/${seg(id)}/items`, after)
  },

  /** The `limit` newest turns of the session, oldest first (one request). */
  async recentTurns(id: string, limit: number): Promise<OAITurn[]> {
    const params = new URLSearchParams({ order: 'desc', limit: String(limit) })
    const page = await request<OAIListResponse<OAITurn>>('GET', `${AGENTRY}/agents/sessions/${seg(id)}/turns?${params}`)
    return page.data.slice().reverse()
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

  /** The skills Agentry can use (the composer's `/` menu); with `sessionId`, that chat's. */
  listSkills(sessionId?: string): Promise<AgentSkillList> {
    return request('GET', `${AGENTRY}/agents/skills${sessionQuery(sessionId)}`)
  },

  /** The Host slash commands of a chat (the composer's `/` menu); empty without `sessionId`. */
  listCommands(sessionId?: string): Promise<AgentCommandList> {
    return request('GET', `${AGENTRY}/agents/commands${sessionQuery(sessionId)}`)
  },

  /** Runs one Host slash command in a chat, outside any turn. 409 `session_busy` while a turn runs. */
  runCommand(sessionId: string, name: string, input?: string): Promise<CommandRunResponse> {
    return request('POST', `${AGENTRY}/agents/sessions/${seg(sessionId)}/commands/${seg(name)}`, input ? { input } : {})
  },

  /** Files the agent delivered with `present` in one chat (`GET /v1/agents/sessions/{id}/deliverables`). */
  listSessionDeliverables(id: string, signal?: AbortSignal): Promise<SessionDeliverableList> {
    return request('GET', `${AGENTRY}/agents/sessions/${seg(id)}/deliverables`, undefined, signal)
  },

  /** Sandbox providers and what each supports. */
  listSandboxProviders(): Promise<SandboxPage<SandboxProvider>> {
    return request('GET', `${AGENTRY}/agents/environments/providers`)
  },
  listSandboxRuntimes(): Promise<SandboxRuntimes> {
    return request('GET', `${AGENTRY}/agents/environments/runtimes`)
  },
  listSandboxTemplates(): Promise<SandboxPage<SandboxTemplate>> {
    return request('GET', `${AGENTRY}/agents/environments/templates?limit=100`)
  },
  createSandboxTemplate(params: CreateTemplateParams): Promise<SandboxTemplate> {
    return request('POST', `${AGENTRY}/agents/environments/templates`, params)
  },
  async deleteSandboxTemplate(id: string): Promise<void> {
    await request('DELETE', `${AGENTRY}/agents/environments/templates/${seg(id)}`)
  },
  listSandboxEnvironments(): Promise<SandboxPage<SandboxEnvironment>> {
    return request('GET', `${AGENTRY}/agents/environments?limit=100`)
  },
  getSandboxEnvironment(id: string): Promise<SandboxEnvironment> {
    return request('GET', `${AGENTRY}/agents/environments/${seg(id)}`)
  },
  /** Provisions an environment; `templateId` and `provider` are optional (the default provider is used without them). */
  createSandboxEnvironment(input: { templateId?: string; provider?: string; name?: string } = {}): Promise<SandboxEnvironment> {
    return request('POST', `${AGENTRY}/agents/environments`, {
      ...(input.templateId ? { template_id: input.templateId } : {}),
      ...(input.provider ? { provider: input.provider } : {}),
      ...(input.name ? { name: input.name } : {}),
    })
  },
  /** Starts, stops or rebuilds an Agentry Sandbox environment; answers the environment. */
  startSandboxEnvironment(id: string): Promise<SandboxEnvironment> {
    return request('POST', `${AGENTRY}/agents/environments/${seg(id)}/start`, {})
  },
  stopSandboxEnvironment(id: string): Promise<SandboxEnvironment> {
    return request('POST', `${AGENTRY}/agents/environments/${seg(id)}/stop`, {})
  },
  resetSandboxEnvironment(id: string, keepWorkspace: boolean): Promise<SandboxEnvironment> {
    return request('POST', `${AGENTRY}/agents/environments/${seg(id)}/reset`, { keep_workspace: keepWorkspace })
  },
  async deleteSandboxEnvironment(id: string): Promise<void> {
    await request('DELETE', `${AGENTRY}/agents/environments/${seg(id)}`)
  },
  /** One page of an environment's files, A to Z. */
  listEnvironmentFiles(id: string, page?: string): Promise<SandboxPage<EnvironmentFile>> {
    return request('GET', `${AGENTRY}/agents/environments/${seg(id)}/files?limit=100&order=asc${page ? `&page=${encodeURIComponent(page)}` : ''}`)
  },
  /** Writes one file (UTF-8 text or base64 bytes) at an absolute `/workspace/...` path. */
  uploadEnvironmentFile(id: string, path: string, base64: string): Promise<EnvironmentFile> {
    return request('POST', `${AGENTRY}/agents/environments/${seg(id)}/files`, { type: 'inline', path, data: base64 })
  },

  /** The user's saved agents. */
  listAgents(): Promise<OAIListResponse<OAIAgent>> {
    return request('GET', `${AGENTRY}/agents?limit=100`)
  },
  getAgent(id: string): Promise<OAIAgent> {
    return request('GET', `${AGENTRY}/agents/${seg(id)}`)
  },
  createAgent(params: CreateAgentParams): Promise<OAIAgent> {
    return request('POST', `${AGENTRY}/agents`, params)
  },
  updateAgent(id: string, params: UpdateAgentParams): Promise<OAIAgent> {
    return request('POST', `${AGENTRY}/agents/${seg(id)}`, params)
  },
  async deleteAgent(id: string): Promise<void> {
    await request('DELETE', `${AGENTRY}/agents/${seg(id)}`)
  },
  /** The Host's tool catalog, for an agent's allow list. Tolerates the common list shapes. */
  async listHostTools(): Promise<HostToolInfo[]> {
    const body = await request<unknown>('GET', `${AGENTRY}/agents/tools`)
    const rows = Array.isArray(body) ? body : ((body as { data?: unknown })?.data ?? (body as { tools?: unknown })?.tools)
    if (!Array.isArray(rows)) return []
    return rows.flatMap((row): HostToolInfo[] => {
      if (typeof row === 'string') return [{ name: row }]
      const r = row as { name?: unknown; description?: unknown; function?: { name?: unknown; description?: unknown } }
      const name = r.name ?? r.function?.name
      const description = r.description ?? r.function?.description
      return typeof name === 'string' ? [{ name, ...(typeof description === 'string' ? { description } : {}) }] : []
    })
  },

  /** Files the agent created in one chat, newest first (`GET /v1/agents/sessions/{id}/artifacts`). */
  listSessionArtifacts(id: string): Promise<SessionArtifactList> {
    return request('GET', `${AGENTRY}/agents/sessions/${seg(id)}/artifacts`)
  },

  /** The user's scheduled tasks, in the backend's order (active by next run, then paused/ended newest first). */
  listSchedules(q: { status?: ScheduleStatus; after?: string; limit?: number } = {}): Promise<OAIListResponse<AgentSchedule>> {
    const params = new URLSearchParams()
    if (q.status) params.set('status', q.status)
    if (q.after) params.set('after', q.after)
    if (q.limit !== undefined) params.set('limit', String(q.limit))
    const query = params.size > 0 ? `?${params}` : ''
    return request('GET', `${AGENTRY}/agents/schedules${query}`)
  },

  getSchedule(id: string): Promise<AgentSchedule> {
    return request('GET', `${AGENTRY}/agents/schedules/${seg(id)}`)
  },

  /** Creates a task; the backend provisions its dedicated chat when `session_id` is absent. */
  createSchedule(input: CreateScheduleParams): Promise<AgentSchedule> {
    return request('POST', `${AGENTRY}/agents/schedules`, input)
  },

  /** Updates a task; `revision` guards against a concurrent edit (409 `schedule_conflict`). */
  updateSchedule(id: string, patch: UpdateScheduleParams): Promise<AgentSchedule> {
    return request('POST', `${AGENTRY}/agents/schedules/${seg(id)}`, patch)
  },

  deleteSchedule(id: string): Promise<{ id: string; object: 'agent.schedule.deleted'; deleted: true }> {
    return request('DELETE', `${AGENTRY}/agents/schedules/${seg(id)}`)
  },

  pauseSchedule(id: string): Promise<AgentSchedule> {
    return request('POST', `${AGENTRY}/agents/schedules/${seg(id)}/pause`)
  },

  resumeSchedule(id: string): Promise<AgentSchedule> {
    return request('POST', `${AGENTRY}/agents/schedules/${seg(id)}/resume`)
  },

  runSchedule(id: string): Promise<AgentSchedule> {
    return request('POST', `${AGENTRY}/agents/schedules/${seg(id)}/run`)
  },

  /** One page of a task's delivery history, newest first, older pages via `before`. */
  listScheduleRuns(id: string, q: { limit?: number; before?: string } = {}): Promise<ScheduleRunList> {
    const params = new URLSearchParams()
    if (q.limit !== undefined) params.set('limit', String(q.limit))
    if (q.before) params.set('before', q.before)
    const query = params.size > 0 ? `?${params}` : ''
    return request('GET', `${AGENTRY}/agents/schedules/${seg(id)}/runs${query}`)
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
