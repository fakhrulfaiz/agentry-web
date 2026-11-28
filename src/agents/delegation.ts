/** The agent editor's delegate catalog: the owner's saved agents plus read-only Library entries. */
import { api } from '@/api/client'
import type { OAIAgent } from '@/api/types'
import { descriptionOf } from './form'
import { sourceItems as sourceItemsOf, type LibraryItem } from './library/library'

/** One row in the Choose list. Library rows are shown for provenance, not selected as targets. */
export interface DelegateEntry {
  /** Saved agent id; absent for a Library definition that has not been added yet. */
  id?: string
  /** The qualified name the model sees (`Reviewer (Yours)`, `Agentry (Built in)`). */
  label: string
  description: string
  selectable: boolean
  kind: 'yours' | 'built-in' | 'library'
}

/** Saved agents and the built-in assistant first, then Library entries. */
export async function loadDelegateCatalog(selfId?: string): Promise<DelegateEntry[]> {
  const [saved, builtins, sources] = await Promise.all([
    api.listAgents().catch(() => null),
    api.listBuiltinLibrary().catch(() => null),
    api.listLibrarySources().catch(() => null),
  ])
  const agents = saved?.data ?? []
  const sourceLists = await Promise.all((sources?.data ?? []).map(async (source) => {
    const list = await api.listLibrarySourceAgents(source.id).catch(() => null)
    return list ? sourceItemsOf(source, list.data) : []
  }))
  return [
    ...agents.filter((agent: OAIAgent) => !agent.built_in && agent.id !== selfId).map((agent: OAIAgent) => ({
      id: agent.id,
      label: `${agent.name ?? 'Untitled agent'} (Yours)`,
      description: descriptionOf(agent),
      selectable: true,
      kind: 'yours' as const,
    })),
    ...agents.filter((agent: OAIAgent) => agent.built_in && agent.id !== selfId).map((agent: OAIAgent) => ({
      label: `${agent.name ?? 'Agentry'} (Built in)`,
      description: descriptionOf(agent),
      selectable: false,
      kind: 'built-in' as const,
    })),
    ...(builtins?.data ?? []).map((item: LibraryItem) => ({
      label: `${item.name} (Library: ${item.source})`,
      description: item.description,
      selectable: false,
      kind: 'library' as const,
    })),
    ...sourceLists.flat().map((item) => ({
      label: `${item.name} (Library: ${item.source})`,
      description: item.description,
      selectable: false,
      kind: 'library' as const,
    })),
  ]
}
