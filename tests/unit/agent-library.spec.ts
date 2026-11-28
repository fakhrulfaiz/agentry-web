import { describe, expect, it } from 'vitest'
import { libraryDraft, mergeLibrary, nameForAdd, type LibraryItem } from '@/agents/library/library'
import type { LibrarySource, OAIAgent } from '@/api/types'

// The built-in files and their parse test live in the API (`tests/agent-library-builtin.spec.ts`); the web app reads them from `/agents/library/builtin`.
const BUILTIN_LIBRARY: LibraryItem[] = [
  { ref: 'Agentry:planner.md', source: 'Agentry', name: 'Planner', slug: 'planner', description: 'Plans', draft: { name: 'Planner', instructions: 'Plan.' } },
]

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
