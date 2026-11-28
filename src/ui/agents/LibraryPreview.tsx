'use client'

/**
 * A Library agent in a side drawer: who it is, what it uses, and its full instructions, with Add,
 * Download .md and a link to where it came from. Remote agents are read through `POST /agents/import`.
 */
import { Banner } from '@astryxdesign/core/Banner'
import { Button } from '@astryxdesign/core/Button'
import { Drawer } from '@astryxdesign/core/Drawer'
import { HStack } from '@astryxdesign/core/HStack'
import { Icon } from '@astryxdesign/core/Icon'
import { IconButton } from '@astryxdesign/core/IconButton'
import { StackItem } from '@astryxdesign/core/Layout'
import { Skeleton } from '@astryxdesign/core/Skeleton'
import { Text } from '@astryxdesign/core/Text'
import { Token } from '@astryxdesign/core/Token'
import { VStack } from '@astryxdesign/core/VStack'
import { ArrowDownTrayIcon, ArrowTopRightOnSquareIcon } from '@heroicons/react/24/outline'
import type { AgentDraft } from '@/api/types'
import type { ListedItem } from '@/agents/library/library'
import { Markdown } from '@/ui/chat/Markdown'
import { LibraryAvatar, LibraryFacts } from './LibraryCard'

export function LibraryPreview({ item, draft, error, onClose, onAdd, onDownload, isAdding }: {
  item: ListedItem | null
  /** The item's draft once read (built-ins at once, remote ones after the import call). */
  draft: AgentDraft | null
  error: string | null
  onClose(): void
  onAdd(item: ListedItem): void
  onDownload(item: ListedItem): void
  isAdding: boolean
}) {
  const link = item?.url ?? item?.origin
  return (
    <Drawer isOpen={item !== null} onOpenChange={(open) => !open && onClose()} label={item ? `Preview ${item.name}` : 'Preview'} width={720} padding={5}>
      {item && (
        <VStack gap={4}>
          <HStack gap={3} vAlign="center">
            <LibraryAvatar item={item} size="lg" />
            <VStack gap={1}>
              <Text weight="medium" size="lg">{item.name}</Text>
              <HStack gap={2} vAlign="center">
                <Token label={item.source} size="sm" />
                {item.added && <Token label="Added" size="sm" color="green" />}
              </HStack>
            </VStack>
            <StackItem size="fill" />
            {link && (
              <IconButton
                label="Open the source"
                tooltip={item.url ? 'Open on GitHub' : 'Original on GitHub (ECC)'}
                variant="ghost"
                size="sm"
                icon={<Icon icon={ArrowTopRightOnSquareIcon} size="sm" />}
                onClick={() => window.open(link, '_blank', 'noopener,noreferrer')}
              />
            )}
            <IconButton label="Download .md" tooltip="Download .md" variant="ghost" size="sm" icon={<Icon icon={ArrowDownTrayIcon} size="sm" />} onClick={() => onDownload(item)} />
            <Button label={item.added ? 'Add again' : 'Add'} variant="primary" size="sm" isLoading={isAdding} onClick={() => onAdd(item)} />
          </HStack>
          <Text color="secondary">{item.description}</Text>
          <HStack gap={4} wrap="wrap"><LibraryFacts item={item} draft={draft} /></HStack>
          {error ? (
            <Banner status="error" title={error} />
          ) : draft === null ? (
            <Skeleton height={240} />
          ) : (
            <VStack gap={2}>
              <Text weight="medium">Instructions</Text>
              <Markdown text={draft.instructions ?? ''} />
            </VStack>
          )}
          {item.source === 'Agentry' && (
            <Text type="supporting" color="secondary">Adapted for Agentry from ECC by Affaan Mustafa (MIT License).</Text>
          )}
        </VStack>
      )}
    </Drawer>
  )
}
