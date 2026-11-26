'use client'

/**
 * Which Agentry tools an agent may use: every tool, or a searchable checklist
 * with Select all / Clear for the tools that match the search.
 */
import { Button } from '@astryxdesign/core/Button'
import { CheckboxList, CheckboxListItem } from '@astryxdesign/core/CheckboxList'
import { HStack } from '@astryxdesign/core/HStack'
import { StackItem } from '@astryxdesign/core/Layout'
import { List, ListItem } from '@astryxdesign/core/List'
import { Switch } from '@astryxdesign/core/Switch'
import { Text } from '@astryxdesign/core/Text'
import { TextInput } from '@astryxdesign/core/TextInput'
import { VStack } from '@astryxdesign/core/VStack'
import { MagnifyingGlassIcon } from '@heroicons/react/24/outline'
import { useMemo, useState } from 'react'
import type { HostToolInfo } from '@/api/types'

/** A tool's name in words: `load_workspace_dependencies` → "Load workspace dependencies"; MCP-style names keep their server prefix readable. */
export function toolTitle(name: string): string {
  const words = name.replace(/^mcp__/, '').replace(/__/g, ': ').replace(/[_-]+/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

export function ToolsPicker({ tools, allTools, value, onChange }: {
  tools: HostToolInfo[]
  allTools: boolean
  value: string[]
  onChange(next: { allTools: boolean; tools: string[] }): void
}) {
  const [query, setQuery] = useState('')
  const names = useMemo(() => tools.map((t) => t.name), [tools])
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? tools.filter((t) => `${t.name} ${t.description ?? ''}`.toLowerCase().includes(q)) : tools
  }, [tools, query])
  const shownNames = shown.map((t) => t.name)

  return (
    <VStack gap={4}>
      <Switch
        label="Allow every tool"
        description="New tools Agentry adds later are included too. Turn off to choose."
        value={allTools}
        onChange={(all) => onChange({ allTools: all, tools: all ? value : value.length > 0 ? value : names })}
      />
      {allTools && tools.length > 0 && (
        <VStack gap={3}>
          <TextInput label="Search tools" isLabelHidden type="search" size="sm" placeholder="Search tools" startIcon={MagnifyingGlassIcon} value={query} onChange={setQuery} />
          <List hasDividers density="compact" header={<Text type="supporting" color="secondary">Included ({tools.length})</Text>}>
            {shown.map((t) => <ListItem key={t.name} label={toolTitle(t.name)} description={t.description} />)}
          </List>
        </VStack>
      )}
      {!allTools &&
        (tools.length === 0 ? (
          <Text type="supporting" color="secondary">The tool list is unavailable right now. Try again in a moment.</Text>
        ) : (
          <VStack gap={3}>
            <HStack gap={2} vAlign="center">
              <StackItem size="fill">
                <TextInput label="Search tools" isLabelHidden type="search" size="sm" placeholder="Search tools" startIcon={MagnifyingGlassIcon} value={query} onChange={setQuery} />
              </StackItem>
              <Button label="Select all" size="sm" variant="ghost" onClick={() => onChange({ allTools: false, tools: [...new Set([...value, ...shownNames])] })} />
              <Button label="Clear" size="sm" variant="ghost" onClick={() => onChange({ allTools: false, tools: value.filter((n) => !shownNames.includes(n)) })} />
            </HStack>
            <Text type="supporting" color="secondary" role="status">
              {value.length} of {tools.length} tools allowed
            </Text>
            {shown.length === 0 ? (
              <Text type="supporting" color="secondary">No tools match “{query.trim()}”.</Text>
            ) : (
              <CheckboxList label="Allowed tools" isLabelHidden density="compact" value={value} onChange={(next) => onChange({ allTools: false, tools: next })}>
                {shown.map((t) => (
                  <CheckboxListItem key={t.name} value={t.name} label={toolTitle(t.name)} description={t.description} />
                ))}
              </CheckboxList>
            )}
          </VStack>
        ))}
    </VStack>
  )
}
