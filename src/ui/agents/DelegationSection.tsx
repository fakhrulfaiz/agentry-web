'use client'

/**
 * The agent form's Subagents section: whether the agent can delegate to any saved agent, only to
 * chosen ones, or not at all. Library rows show provenance but must be added before they can be
 * chosen; built-in Agentry is always available when delegation is on.
 */
import { CheckboxList, CheckboxListItem } from '@astryxdesign/core/CheckboxList'
import { HStack } from '@astryxdesign/core/HStack'
import { List, ListItem } from '@astryxdesign/core/List'
import { Skeleton } from '@astryxdesign/core/Skeleton'
import { Text } from '@astryxdesign/core/Text'
import { TextInput } from '@astryxdesign/core/TextInput'
import { ToggleButton } from '@astryxdesign/core/ToggleButton'
import { VStack } from '@astryxdesign/core/VStack'
import { MagnifyingGlassIcon } from '@heroicons/react/24/outline'
import { useEffect, useMemo, useState } from 'react'
import type { AgentDelegation, AgentDelegationMode } from '@/api/types'
import { loadDelegateCatalog, type DelegateEntry } from '@/agents/delegation'

const MODES: { mode: AgentDelegationMode; label: string }[] = [
  { mode: 'any', label: 'Any' },
  { mode: 'choose', label: 'Choose' },
  { mode: 'off', label: 'Off' },
]

export function DelegationSection({ value, onChange, selfId }: {
  value: AgentDelegation
  onChange(next: AgentDelegation): void
  /** The agent being edited; it cannot delegate to itself. */
  selfId?: string
}) {
  const [entries, setEntries] = useState<DelegateEntry[] | null>(null)
  const [query, setQuery] = useState('')
  useEffect(() => {
    let alive = true
    void loadDelegateCatalog(selfId).then((catalog) => {
      if (alive) setEntries(catalog)
    })
    return () => {
      alive = false
    }
  }, [selfId])

  const setMode = (mode: AgentDelegationMode) => {
    if (mode !== value.mode) onChange({ mode, agent_ids: [] })
  }
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? (entries ?? []).filter((e) => `${e.label} ${e.description}`.toLowerCase().includes(q)) : entries ?? []
  }, [entries, query])
  const selectable = shown.filter((entry) => entry.selectable)
  const alwaysRows = shown.filter((entry) => entry.kind === 'built-in')
  const libraryRows = shown.filter((entry) => entry.kind === 'library')

  return (
    <VStack gap={2}>
      <Text weight="medium">Can delegate to</Text>
      <Text type="supporting" color="secondary">Any saved agent can help, choose a shortlist, or turn delegation off. Built-in Agentry is always available when delegation is on.</Text>
      <HStack gap={1} wrap="wrap" role="group" aria-label="Can delegate to">
        {MODES.map(({ mode, label }) => (
          <ToggleButton key={mode} label={label} size="sm" isPressed={value.mode === mode} onPressedChange={() => setMode(mode)} />
        ))}
      </HStack>
      {value.mode === 'choose' && (
        entries === null ? (
          <Skeleton height={120} />
        ) : (
          <VStack gap={3}>
            <TextInput
              label="Search delegates"
              isLabelHidden
              type="search"
              size="sm"
              placeholder="Search delegates"
              startIcon={MagnifyingGlassIcon}
              value={query}
              onChange={setQuery}
            />
            {shown.length === 0 ? (
              <Text type="supporting" color="secondary">No delegates match “{query.trim()}”.</Text>
            ) : (
              <>
                {selectable.length > 0 && (
                  <CheckboxList
                    label="Allowed delegate agents"
                    isLabelHidden
                    density="compact"
                    value={value.agent_ids}
                    onChange={(agentIds) => onChange({ mode: 'choose', agent_ids: agentIds })}
                  >
                    {selectable.map((entry) => (
                      <CheckboxListItem key={entry.id} value={entry.id ?? entry.label} label={entry.label} description={entry.description} />
                    ))}
                  </CheckboxList>
                )}
                {alwaysRows.length > 0 && (
                  <List hasDividers density="compact" header={<Text type="supporting" color="secondary">Always available</Text>}>
                    {alwaysRows.map((entry) => (
                      <ListItem key={entry.label} label={entry.label} description={entry.description} />
                    ))}
                  </List>
                )}
                {libraryRows.length > 0 && (
                  <List hasDividers density="compact" header={<Text type="supporting" color="secondary">Add from the Library to delegate</Text>}>
                    {libraryRows.map((entry) => (
                      <ListItem key={entry.label} label={entry.label} description={entry.description} />
                    ))}
                  </List>
                )}
              </>
            )}
          </VStack>
        )
      )}
    </VStack>
  )
}
