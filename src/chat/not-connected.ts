/** Detects a Composio call that failed because the app is not connected, so the tool card can offer "Connect <App>". */

const PREFIX = 'mcp__composio__'
/** The direct app tools (`gmail_search_emails`, ...) start with their app's slug. */
const DIRECT = /^(gmail|googlecalendar)_/u
/** Wording that only means a missing connection, so it counts even in a call that reports success. */
const STRONG = /USER_NOT_LOGGED_IN|no (active |connected )?(connected )?(account|connection)|connected account (expired|not found)/iu
/** Looser wording ("401" can appear in any text), counted only when the call failed. */
const WEAK = /not connected|401|unauthori[sz]ed|reconnect/iu

/** The app (lowercase slug) of the call, or `null` when it is not an app tool. */
function appOfCall(name: string, args: unknown): string | null {
  const direct = DIRECT.exec(name)
  if (direct) return direct[1] ?? null
  if (!name.startsWith(PREFIX)) return null
  const raw = name.slice(PREFIX.length)
  if (raw === 'COMPOSIO_MULTI_EXECUTE_TOOL') {
    const tools = (args as { tools?: unknown } | null)?.tools
    const slug = Array.isArray(tools) ? (tools[0] as { tool_slug?: unknown } | undefined)?.tool_slug : undefined
    return typeof slug === 'string' ? (slug.split('_')[0]?.toLowerCase() ?? null) : null
  }
  if (raw.startsWith('COMPOSIO_')) return null
  return raw.split('_')[0]?.toLowerCase() ?? null
}

/**
 * @param name - the tool call's name.
 * @param args - its arguments.
 * @param output - its output text (an error message or the tool's JSON answer).
 * @param failed - the call's status is failed; only then the looser wording counts.
 * @returns the app slug whose connection is missing, or `null`.
 */
export function notConnectedApp(name: string, args: unknown, output: string | undefined, failed = false): string | null {
  if (output === undefined || !(STRONG.test(output) || (failed && WEAK.test(output)))) return null
  return appOfCall(name, args)
}
