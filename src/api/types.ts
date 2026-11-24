/**
 * Agentry wire types used by F1 (OpenAI Agents API shape, `OpenAI-Beta: agents=v1`).
 *
 * Copied from the backend `~/code/dsh-agents-api/src/types.ts` at commit 4307e21
 * (`src/history/projector.ts` for `StoredSessionItem`), trimmed to what the web
 * app reads or sends. Replace with types generated from `openapi/agentry.yaml`
 * once the backend publishes it.
 *
 * PROVISIONAL: the `approval` required action and the
 * `agent.session.input.approval_response` input event follow the backend
 * Task 6 mini-plan (`docs/superpowers/plans/2026-11-08-task-6-miniplan.md`) and
 * are not merged upstream yet. Status frames that carry them are ephemeral
 * (no SSE `id`).
 */

/** Session lifecycle reported on `agent.session` resources. */
export type SessionStatus = 'idle' | 'in_progress' | 'requires_action' | 'failed'
/** Turn lifecycle reported on `agent.session.turn` resources. */
export type TurnStatus = 'queued' | 'in_progress' | 'waiting' | 'completed' | 'failed' | 'cancelled'
/** Item completion reported on saved session items. */
export type ItemStatus = 'in_progress' | 'completed' | 'incomplete'
/** Tool-call completion reported on function, MCP, and command items. */
export type ToolCallStatus = 'in_progress' | 'completed' | 'failed' | 'incomplete'
export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
export type ServiceTier = 'auto' | 'default' | 'flex' | 'priority' | 'fast'

/** Best-effort token accounting on session and turn resources. */
export interface OAITokenUsage {
  input_tokens: number
  input_tokens_details: { cached_tokens: number }
  output_tokens: number
  output_tokens_details: { reasoning_tokens: number }
  total_tokens: number
}

/** Cursor page returned by list endpoints. */
/** A skill Agentry can use, as `GET /v1/agents/skills` lists it. */
export interface AgentSkill {
  name: string
  description?: string
  source?: string
  /** `builtin` (Agentry's), `library` (yours), `private` (this agent's), `bundled` (always on). */
  kind?: 'builtin' | 'library' | 'private' | 'bundled'
  /** Installed skill id (library and private). */
  id?: string
  has_scripts?: boolean
  enabled?: boolean
}

/** A library or agent-private skill, as `GET /v1/agents/skills/installed` lists it. */
export interface InstalledSkill {
  id: string
  object: 'agent.skill'
  scope: 'library' | 'agent'
  agent_id: string | null
  name: string
  description: string
  source: 'upload' | 'github' | 'editor' | 'chat'
  origin: { repo: string; path: string; ref: string; commit: string } | null
  content_hash: string
  has_scripts: boolean
  status: 'pending_review' | 'active'
  created_at: number
  updated_at: number
  /** Ids of your agents that use it. */
  used_by: string[]
}

/** `GET /v1/agents/skills/{id}`: what a review shows. */
export interface SkillManifest {
  skill: InstalledSkill
  files: { path: string; bytes: number }[]
  skill_md: string
}

/** `GET /v1/agents/skills/view/{name}`: a skill's files for the viewer. */
export interface SkillView {
  name: string
  description: string
  kind: 'builtin' | 'library' | 'private'
  id?: string
  files: { path: string; bytes: number }[]
  skill_md: string
}

/** Which skills a saved agent uses; absent or null uses every built-in. */
export interface AgentSkillSelection {
  builtin: string[]
  library: string[]
}

/** Composio app grants: app slug to `all` or exact tool slugs. */
export type AgentAppGrants = Record<string, 'all' | string[]>

/** A connected-app sign-in link found in a tool output. */
export interface ConnectRequest {
  toolkit: string | null
  url: string
  status: 'initiated' | 'active' | 'unknown'
}

/** A Host slash command, as `GET /v1/agents/commands` lists it. */
export interface AgentCommand {
  name: string
  description: string
  /** Placeholder for the text after the name; absent when the command takes none. */
  input_hint?: string
  accepts_attachments: boolean
}

/** `GET /v1/agents/commands`: the commands of one session's agent (empty without `session_id`). */
export interface AgentCommandList {
  object: 'list'
  data: AgentCommand[]
}

/** `GET /v1/agents/skills`: the skills Agentry can use (no paging fields). */
export interface AgentSkillList {
  object: 'list'
  data: AgentSkill[]
}

