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
  reasoning?: { effort?: ReasoningEffort | null; summary?: 'auto' | 'none' | null } | null
  service_tier?: ServiceTier | null
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

/** Saved user or assistant message. */
export interface OAIMessageItem {
  id: string
  type: 'message'
  role: 'user' | 'assistant'
  content: OAITextContentPart[]
  phase?: 'commentary' | 'final_answer' | null
  status: ItemStatus
  turn_id: string
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
}

/** Saved reasoning summary. */
export interface OAIReasoningItem {
  id: string
  type: 'reasoning'
  summary?: Array<{ type: 'summary_text'; text: string }>
  status: ItemStatus
  turn_id: string
}

/** One saved session item. */
export type OAISessionItem =
  | OAIMessageItem
  | OAIFunctionCallItem
  | OAIFunctionCallOutputItem
  | OAIMcpCallItem
  | OAICommandExecutionItem
  | OAIReasoningItem

/** One saved item, with the child id when it belongs to a subagent (`GET .../items`). */
export type StoredSessionItem = OAISessionItem & { subagent_id?: string }

/** User, assistant, or system input message. */
export interface OAIInputMessage {
  role: 'user' | 'assistant' | 'system'
  content?: Array<{ type: string; text?: string }>
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
  | { type: 'agent.session.input.message'; input: OAIInputMessage[] }
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
  | { type: 'agent.session.turn.output_text.delta'; event_id: string; item_id: string; output_index: number; content_index: number; session_id: string; turn_id: string; delta: string }
  | { type: 'agent.session.turn.output_text.done'; event_id: string; item_id: string; output_index: number; content_index: number; session_id: string; turn_id: string; text: string }
  | { type: 'error'; event_id: string; session_id?: string; error: { message: string; type?: string; code?: string } }

/** Session-status events: each carries the full session resource. */
export type OAISessionStatusEvent = Extract<OAISessionEvent, { session: OAIAgentSession }>

/** Error body Agentry answers with (`{ error: { type, message, code } }`). */
export interface OAIErrorBody {
  error: { type?: string; message?: string; code?: string }
}
