'use client'

/**
 * The Agents page's Library tab: the built-in agents and the agent files of the user's sources, with a
 * search box, a source filter and a Sources dialog (⚙). Add opens the editor with a draft (like Import);
 * Preview reads the instructions in a drawer; Download .md saves the agent file.
 */
import { Banner } from '@astryxdesign/core/Banner'
import { Button } from '@astryxdesign/core/Button'
import { HStack } from '@astryxdesign/core/HStack'
import { Icon } from '@astryxdesign/core/Icon'
import { IconButton } from '@astryxdesign/core/IconButton'
import { StackItem } from '@astryxdesign/core/Layout'
import { Selector } from '@astryxdesign/core/Selector'
import { Text } from '@astryxdesign/core/Text'
import { TextInput } from '@astryxdesign/core/TextInput'
import { VStack } from '@astryxdesign/core/VStack'
import { ArrowPathIcon, Cog6ToothIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline'
import * as stylex from '@stylexjs/stylex'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, ApiError, isSignedOut } from '@/api/client'
import type { AgentDraft, LibraryCandidate, LibrarySource, OAIAgent } from '@/api/types'
import type { PendingDraft } from '@/agents/draft'
import { download, toAgentMarkdown } from '@/agents/export'
import { BUILTIN_SOURCE, libraryDraft, mergeLibrary, type LibraryItem, type ListedItem } from '@/agents/library/library'
import { goToLogin } from '@/chat/use-conversation'
import { CardGrid } from '@/ui/cards/EntityCard'
import { useCachedState } from '@/ui/page-cache'
import { LibraryCard } from './LibraryCard'
import { LibraryPreview } from './LibraryPreview'
import { LibrarySourcesDialog, type SourceState } from './LibrarySourcesDialog'

const ALL = 'all'
const ui = stylex.create({ filter: { width: { default: 124, '@media (min-width: 640px)': 168 }, flexShrink: 0 } })

interface LoadedSource {
  source: LibrarySource
  candidates: LibraryCandidate[] | null
  error: string | null
}

const messageOf = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback)