export interface OAIListResponse<T> {
  object: 'list'
  data: T[]
  first_id: string | null
  last_id: string | null
  has_more: boolean
}

/** One tool entry on an agent configuration. F1 only displays it, so it stays loose. */
export interface OAIToolConfig {
  type: string
  name?: string
  [key: string]: unknown
}

/** Saved or session-local agent configuration. */
export interface OAIAgent {
  id: string
  object: 'agent'
  created_at: number
  updated_at: number
  name: string | null
  instructions: string | null
  model: string
  metadata: Record<string, string>
  tools: OAIToolConfig[]
  /** Host tool mask: `allow` keeps only these names, `deny` hides these. */
  host_tools?: { allow?: string[] | null; deny?: string[] | null } | null
  multi_agent?: { enabled: boolean; max_concurrent_subagents?: number | null } | null
  reasoning?: { effort?: ReasoningEffort | null; summary?: 'auto' | 'none' | null } | null
  service_tier?: ServiceTier | null
  skills?: AgentSkillSelection | null
  apps?: AgentAppGrants | null
  send_policy?: 'ask' | 'auto' | null
}

/** Body for `POST /v1/agents` (and, with every field optional, `POST /v1/agents/{id}`). */
export interface CreateAgentParams {
  model: string
  name?: string | null
  instructions?: string | null
  metadata?: Record<string, string> | null
  host_tools?: { allow?: string[] | null; deny?: string[] | null } | null
  multi_agent?: { enabled: boolean; max_concurrent_subagents?: number | null } | null
  reasoning?: { effort?: ReasoningEffort | null } | null
  skills?: AgentSkillSelection | null
  apps?: AgentAppGrants | null
  send_policy?: 'ask' | 'auto' | null
}
export type UpdateAgentParams = Partial<CreateAgentParams>

/** One Host tool from `GET /v1/agents/tools`. */
export interface HostToolInfo {
  name: string
  description?: string
}

/** Environment on a session. F1 never edits it. */
export interface OAIEnvironmentConfig {
  type: string
  [key: string]: unknown
}

/** One selectable answer offered to the user (DSH `AskUserQuestionOption`). */
export interface AskUserQuestionOption {
  label: string
  description?: string
}

/** One question in a user-questions request (DSH `AskUserQuestionItem`, presentation intent omitted). */
export interface AskUserQuestionItem {
  id: string
  question: string
  detail?: string
  header?: string
  options?: AskUserQuestionOption[]
  multiSelect?: boolean
  intent?: { kind: string; [key: string]: unknown }
}

/** Approval or question the user must answer (PROVISIONAL, backend Task 6). */
export interface OAIApprovalAction {
  type: 'approval'
  id: string
  kind: 'tool_approval' | 'sandbox_escalation' | 'user_question'
  prompt: string
  options: string[]
  tool_name?: string
  call_id?: string
  questions?: AskUserQuestionItem[]
}

/** Action the application must complete before work can continue. */
export type OAIRequiredAction =
  | {
    type: 'function_call'
    name: string
    arguments: Record<string, unknown>
    turn_id: string
    call_id: string
  }
  | {
    type: 'environment_connection'
    environment_id: string
  }
  | OAIApprovalAction

/** Durable session resource. */
export interface OAIAgentSession {
  id: string
  object: 'agent.session'
  created_at: number
  last_active_at: number
  status: SessionStatus
  error: string | null
  metadata: Record<string, string>
  vault_ids: string[]
  agent: OAIAgent
  environment: OAIEnvironmentConfig
  required_actions: OAIRequiredAction[]
  usage: OAITokenUsage | null
}

/** One cycle of work inside a session. */
export interface OAITurn {
  id: string
  object: 'agent.session.turn'
  session_id: string
  agent_id: string
  status: TurnStatus
  created_at: number
  started_at?: number | null
  completed_at?: number | null
  subagent_id?: string | null
  error?: { code: string; message: string } | null
  usage?: OAITokenUsage | null
}

/**
 * A subagent: a Host child session a turn delegated to (`GET .../subagents`).
 * Its turns and items are on their own routes and never on the parent stream.
 */
export interface OAISubagent {
  id: string
  object: 'agent.session.subagent'
  session_id: string
  parent_session_id: string
  status: 'active' | 'closed'
  created_at: number
  closed_at?: number
}

/** Text part on a message item. */
export interface OAITextContentPart {
  type: 'input_text' | 'output_text'
  text: string
}

