import 'server-only'
import { createHash } from 'node:crypto'
import type { IronSession } from 'iron-session'
import { createConnectionCache } from './connection-cache'
import { getCatalog } from './connector-catalog'
import { loadConnections, type ConnectorKeyStatus } from './connector-key-upstream'
import type { SessionData } from './session'

/** The process-wide connection status cache (one entry per signed-in user). */
export const connections = createConnectionCache({ load: loadConnections })

/**
 * The cache slot of a signed-in user: the owner id, or for apikey sign-ins (no owner id) a hash
 * of the key, so two API keys never share an entry.
 */
export function cacheOwner(session: Pick<IronSession<SessionData>, 'identity' | 'credential'>): string {
  if (session.identity?.owner) return session.identity.owner
  const key = session.credential?.kind === 'apikey' ? session.credential.key : ''
  return `apikey:${createHash('sha256').update(key).digest('hex').slice(0, 16)}`
}

/** Which stored key a status describes; a new key starts a new cache entry. */
export const keyStamp = (status: ConnectorKeyStatus) => `${status.last4 ?? ''}:${status.updated_at ?? 0}`

/**
 * The user's connection snapshot for the whole catalog. Answers from memory
 * when any recent answer exists; `force` checks Composio (through the API) now.
 */
export async function connectionSnapshot(owner: string, stamp: string, authorization: string, force = false) {
  const catalog = await getCatalog()
  return connections.get(owner, stamp, catalog.entries.map((e) => e.slug), { force, authorization })
}
