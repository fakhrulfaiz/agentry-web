'use client'

/**
 * The Agents page: Yours (a dense table of the user's saved agents, or the empty
 * state) and Starters (agents to start from, which open the form prefilled).
 */
import { avatarOf } from '@/agents/avatar'
import { AgentAvatar } from './AgentAvatar'
import { Banner } from '@astryxdesign/core/Banner'
import { Button } from '@astryxdesign/core/Button'
import { ClickableCard } from '@astryxdesign/core/ClickableCard'
import { EmptyState } from '@astryxdesign/core/EmptyState'
import { Heading } from '@astryxdesign/core/Heading'
import { HStack } from '@astryxdesign/core/HStack'
import { Icon } from '@astryxdesign/core/Icon'
import { StackItem } from '@astryxdesign/core/Layout'
import { Skeleton } from '@astryxdesign/core/Skeleton'
import { Text } from '@astryxdesign/core/Text'
import { TextInput } from '@astryxdesign/core/TextInput'
import { ToggleButton } from '@astryxdesign/core/ToggleButton'
import { VStack } from '@astryxdesign/core/VStack'
import { MagnifyingGlassIcon, PuzzlePieceIcon, UserGroupIcon, UsersIcon, WrenchScrewdriverIcon } from '@heroicons/react/24/outline'
import { useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, ApiError, isSignedOut } from '@/api/client'
import type { OAIAgent } from '@/api/types'
import { agentToForm } from '@/agents/form'
import { STARTERS } from '@/agents/starters'
import { goToLogin } from '@/chat/use-conversation'
import { CardGrid, EntityCard, Fact } from '@/ui/cards/EntityCard'
import { AgentEditorDialog, editorTargetOf } from './AgentEditorDialog'
import { useCachedState } from '@/ui/page-cache'

const COLUMN_WIDTH = 880

/** One-line summary: the first line of the instructions. */
const summary = (agent: OAIAgent): string => (agent.instructions ?? '').split('\n').find((l) => l.trim())?.trim() ?? ''

function Starters({ onPick }: { onPick(id: string): void }) {
  return (
    <VStack gap={3}>
      {STARTERS.map((starter) => (
        <ClickableCard key={starter.id} label={starter.name} onClick={() => onPick(starter.id)} width="100%" padding={4}>
          <VStack gap={1}>
            <Text weight="medium">{starter.name}</Text>
            <Text type="supporting" color="secondary">{starter.summary}</Text>
          </VStack>
        </ClickableCard>
      ))}
    </VStack>
  )
}

/**
 * The editor is opened and closed by changing the URL in place: no server
 * round trip, and the list stays mounted. Opening adds one history entry, so
 * Back closes the dialog; closing never adds one. An editor the page opened is
 * closed with Back; one that came from a link replaces its URL.
 */
export function closeEditor(openedHere: boolean) {
  if (openedHere) window.history.back()
  else window.history.replaceState(null, '', '/agents')
}