/** A file the user attached: `input_image` or `input_file` after the text part. */
export interface OAIFileContentPart {
  type: 'input_image' | 'input_file'
  /** Absent when the file was not uploaded through the API (name and size only). */
  file_id?: string
  filename: string
  bytes?: number
  media_type?: string
  width?: number
  height?: number
}

/** A file staged by `POST /agents/files`. */
export interface OAIFileObject {
  id: string
  object: 'file'
  bytes: number
  filename: string
  media_type: string
  status: 'staged' | 'attached'
}

/** Saved user or assistant message. */
/**
 * When Agentry's Session log recorded an item, epoch milliseconds (an Agentry
 * extension; each field only when recorded: a running call has no end yet).
 */
export interface OAIItemTiming {
  /** An assistant step's start, or when a tool was called. */
  started_at_ms?: number
  /** An assistant step's first streamed token. */
  first_token_at_ms?: number
  /** When it finished: the reply settled, the tool answered, the message was logged. */
  completed_at_ms?: number
}

export interface OAIMessageItem {
  id: string
  type: 'message'
  role: 'user' | 'assistant'
  content: Array<OAITextContentPart | OAIFileContentPart>
  phase?: 'commentary' | 'final_answer' | null
  status: ItemStatus
  turn_id: string
  step?: number
  usage?: OAITokenUsage
  timing?: OAIItemTiming
}

/** Saved function call. */
export interface OAIFunctionCallItem {
  id: string
  type: 'function_call'
  name: string
  call_id: string
  arguments: Record<string, unknown> | string
  status: ToolCallStatus
  turn_id: string
  step?: number
  timing?: OAIItemTiming
}

/** Saved function-call result. */
export interface OAIFunctionCallOutputItem {
  id: string
  type: 'function_call_output'
  call_id: string
  output: string
  error?: string | null
  status: ToolCallStatus
  turn_id: string
  timing?: OAIItemTiming
  /** A sign-in link for a connected app; shown as a Connect button. */
  connect_request?: ConnectRequest
}

/** Saved MCP tool call. */
export interface OAIMcpCallItem {
  id: string
  type: 'mcp_call'
  server_label: string
  name: string
  arguments: Record<string, unknown>
  output?: unknown
  error?: string | null
  status: ToolCallStatus
  turn_id: string
}

/** Saved shell or terminal command. */
export interface OAICommandExecutionItem {
  id: string
  type: 'command_execution'
  command: string
  cwd?: string
  exit_code?: number
  output?: string
  duration_ms?: number
  status: ToolCallStatus
  turn_id: string
  step?: number
  timing?: OAIItemTiming
}

/** Saved reasoning summary. */
export interface OAIReasoningItem {
  id: string
  type: 'reasoning'
  summary?: Array<{ type: 'summary_text'; text: string }>
  status: ItemStatus
  turn_id: string
  step?: number
  timing?: OAIItemTiming
}

/** One saved session item. */
export type OAISessionItem =
  | OAIMessageItem
  | OAIFunctionCallItem
  | OAIFunctionCallOutputItem
  | OAIMcpCallItem
  | OAICommandExecutionItem
  | OAIReasoningItem
  | OAISlashCommandItem

/** Result of a Host slash command; human-only (never reaches the model). `turn_id` is null between turns. */
export interface OAISlashCommandItem {
  id: string
  type: 'slash_command'
  command_id: string
  name: string
  args?: string
  status: 'completed' | 'failed'
  text?: string
  turn_id: string | null
}

/** `POST .../commands/{name}`: the outcome and the item it produced. */
export interface CommandRunResponse {
  command_id: string
  name: string
  status: 'success' | 'error'
  text?: string
  item: OAISlashCommandItem
}

/** One saved item, with the child id when it belongs to a subagent (`GET .../items`). */
export type StoredSessionItem = OAISessionItem & { subagent_id?: string }

/** User, assistant, or system input message. */
export interface OAIInputMessage {
  role: 'user' | 'assistant' | 'system'
  content?: Array<{ type: string; text?: string; file_id?: string }>
}

/** Answer to an approval or question (PROVISIONAL, backend Task 6). */
export interface OAIApprovalResponseInputEvent {
  type: 'agent.session.input.approval_response'
  id: string
  decision: 'approve' | 'deny' | 'answer'
  /** For a one-question `answer`: `{ selected: string[]; custom?: string }`; otherwise `{ answers: [...] }`. */
  payload?: unknown
}

