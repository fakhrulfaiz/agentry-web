'use client'

/**
 * One Library agent as a card: avatar, name, description, source and what it uses. A click opens
 * the preview; the trailing controls are a small Add button (or "Added") and a ⋯ menu.
 */
import { Button } from '@astryxdesign/core/Button'
import { DropdownMenu } from '@astryxdesign/core/DropdownMenu'
import { HStack } from '@astryxdesign/core/HStack'
import { Icon } from '@astryxdesign/core/Icon'
import { IconButton } from '@astryxdesign/core/IconButton'
import { Text } from '@astryxdesign/core/Text'
import { Token } from '@astryxdesign/core/Token'
import { EllipsisHorizontalIcon, GlobeAltIcon, PuzzlePieceIcon, UsersIcon, WrenchScrewdriverIcon } from '@heroicons/react/24/outline'
import { AGENT_COLORS, AGENT_ICONS, defaultAvatar } from '@/agents/avatar'
import type { ListedItem } from '@/agents/library/library'
import type { AgentDraft } from '@/api/types'
import type { HueName } from '@/ui/brand/palette'
import { EntityCard, Fact } from '@/ui/cards/EntityCard'
import { AgentAvatar } from './AgentAvatar'

/** The item's avatar: its own icon and colour, else a stable one from its ref. */
export function LibraryAvatar({ item, size = 'md' }: { item: ListedItem; size?: 'sm' | 'md' | 'lg' }) {
  const fallback = defaultAvatar(item.ref)
  const icon = item.icon && item.icon in AGENT_ICONS ? item.icon : fallback.icon
  const color = item.color && (AGENT_COLORS as readonly string[]).includes(item.color) ? (item.color as HueName) : fallback.color
  return <AgentAvatar avatar={{ icon, color }} size={size} />
}

/** Tools, apps, browser and subagents, from the draft when known. */
export function LibraryFacts({ item, draft }: { item: ListedItem; draft: AgentDraft | null | undefined }) {
  const tools = draft?.host_tools?.allow
  const apps = item.apps ?? Object.keys(draft?.apps ?? {})
  return (
    <>
      {draft && (
        <Fact icon={<Icon icon={WrenchScrewdriverIcon} size="sm" color="secondary" />}>
          {tools ? `${String(tools.length)} ${tools.length === 1 ? 'tool' : 'tools'}` : 'All tools'}
        </Fact>
      )}
      {apps.length > 0 && <Fact icon={<Icon icon={PuzzlePieceIcon} size="sm" color="secondary" />}>{apps.join(', ')}</Fact>}
      {(item.browser || draft?.browser === true) && <Fact icon={<Icon icon={GlobeAltIcon} size="sm" color="secondary" />}>Web browser</Fact>}
      {(item.subagents || draft?.multi_agent?.enabled) && <Fact icon={<Icon icon={UsersIcon} size="sm" color="secondary" />}>Subagents</Fact>}
    </>
  )
}

export function LibraryCard({ item, draft, isAdding, onPreview, onAdd, onDownload }: {
  item: ListedItem
  draft?: AgentDraft
  isAdding: boolean
  onPreview(): void
  onAdd(): void
  onDownload(): void
}) {
  const link = item.url ?? item.origin
  return (
    <EntityCard
      href={`#${encodeURIComponent(item.ref)}`}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
        event.preventDefault()
        onPreview()
      }}
      title={item.name}
      leading={<LibraryAvatar item={item} />}
      trailing={
        <HStack gap={1} vAlign="center">
          {item.added ? (
            <Token label="Added" size="sm" color="green" />
          ) : (
            <Button label="Add" size="sm" variant="secondary" isLoading={isAdding} onClick={onAdd} aria-label={`Add ${item.name}`} />
          )}
          <DropdownMenu
            renderTrigger={(props) => <IconButton {...props} label={`More for ${item.name}`} icon={<Icon icon={EllipsisHorizontalIcon} size="sm" />} size="sm" variant="ghost" />}
            alignment="end"
            items={[
              { label: 'Preview', onClick: onPreview },
              ...(item.added ? [{ label: 'Add again', description: 'Another copy to edit', onClick: onAdd }] : []),
              { label: 'Download .md', description: 'Agent file', onClick: onDownload },
              ...(link ? [{ label: item.url ? 'Open on GitHub' : 'Original on GitHub', onClick: () => window.open(link, '_blank', 'noopener,noreferrer') }] : []),
            ]}
          />
        </HStack>
      }
      footer={
        <>
          <Token label={item.source} size="sm" />
          <LibraryFacts item={item} draft={draft} />
        </>
      }
    >
      <Text type="supporting" color="secondary" maxLines={2}>{item.description || 'No description.'}</Text>
    </EntityCard>
  )
}
