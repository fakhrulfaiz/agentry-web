'use client'

/**
 * The Library's sources: the built-in "Agentry" source, then the user's (a label and a GitHub folder or
 * gist link), each with a ⋯ menu (refresh, open, remove), and a small form to add one.
 */
import { Banner } from '@astryxdesign/core/Banner'
import { Button } from '@astryxdesign/core/Button'
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog'
import { DropdownMenu } from '@astryxdesign/core/DropdownMenu'
import { HStack } from '@astryxdesign/core/HStack'
import { Icon } from '@astryxdesign/core/Icon'
import { IconButton } from '@astryxdesign/core/IconButton'
import { StackItem } from '@astryxdesign/core/Layout'
import { List, ListItem } from '@astryxdesign/core/List'
import { Text } from '@astryxdesign/core/Text'
import { TextInput } from '@astryxdesign/core/TextInput'
import { VStack } from '@astryxdesign/core/VStack'
import { EllipsisHorizontalIcon } from '@heroicons/react/24/outline'
import * as stylex from '@stylexjs/stylex'
import { useState, type FormEvent } from 'react'
import { api, ApiError, isSignedOut } from '@/api/client'
import type { LibrarySource } from '@/api/types'
import { goToLogin } from '@/chat/use-conversation'
import { BUILTIN_SOURCE } from '@/agents/library/library'

const ui = stylex.create({ label: { width: 140 } })

/** Most sources the API keeps per user. */
const MAX_SOURCES = 10

export interface SourceState {
  source: LibrarySource
  /** Its agent files once read. */
  count: number | null
  error: string | null
}

const plural = (n: number) => `${String(n)} ${n === 1 ? 'agent' : 'agents'}`

export function LibrarySourcesDialog({ isOpen, onClose, builtinCount, sources, onAdded, onRemoved, onRefresh }: {
  isOpen: boolean
  /** How many built-in agents there are; `null` while loading. */
  builtinCount: number | null
  onClose(): void
  sources: readonly SourceState[]
  onAdded(source: LibrarySource): void
  onRemoved(id: string): void
  onRefresh(id: string): void
}) {
  const [label, setLabel] = useState('')
  const [url, setUrl] = useState('')
  const [error, setError] = useState<{ field: 'label' | 'url'; message: string } | null>(null)
  const [pending, setPending] = useState(false)
  const [removeError, setRemoveError] = useState<string | null>(null)

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setError(null)
    try {
      const source = await api.addLibrarySource({ label: label.trim(), url: url.trim() })
      setLabel('')
      setUrl('')
      onAdded(source)
    } catch (err) {
      if (isSignedOut(err)) return goToLogin()
      const code = err instanceof ApiError ? err.code : undefined
      const message = err instanceof ApiError ? err.message : 'Could not add that source.'
      setError({ field: code === 'invalid_label' || code === 'library_source_exists' ? 'label' : 'url', message })
    } finally {
      setPending(false)
    }
  }

  async function remove(id: string) {
    setRemoveError(null)
    try {
      await api.deleteLibrarySource(id)
      onRemoved(id)
    } catch (err) {
      if (isSignedOut(err)) return goToLogin()
      setRemoveError(err instanceof ApiError ? err.message : 'Could not remove that source.')
    }
  }

  const full = sources.length >= MAX_SOURCES
  return (
    <Dialog isOpen={isOpen} onOpenChange={(open) => !open && onClose()} width="min(600px, 96vw)" purpose="form" aria-label="Library sources">
      <DialogHeader title="Library sources" subtitle="Folders of agent files on GitHub, or gists. Agents you add stay when a source is removed." />
      <VStack gap={4} padding={4}>
        <List density="compact" hasDividers aria-label="Sources">
          <ListItem label={BUILTIN_SOURCE} description="Built in: agents adapted from ECC" endContent={builtinCount === null ? undefined : <Text type="supporting" color="secondary">{plural(builtinCount)}</Text>} />
          {sources.map(({ source, count, error: sourceError }) => (
            <ListItem
              key={source.id}
              label={source.label}
              description={sourceError ?? source.url}
              endContent={
                <HStack gap={1} vAlign="center">
                  {count !== null && <Text type="supporting" color="secondary">{plural(count)}</Text>}
                  <DropdownMenu
                    renderTrigger={(props) => <IconButton {...props} label={`More for ${source.label}`} icon={<Icon icon={EllipsisHorizontalIcon} size="sm" />} size="sm" variant="ghost" />}
                    alignment="end"
                    items={[
                      { label: 'Refresh', description: 'Read the folder again', onClick: () => onRefresh(source.id) },
                      { label: 'Open link', onClick: () => window.open(source.url, '_blank', 'noopener,noreferrer') },
                      { label: 'Remove', onClick: () => void remove(source.id) },
                    ]}
                  />
                </HStack>
              }
            />
          ))}
        </List>
        {removeError && <Banner status="error" title={removeError} />}
        <form onSubmit={(e) => void add(e)} noValidate>
          <HStack gap={2} vAlign="end" wrap="wrap">
            <StackItem xstyle={ui.label}>
              <TextInput label="Label" size="sm" placeholder="ECC" value={label} onChange={(v) => { setLabel(v); setError(null) }} status={error?.field === 'label' ? { type: 'error', message: error.message } : undefined} isDisabled={full} />
            </StackItem>
            <StackItem size="fill">
              <TextInput label="Link" size="sm" type="url" placeholder="https://github.com/owner/repo/tree/main/agents" value={url} onChange={(v) => { setUrl(v); setError(null) }} status={error?.field === 'url' ? { type: 'error', message: error.message } : undefined} isDisabled={full} />
            </StackItem>
            <Button type="submit" label="Add" size="sm" variant="primary" isLoading={pending} isDisabled={full || !label.trim() || !url.trim()} />
          </HStack>
        </form>
        <Text type="supporting" color="secondary">
          {full ? `You have ${String(MAX_SOURCES)} sources, the most you can keep.` : 'Check each source’s license before you share agents made from it.'}
        </Text>
      </VStack>
    </Dialog>
  )
}