/** Input event accepted by `POST /v1/agents/sessions/{session_id}/events`. */
export type OAIInputEvent =
  | {
      type: 'agent.session.input.message'
      input: OAIInputMessage[]
      /** Switches the session's model before the message is queued. */
      model?: string
      /** Switches the session's reasoning effort before the message is queued. */
      reasoning?: { effort: ReasoningEffort }
    }
  | { type: 'agent.session.input.cancel' }
  | OAIApprovalResponseInputEvent

/** Body for `POST /v1/agents/sessions`. */
export interface CreateSessionParams {
  agent?: { model?: string; [key: string]: unknown }
  agent_id?: string
  metadata?: Record<string, string> | null
  input?: string | OAIInputMessage[]
  stream?: boolean
}

/**
 * A task's timing, DSH's tagged union (`ScheduleTiming` in the backend OpenAPI).
 * Reads echo `at` as a UTC instant and `time` as `HH:mm:ss.SSS`; the client sends
 * an RFC 3339 instant for `at` and an explicit IANA zone for the other kinds.
 */
export type ScheduleTiming =
  | { kind: 'after'; after_seconds: number }
  | { kind: 'at'; at: string }
  | { kind: 'every'; every_seconds: number }
  | { kind: 'daily'; daily: { time: string; time_zone: string } }
  | { kind: 'weekly'; weekly: { time: string; time_zone: string; weekdays: number[] } }
  | { kind: 'cron'; cron: { expression: string; time_zone: string } }
  | { kind: 'rrule'; rrule: string }

export type ScheduleStatus = 'active' | 'paused' | 'ended'

/** One delivery of a scheduled task (receipt, not a completion). */
export interface AgentScheduleRun {
  scheduled_at: string
  delivered_at: string
  message_id: string
  session_id: string
}

/** A scheduled agent task (`/v1/agents/schedules`). */
export interface AgentSchedule {
  id: string
  object: 'agent.schedule'
  title: string
  prompt: string
  timing: ScheduleTiming
  status: ScheduleStatus
  next_run_at: string | null
  created_at: string
  updated_at: string
  revision: string
  session_id: string
  running: boolean
  last_run: AgentScheduleRun | null
}

/** Delivery history page (`GET …/schedules/{id}/runs`). */
export interface ScheduleRunList {
  object: 'list'
  data: AgentScheduleRun[]
  has_more: boolean
  next_before: string | null
}

/** Body for `POST /v1/agents/schedules`. */
export interface CreateScheduleParams {
  title: string
  prompt: string
  timing: ScheduleTiming
  session_id?: string
  agent_id?: string
  agent?: { model?: string; reasoning?: { effort?: ReasoningEffort }; instructions?: string }
  /** `EnvironmentConfig`; ignored by the server when `session_id` is set. No UI sets it. */
  environment?: OAIEnvironmentConfig
}

/** Body for `POST /v1/agents/schedules/{id}`; optional `revision` (the record's `updated_at`) guards against concurrent edits (409). */
export interface UpdateScheduleParams {
  title?: string
  prompt?: string
  timing?: ScheduleTiming
  revision?: string
}

/** Output event written on the session SSE stream. */
export type OAISessionEvent =
  | { type: 'agent.session.created'; event_id: string; session: OAIAgentSession }
  | { type: 'agent.session.idle'; event_id: string; session: OAIAgentSession }
  | { type: 'agent.session.in_progress'; event_id: string; session: OAIAgentSession }
  | { type: 'agent.session.requires_action'; event_id: string; session: OAIAgentSession }
  | { type: 'agent.session.failed'; event_id: string; session: OAIAgentSession }
  | { type: 'agent.session.turn.created'; event_id: string; session_id: string; turn: OAITurn }
  | { type: 'agent.session.turn.in_progress'; event_id: string; session_id: string; turn: OAITurn }
  | { type: 'agent.session.turn.completed'; event_id: string; session_id: string; turn_id: string; turn: OAITurn; usage?: OAITokenUsage | null }
  | { type: 'agent.session.turn.failed'; event_id: string; session_id: string; turn_id: string; turn: OAITurn; usage?: OAITokenUsage | null }
  | { type: 'agent.session.turn.cancelled'; event_id: string; session_id: string; turn_id: string; turn: OAITurn; usage?: OAITokenUsage | null }
  | { type: 'agent.session.turn.item.added'; event_id: string; session_id: string; turn_id: string; item: OAISessionItem }
  | { type: 'agent.session.turn.item.done'; event_id: string; session_id: string; turn_id: string; item: OAISessionItem }
  | { type: 'agent.session.item.done'; event_id: string; session_id: string; turn_id: string | null; item: OAISlashCommandItem }
  | { type: 'agent.session.turn.output_text.delta'; event_id: string; item_id: string; output_index: number; content_index: number; session_id: string; turn_id: string; delta: string }
  | { type: 'agent.session.turn.output_text.done'; event_id: string; item_id: string; output_index: number; content_index: number; session_id: string; turn_id: string; text: string }
  | { type: 'error'; event_id: string; session_id?: string; error: { message: string; type?: string; code?: string } }

