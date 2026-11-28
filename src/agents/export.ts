/**
 * Export a saved agent as Agentry JSON or as a Claude Code / ECC style Markdown file, built in the
 * browser from the record. No secrets: MCP tools come back from the API with `***` credentials and
 * are left out. Client-safe and pure.
 */
import type { OAIAgent } from '@/api/types'

/** Host tool names to Claude Code tool names (the reverse of the API's import map). */
const CLAUDE_TOOLS: Readonly<Record<string, string>> = {
  read: 'Read', write: 'Write', edit: 'Edit', grep: 'Grep', glob: 'Glob', bash: 'Bash', web_fetch: 'WebFetch', web_search: 'WebSearch', todo_write: 'TodoWrite',
}

/** File-safe name: `Code reviewer` → `code-reviewer`. */
export function slugOf(name: string | null | undefined): string {
  return (name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'agent'
}

/** The record without id, timestamps and MCP tools (whose credentials are masked). */
export function toAgentJson(agent: OAIAgent): string {
  const { id: _id, created_at: _c, updated_at: _u, object: _o, tools, ...rest } = agent
  const kept = (tools ?? []).filter((t) => t.type !== 'mcp')
  return `${JSON.stringify({ ...rest, ...(kept.length > 0 ? { tools: kept } : {}) }, null, 2)}\n`
}

/** Front matter (`name`, `description`, `tools`) plus the instructions; tools without a Claude Code name are left out. */
export function toAgentMarkdown(agent: OAIAgent): string {
  const description = (agent.metadata?.description ?? (agent.instructions ?? '').split('\n').find((l) => l.trim()) ?? '').trim()
  const lines = ['---', `name: ${slugOf(agent.name)}`, `description: ${JSON.stringify(description)}`]
  const allow = agent.host_tools?.allow
  const tools = [...new Set([...(allow ?? []).map((t) => CLAUDE_TOOLS[t]).filter(Boolean), ...(agent.multi_agent?.enabled ? ['Task'] : [])])]
  if (allow && allow.length > 0) lines.push(`tools: ${tools.join(', ')}`)
  lines.push('---', '', (agent.instructions ?? '').trim(), '')
  return lines.join('\n')
}

/** Start a download of `text` as `filename` (browser only). */
export function download(filename: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
