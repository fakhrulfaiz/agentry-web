import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { generate } from '../../scripts/build-library.mjs'
import { LIBRARY_FILES } from '@/agents/library/files.generated'
import { BUILTIN_LIBRARY, builtinDraft, libraryDraft, mergeLibrary, nameForAdd, parseFrontMatter, parseLibraryFile } from '@/agents/library/library'
import { AGENT_COLORS, AGENT_ICONS } from '@/agents/avatar'
import type { LibrarySource, OAIAgent } from '@/api/types'

/** The server's Host tools (`GET /v1/agents/tools`, 2026-11-28). */
const SERVER_TOOLS = new Set([
  'load_workspace_dependencies', 'list_mcp_resources', 'list_mcp_resource_templates', 'read_mcp_resource', 'working_directory', 'skill', 'present',
  'bash', 'read', 'write', 'edit', 'glob', 'grep', 'job_output', 'job_list', 'job_kill', 'get_goal', 'create_goal', 'update_goal', 'web_search',
  'web_fetch', 'plugin_manager', 'read_image', 'todo_write', 'ask_user_question', 'list_agents', 'send_message', 'interrupt_agent', 'workflow',
  'exit_plan_mode', 'list_subagent_models', 'subagent', 'subagent_fork', 'schedule_create', 'schedule_list', 'schedule_view', 'schedule_edit',
])

describe('built-in library files', () => {
  it('are bundled as they are on disk', () => {
    expect(generate()).toBe(readFileSync(new URL('../../src/agents/library/files.generated.ts', import.meta.url), 'utf8'))
  })

  it('all parse, credit ECC, use only server tools and known avatars', () => {
    expect(LIBRARY_FILES.length).toBeGreaterThanOrEqual(15)
    for (const { file, text } of LIBRARY_FILES) {
      const { item, draft } = parseLibraryFile(file, text)
      const front = parseFrontMatter(text)!.data
      expect(front['source'], file).toMatch(/^https:\/\/github\.com\/affaan-m\/ECC\/blob\/main\/agents\/.+\.md$/)
      expect(front['license'], file).toBe('MIT (ECC, Affaan Mustafa)')
      expect(front['model'], file).toBeUndefined()
      expect(draft.instructions!.length, file).toBeGreaterThan(500)
      expect(draft.instructions, file).not.toMatch(/mcp__|CLAUDE\.md|slash command|PostToolUse|\bopus\b|\bsonnet\b|\bhaiku\b/i)
      for (const tool of draft.host_tools?.allow ?? []) expect(SERVER_TOOLS.has(tool), `${file}: ${tool}`).toBe(true)
      expect(item.icon && item.icon in AGENT_ICONS, file).toBe(true)
      expect(AGENT_COLORS as readonly string[], file).toContain(item.color)
    }
    const e2e = BUILTIN_LIBRARY.find((i) => i.slug === 'e2e-runner')!
    expect(builtinDraft(e2e)).toMatchObject({ name: 'E2E runner', browser: true, metadata: { icon: 'web', color: 'green' } })
    expect(builtinDraft(BUILTIN_LIBRARY.find((i) => i.slug === 'chief-of-staff')!)?.apps).toEqual({ gmail: 'all', googlecalendar: 'all', slack: 'all' })
    expect(builtinDraft(BUILTIN_LIBRARY.find((i) => i.slug === 'marketing-agent')!)?.multi_agent).toEqual({ enabled: true })
  })
})

describe('adding from the Library', () => {
  it('names a colliding agent "<Name> (<source>)", then numbers it', () => {
    expect(nameForAdd('Planner', 'ECC', ['Architect'])).toBe('Planner')
    expect(nameForAdd('Planner', 'ECC', ['planner'])).toBe('Planner (ECC)')
    expect(nameForAdd('Planner', 'ECC', ['Planner', 'Planner (ECC)'])).toBe('Planner (ECC) 2')
  })

  it('keeps the source in metadata and merges built-ins first, marking added items', () => {
    const source: LibrarySource = { id: 'lsrc_1', object: 'library.source', label: 'ECC', url: 'https://github.com/o/r/tree/main/agents', created_at: 1 }
    const planner = BUILTIN_LIBRARY.find((i) => i.slug === 'planner')!
    const mine = [{ id: 'agent_1', name: 'Planner', metadata: { library_ref: planner.ref } }] as unknown as OAIAgent[]
    const items = mergeLibrary(BUILTIN_LIBRARY, [{ source, candidates: [{ name: 'planner', description: 'Plans', url: 'https://github.com/o/r/blob/main/agents/planner.md' }] }], mine)
    expect(items.slice(0, BUILTIN_LIBRARY.length).every((i) => i.source === 'Agentry')).toBe(true)
    expect(items.find((i) => i.ref === planner.ref)?.added).toBe(true)
    const remote = items.at(-1)!
    expect(remote).toMatchObject({ source: 'ECC', name: 'Planner', ref: 'ECC:https://github.com/o/r/blob/main/agents/planner.md', added: false })
    const pending = libraryDraft(remote, { name: 'Planner', instructions: 'x' }, ['note'], mine)
    expect(pending.draft.name).toBe('Planner (ECC)')
    expect(pending.draft.metadata).toEqual({ library_source: 'ECC', library_ref: remote.ref })
    expect(pending).toMatchObject({ notes: ['note'], sourceUrl: remote.url })
  })
})