export function LibraryTab({ agents, onDraft }: {
  /** The user's agents, to mark added items and avoid name collisions. */
  agents: readonly OAIAgent[]
  /** An item was added: open the editor with this draft. */
  onDraft(draft: PendingDraft): void
}) {
  const [sources, setSources] = useCachedState<LoadedSource[]>('agents.library.sources')
  const [builtins, setBuiltins] = useCachedState<LibraryItem[]>('agents.library.builtin')
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<string>(ALL)
  const [managing, setManaging] = useState(false)
  const [adding, setAdding] = useState<string | null>(null)
  const [preview, setPreview] = useState<ListedItem | null>(null)
  // Drafts read for remote items (preview, add, download), by ref.
  const [drafts, setDrafts] = useState<ReadonlyMap<string, { draft: AgentDraft; notes: string[] }>>(new Map())
  const [previewError, setPreviewError] = useState<string | null>(null)

  const readSource = useCallback(async (source: LibrarySource, refresh = false): Promise<LoadedSource> => {
    try {
      return { source, candidates: (await api.listLibrarySourceAgents(source.id, refresh)).data, error: null }
    } catch (err) {
      if (isSignedOut(err)) goToLogin()
      return { source, candidates: null, error: messageOf(err, 'Could not read this source.') }
    }
  }, [])

  const load = useCallback(async () => {
    // The built-in Library comes from the API; a failure shows the error and leaves it empty.
    api.listBuiltinLibrary().then(
      (list) => setBuiltins(list.data),
      (err: unknown) => {
        if (isSignedOut(err)) return goToLogin()
        setError(messageOf(err, 'Could not load the built-in Library.'))
        setBuiltins((cur) => cur ?? [])
      },
    )
    try {
      const list = (await api.listLibrarySources()).data
      setSources(list.map((source) => ({ source, candidates: null, error: null })))
      setSources(await Promise.all(list.map((s) => readSource(s))))
      setError(null)
    } catch (err) {
      if (isSignedOut(err)) return goToLogin()
      setError(messageOf(err, 'Could not load your Library sources.'))
      setSources((cur) => cur ?? [])
    }
  }, [readSource])
  useEffect(() => {
    void load()
  }, [load])

  const refresh = async (id: string) => {
    const current = sources?.find((s) => s.source.id === id)
    if (!current) return
    const next = await readSource(current.source, true)
    setSources((cur) => (cur ?? []).map((s) => (s.source.id === id ? next : s)))
  }

  const items = useMemo(
    () => mergeLibrary(builtins ?? [], (sources ?? []).map((s) => ({ source: s.source, candidates: s.candidates ?? [] })), agents),
    [builtins, sources, agents],
  )
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return items.filter((i) => (filter === ALL || i.source === filter) && (!q || `${i.name} ${i.slug} ${i.description} ${i.source}`.toLowerCase().includes(q)))
  }, [items, query, filter])

  /** The item's draft: served with built-ins, read through import for remote ones. */
  const draftOf = async (item: ListedItem): Promise<{ draft: AgentDraft; notes: string[] }> => {
    if (!item.url) return { draft: item.draft ?? {}, notes: [] }
    const known = drafts.get(item.ref)
    if (known) return known
    const result = await api.importAgent({ url: item.url })
    if (result.object !== 'agent.import.draft') throw new Error('That link is a folder, not an agent file.')
    const read = { draft: result.draft, notes: result.notes }
    setDrafts((cur) => new Map(cur).set(item.ref, read))
    return read
  }

  const add = async (item: ListedItem) => {
    setAdding(item.ref)
    try {
      const { draft, notes } = await draftOf(item)
      setPreview(null)
      onDraft(libraryDraft(item, draft, notes, agents))
    } catch (err) {
      if (isSignedOut(err)) return goToLogin()
      setError(messageOf(err, `Could not read ${item.name}.`))
    } finally {
      setAdding(null)
    }
  }

  const save = async (item: ListedItem) => {
    try {
      const text = item.text ?? toAgentMarkdown((await draftOf(item)).draft)
      download(`${item.slug}.md`, text, 'text/markdown')
    } catch (err) {
      if (isSignedOut(err)) return goToLogin()
      setError(messageOf(err, `Could not read ${item.name}.`))
    }
  }

  const open = (item: ListedItem) => {
    setPreview(item)
    setPreviewError(null)
    if (item.url && !drafts.has(item.ref)) {
      draftOf(item).catch((err: unknown) => {
        if (isSignedOut(err)) return goToLogin()
        setPreviewError(messageOf(err, 'Could not read this agent.'))
      })
    }
  }

  const failed = (sources ?? []).filter((s) => s.error !== null)
  const loading = (sources ?? []).some((s) => s.candidates === null && s.error === null)
  const sourceStates: SourceState[] = (sources ?? []).map((s) => ({ source: s.source, count: s.candidates?.length ?? null, error: s.error }))
  const previewDraft = preview ? (preview.url ? drafts.get(preview.ref)?.draft ?? null : preview.draft ?? null) : null

  return (
    <VStack gap={3}>
      <HStack gap={2} vAlign="center">
        <StackItem size="fill">
          <TextInput label="Search the Library" isLabelHidden type="search" size="sm" placeholder="Search the Library" startIcon={MagnifyingGlassIcon} value={query} onChange={setQuery} />
        </StackItem>
        <StackItem xstyle={ui.filter}>
          <Selector
            label="Source"
            isLabelHidden
            size="sm"
            value={filter}
            onChange={(v) => setFilter(v ?? ALL)}
            options={[{ value: ALL, label: 'All sources' }, { value: BUILTIN_SOURCE, label: BUILTIN_SOURCE }, ...(sources ?? []).map((s) => ({ value: s.source.label, label: s.source.label }))]}
          />
        </StackItem>
        {(sources ?? []).length > 0 && (
          <IconButton label="Refresh sources" tooltip="Read your sources again" variant="ghost" size="sm" icon={<Icon icon={ArrowPathIcon} size="sm" />} isLoading={loading} onClick={() => { for (const s of sources ?? []) void refresh(s.source.id) }} />
        )}
        <IconButton label="Sources" tooltip="Library sources" variant="ghost" size="sm" icon={<Icon icon={Cog6ToothIcon} size="sm" />} onClick={() => setManaging(true)} />
      </HStack>
      {error !== null && <Banner status="error" title={error} isDismissable dismissLabel="Hide" onDismiss={() => setError(null)} endContent={<Button label="Retry" size="sm" onClick={() => void load()} />} />}
      {failed.map((s) => (
        <Banner key={s.source.id} status="warning" title={`Could not read ${s.source.label}`} description={s.error ?? undefined} endContent={<Button label="Retry" size="sm" onClick={() => void refresh(s.source.id)} />} />
      ))}
      {shown.length === 0 ? (
        <Text type="supporting" color="secondary" role="status">{loading ? 'Reading your sources…' : 'No agents match your search.'}</Text>
      ) : (
        <CardGrid label="Library agents">
          {shown.map((item) => (
            <LibraryCard
              key={item.ref}
              item={item}
              draft={item.url ? drafts.get(item.ref)?.draft : item.draft}
              isAdding={adding === item.ref}
              onPreview={() => open(item)}
              onAdd={() => void add(item)}
              onDownload={() => void save(item)}
            />
          ))}
        </CardGrid>
      )}
      <LibraryPreview
        item={preview}
        draft={previewDraft}
        error={previewError}
        onClose={() => setPreview(null)}
        onAdd={(item) => void add(item)}
        onDownload={(item) => void save(item)}
        isAdding={preview !== null && adding === preview.ref}
      />
      <LibrarySourcesDialog
        isOpen={managing}
        onClose={() => setManaging(false)}
        builtinCount={builtins?.length ?? null}
        sources={sourceStates}
        onAdded={(source) => {
          setSources((cur) => [...(cur ?? []), { source, candidates: null, error: null }])
          void readSource(source).then((next) => setSources((cur) => (cur ?? []).map((s) => (s.source.id === source.id ? next : s))))
        }}
        onRemoved={(id) => {
          setSources((cur) => (cur ?? []).filter((s) => s.source.id !== id))
          setFilter(ALL)
        }}
        onRefresh={(id) => void refresh(id)}
      />
    </VStack>
  )
}