export function AgentsPage() {
  const params = useSearchParams()
  const target = editorTargetOf(new URLSearchParams(params.toString()))
  const editorOpen = useRef(target !== null)
  editorOpen.current = target !== null
  // Whether this page pushed the editor's URL (then closing goes Back).
  const openedHere = useRef(false)
  useEffect(() => {
    if (target === null) openedHere.current = false
  }, [target])
  const go = (url: string) => {
    window.history.pushState(null, '', url)
    openedHere.current = true
  }
  const close = () => {
    const pushed = openedHere.current
    openedHere.current = false
    closeEditor(pushed)
  }
  const [agents, setAgents] = useCachedState<OAIAgent[]>('agents')
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<'yours' | 'starters'>('yours')
  const [query, setQuery] = useState('')

  const load = useCallback(async () => {
    try {
      setAgents((await api.listAgents()).data)
      setError(null)
    } catch (err) {
      if (isSignedOut(err)) return goToLogin()
      setError(err instanceof ApiError ? err.message : 'Could not load your agents.')
      setAgents((cur) => cur ?? [])
    }
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (agents ?? []).filter((a) => !q || `${a.name ?? ''} ${a.instructions ?? ''}`.toLowerCase().includes(q))
  }, [agents, query])
  const pick = (id: string) => go(`/agents?starter=${encodeURIComponent(id)}`)

  return (
    <div style={{ width: '100%', maxWidth: COLUMN_WIDTH, margin: '0 auto', padding: '24px 16px' }}>
      <VStack gap={4}>
        <Heading level={1} type="display-2">Agents</Heading>
        <HStack gap={3} vAlign="center">
          <StackItem size="fill">
            <HStack gap={1} vAlign="center" role="group" aria-label="Agents view">
              <ToggleButton label="Yours" size="sm" isPressed={view === 'yours'} onPressedChange={() => setView('yours')} />
              <ToggleButton label="Starters" size="sm" isPressed={view === 'starters'} onPressedChange={() => setView('starters')} />
            </HStack>
          </StackItem>
          <Button label="New agent" variant="primary" onClick={() => go('/agents?new=1')} />
        </HStack>
        {error !== null && (
          <Banner status="error" title={error} endContent={<Button label="Retry" size="sm" onClick={() => void load()} />} />
        )}
        {view === 'starters' ? (
          <Starters onPick={pick} />
        ) : agents === null ? (
          <Skeleton height={160} />
        ) : agents.length === 0 ? (
          <EmptyState
            icon={<Icon icon={UserGroupIcon} size="lg" color="secondary" />}
            title="No agents yet."
            description="An agent is a saved setup: instructions, a model and the tools it may use. Create one, or start from a starter."
            actions={<Button label="Browse starters" onClick={() => setView('starters')} />}
          />
        ) : (
          <VStack gap={3}>
            <TextInput label="Search agents" isLabelHidden type="search" size="sm" placeholder="Search agents" startIcon={MagnifyingGlassIcon} value={query} onChange={setQuery} />
            {rows.length === 0 ? (
              <Text type="supporting" color="secondary" role="status">No agents match your search.</Text>
            ) : (
              <CardGrid label="Your agents">
                {rows.map((agent) => {
                  const form = agentToForm(agent)
                  const apps = Object.keys(form.apps ?? {})
                  return (
                    <EntityCard
                      key={agent.id}
                      href={`/agents?agent=${encodeURIComponent(agent.id)}`}
                      onClick={(event) => {
                        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
                        event.preventDefault()
                        go(`/agents?agent=${encodeURIComponent(agent.id)}`)
                      }}
                      title={agent.name || 'Untitled agent'}
                      leading={<AgentAvatar avatar={avatarOf(agent)} size="md" />}
                      trailing={<Text type="supporting" color="secondary" maxLines={1}>{agent.model}</Text>}
                      footer={
                        <>
                          <Fact icon={<Icon icon={WrenchScrewdriverIcon} size="sm" color="secondary" />}>
                            {form.allTools ? 'All tools' : `${form.tools.length} ${form.tools.length === 1 ? 'tool' : 'tools'}`}
                          </Fact>
                          <Fact icon={<Icon icon={PuzzlePieceIcon} size="sm" color="secondary" />}>
                            {apps.length === 0 ? 'Any app' : apps.length <= 2 ? apps.join(', ') : `${apps.slice(0, 2).join(', ')} +${apps.length - 2}`}
                          </Fact>
                          {form.subagents && (
                            <Fact icon={<Icon icon={UsersIcon} size="sm" color="secondary" />}>Subagents</Fact>
                          )}
                        </>
                      }
                    >
                      {summary(agent) ? (
                        <Text type="supporting" color="secondary" maxLines={2}>{summary(agent)}</Text>
                      ) : (
                        <Text type="supporting" color="secondary">No instructions yet.</Text>
                      )}
                    </EntityCard>
                  )
                })}
              </CardGrid>
            )}
          </VStack>
        )}
      </VStack>
      <AgentEditorDialog
        target={target}
        onClose={close}
        onSaved={(change) => {
          void load()
          // A save that lands after the dialog closed (Cancel during create) closes nothing again.
          if (change !== 'updated' && editorOpen.current) close()
        }}
      />
    </div>
  )
}
