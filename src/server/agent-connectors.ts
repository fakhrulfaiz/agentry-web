import 'server-only'
import { instructionsWithConnectors } from '@/agents/form'

interface SavedAgent {
  instructions?: string | null
  metadata?: Record<string, string> | null
}

/**
 * Session-create body: when it names a saved agent (`agent_id`) that has a connector list
 * (`metadata.connectors`), overlays `agent.instructions` with the saved instructions plus the
 * soft app limit. Any other body (no `agent_id`, no list, agent not found) is returned as is.
 * The saved record keeps its own instructions.
 */
export async function withAgentConnectorNote(
  body: unknown,
  fetchAgent: (id: string) => Promise<SavedAgent | null>,
): Promise<unknown> {
  if (typeof body !== 'object' || body === null) return body
  const { agent_id: id, agent } = body as { agent_id?: unknown; agent?: unknown }
  if (typeof id !== 'string' || id === '') return body
  const overlay = typeof agent === 'object' && agent !== null && !Array.isArray(agent) ? (agent as Record<string, unknown>) : {}
  // The caller already chose instructions for this session: leave them alone.
  if (typeof overlay.instructions === 'string') return body
  const saved = await fetchAgent(id)
  const instructions = instructionsWithConnectors(saved?.instructions, saved?.metadata?.connectors)
  return instructions === undefined ? body : { ...body, agent: { ...overlay, instructions } }
}
