import 'server-only'

/** One connected account of an app. */
export interface ConnectedAccount {
  id: string
  alias: string | null
  status: string
}

/** App slug to whether one account is active, and its accounts (read by the API, `GET /agents/connectors/composio/connections`). */
export type ConnectedInventory = Record<string, { connected: boolean; accounts: ConnectedAccount[] }>

/** Slugs with an active account. */
export function connectedSlugs(inventory: ConnectedInventory): string[] {
  return Object.entries(inventory).flatMap(([slug, app]) => (app.connected ? [slug] : []))
}
