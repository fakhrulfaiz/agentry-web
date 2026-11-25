import 'server-only'
import { createConnectionCache } from './connection-cache'
import { getCatalog } from './connector-catalog'
import { loadInventory } from './connector-inventory'

/** The process-wide connection status cache (one entry per owner). */
export const connections = createConnectionCache({ load: loadInventory })

/**
 * The owner's connection snapshot for the whole catalog. Answers from memory
 * when any recent answer exists; `force` checks Composio now.
 */
export async function connectionSnapshot(owner: string, key: string, force = false) {
  const catalog = await getCatalog()
  return connections.get(owner, key, catalog.entries.map((e) => e.slug), { force })
}
