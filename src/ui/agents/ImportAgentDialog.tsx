'use client'

/**
 * Import an agent: from a GitHub or gist link, or pasted text (a Claude Code / ECC agent file or
 * Agentry JSON). A folder link lists its agent files to pick one. The chosen draft opens the editor
 * prefilled; nothing is saved until the user saves it.
 */
import { Button } from '@astryxdesign/core/Button'
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog'
import { HStack } from '@astryxdesign/core/HStack'
import { List, ListItem } from '@astryxdesign/core/List'
import { Text } from '@astryxdesign/core/Text'
import { TextArea } from '@astryxdesign/core/TextArea'
import { TextInput } from '@astryxdesign/core/TextInput'
import { ToggleButton } from '@astryxdesign/core/ToggleButton'
import { VStack } from '@astryxdesign/core/VStack'
import { useState, type FormEvent } from 'react'
import { api, ApiError, isSignedOut } from '@/api/client'
import type { AgentImportResult } from '@/api/types'
import { goToLogin } from '@/chat/use-conversation'
import type { PendingDraft } from '@/agents/draft'

type Candidates = Extract<AgentImportResult, { object: 'agent.import.candidates' }>['data']

export function ImportAgentDialog({ isOpen, onClose, onDraft }: {
  isOpen: boolean
  onClose(): void
  /** A draft was read: open the editor with it. */
  onDraft(draft: PendingDraft): void
}) {
  const [mode, setMode] = useState<'link' | 'paste'>('link')
  const [url, setUrl] = useState('')
  const [text, setText] = useState('')
  const [candidates, setCandidates] = useState<Candidates | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  function reset() {
    setUrl('')
    setText('')
    setCandidates(null)
    setError(null)
    setPending(false)
  }

  async function read(input: { url: string } | { text: string }) {
    setPending(true)
    setError(null)
    try {
      const result = await api.importAgent(input)
      if (result.object === 'agent.import.candidates') {
        setCandidates(result.data)
        if (result.data.length === 0) setError('No agent files (Markdown with a name at the top) in that folder.')
      } else {
        reset()
        onDraft({ draft: result.draft, notes: result.notes, ...(result.source.url ? { sourceUrl: result.source.url } : {}) })
      }
    } catch (err) {
      if (isSignedOut(err)) return goToLogin()
      setError(err instanceof ApiError ? err.message : 'Could not read that agent.')
    } finally {
      setPending(false)
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void read(mode === 'link' ? { url: url.trim() } : { text })
  }

  return (
    <Dialog isOpen={isOpen} onOpenChange={(open) => { if (!open) { reset(); onClose() } }} width="min(560px, 96vw)" purpose="form" aria-label="Import an agent">
      <DialogHeader title="Import an agent" subtitle="A Claude Code agent file or an Agentry agent, from GitHub, a gist, or pasted text." />
      <form onSubmit={submit} noValidate>
        <VStack gap={3} padding={4}>
          <HStack gap={1} role="group" aria-label="Import from">
            <ToggleButton label="From a link" size="sm" isPressed={mode === 'link'} onPressedChange={() => { setMode('link'); setError(null) }} />
            <ToggleButton label="Paste" size="sm" isPressed={mode === 'paste'} onPressedChange={() => { setMode('paste'); setError(null); setCandidates(null) }} />
          </HStack>
          {mode === 'link' ? (
            <TextInput
              label="Link"
              type="url"
              placeholder="https://github.com/owner/repo/blob/main/agents/planner.md"
              value={url}
              onChange={(value) => { setUrl(value); setError(null); setCandidates(null) }}
              status={error ? { type: 'error', message: error } : undefined}
            />
          ) : (
            <TextArea
              label="Agent definition"
              placeholder={'---\nname: code-reviewer\ndescription: Reviews code\ntools: Read, Grep\n---\n\nYou review code…'}
              value={text}
              onChange={(value) => { setText(value); setError(null) }}
              rows={10}
              status={error ? { type: 'error', message: error } : undefined}
            />
          )}
          {candidates && candidates.length > 0 && (
            <VStack gap={1}>
              <Text type="supporting" color="secondary">{`${String(candidates.length)} agent ${candidates.length === 1 ? 'file' : 'files'} in this folder. Pick one:`}</Text>
              <List density="compact" hasDividers>
                {candidates.map((c) => (
                  <ListItem key={c.url} label={c.name} description={c.description} onClick={() => void read({ url: c.url })} isDisabled={pending} />
                ))}
              </List>
            </VStack>
          )}
          <Text type="supporting" color="secondary">Nothing is saved until you review the agent and save it.</Text>
          <HStack gap={2} hAlign="end">
            <Button label="Cancel" variant="ghost" onClick={() => { reset(); onClose() }} />
            <Button type="submit" label="Read" variant="primary" isLoading={pending} isDisabled={mode === 'link' ? !url.trim() : !text.trim()} />
          </HStack>
        </VStack>
      </form>
    </Dialog>
  )
}