/** Session-status events: each carries the full session resource. */
export type OAISessionStatusEvent = Extract<OAISessionEvent, { session: OAIAgentSession }>

/** Error body Agentry answers with (`{ error: { type, message, code } }`). */
export interface OAIErrorBody {
  error: { type?: string; message?: string; code?: string }
}

/** One file under a session's workspace (or S3 artifact store), as the backend lists it (`GET /v1/agents/sessions/{id}/artifacts`). */
export interface SessionArtifactEntry {
  path: string
  size?: number
  last_modified?: string
  /** The agent's note from `present`, shown as the card subtitle. */
  description?: string
}

/** One file the agent delivered with `present` (`GET /v1/agents/sessions/{id}/deliverables`). */
export interface SessionDeliverableEntry {
  /** Workspace-relative when inside the workspace, otherwise absolute. */
  path: string
  description?: string
  turn_id: string
  /** Epoch seconds. */
  created_at: number
}

export interface SessionDeliverableList {
  object: 'list'
  data: SessionDeliverableEntry[]
}

export interface SessionArtifactList {
  object: 'list'
  data: SessionArtifactEntry[]
}

/**
 * An artifact the Artifacts page shows — a `SessionArtifactEntry` enriched by
 * `src/artifacts/artifact.ts` with its session's context. `content_url` holds
 * the `/v1`-prefixed API path of the bytes,
 * `/v1/agents/sessions/{id}/artifacts/{path}`; the BFF streams them and
 * `?download=1` forces an attachment.
 */
export interface Artifact {
  id: string
  name: string
  path: string
  size: number
  mime_type: string
  session_id: string
  session_title?: string
  updated_at: string
  content_url: string
  /** The agent's note from `present`, when it gave one. */
  description?: string
}

/** A sandbox provider and what it supports (`GET /agents/environments/providers`). */
export interface SandboxProvider {
  object: 'sandbox.provider'
  name: string
  default: boolean
  capabilities: { templateFields: string[]; files: boolean; exec: boolean }
}

/** An environment template (`agent.environment.template`). */
export interface SandboxTemplate {
  id: string
  object: 'agent.environment.template'
  name: string | null
  created_at: number
  updated_at: number
  files: Array<{ type: 'inline' | 'file_id'; path: string; size_bytes?: number }>
  network: { access: 'enabled' | 'disabled' | 'restricted'; allowed_domains: string[] }
  packages: { npm: string[]; python: string[]; system: string[] }
  provider: string
  image?: string
  /** Fields the provider cannot apply; provisioning fails while any remain. */
  unsupported_fields: string[]
}

/** An environment (`agent.environment`). */
export interface SandboxEnvironment {
  id: string
  object: 'agent.environment'
  type: 'openai_hosted' | 'self_hosted'
  status: 'pending' | 'connected' | 'disconnected' | 'expired' | 'failed'
  provider: string
  template_id?: string
  session_id?: string
  error?: string
  created_at: number
}

/** A file in an environment (`agent.environment.file`). */
export interface EnvironmentFile {
  object: 'agent.environment.file'
  environment_id: string
  /** Absolute path, `/workspace/...`. */
  path: string
  size_bytes: number
}

/** A token page as the Agents API returns it for environment files. */
export interface SandboxPage<T> {
  object: 'list'
  data: T[]
  has_more: boolean
  next?: string
}

export interface CreateTemplateParams {
  name: string
  provider?: string
  /** Starter files copied into every environment made from the template. */
  files?: Array<{ type: 'inline'; path: string; data: string }>
}

/** The script runtimes the host bundles for every agent (`GET /agents/environments/runtimes`). */
export interface SandboxRuntimes {
  object: 'sandbox.runtimes'
  available: boolean
  node?: string
  python?: string
  pnpm?: string
  platform?: string
  python_packages?: Record<string, string>
}
