'use client'

/**
 * Dialogs for skills: review a staged skill (files, SKILL.md, scripts
 * warning) before installing it, and write or edit a one-file skill.
 */
import { Banner } from '@astryxdesign/core/Banner'
import { Button } from '@astryxdesign/core/Button'
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog'
import { HStack } from '@astryxdesign/core/HStack'
import { List, ListItem } from '@astryxdesign/core/List'
import { Text } from '@astryxdesign/core/Text'
import { TextArea } from '@astryxdesign/core/TextArea'
import { TextInput } from '@astryxdesign/core/TextInput'
import { VStack } from '@astryxdesign/core/VStack'
import { useState } from 'react'
import type { SkillManifest } from '@/api/types'
import { Markdown } from '@/ui/chat/Markdown'

/** Bytes as a short size. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** `SKILL.md` without its frontmatter. */
const bodyOf = (text: string): string => text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/u, '')

export function SkillReviewDialog({ manifest, onInstall, onDiscard, onClose, busy }: {
  manifest: SkillManifest | null
  onInstall(): void
  onDiscard(): void
  onClose(): void
  busy?: boolean
}) {
  const skill = manifest?.skill
  return (
    <Dialog isOpen={manifest !== null} onOpenChange={(open) => !open && onClose()} width={720} purpose="form">
      {manifest && skill && (
        <VStack gap={4}>
          <DialogHeader title={`Review ${skill.name}`} subtitle={skill.description} onOpenChange={(open) => !open && onClose()} />
          {skill.has_scripts && (
            <Banner status="warning" title="This skill includes scripts that run in your agent's sandbox." description="Install it only if you trust where it came from." />
          )}
          {skill.origin && (
            <Text type="supporting" color="secondary">
              From {skill.origin.repo}/{skill.origin.path} at {skill.origin.commit.slice(0, 7)}
            </Text>
          )}
          <List density="compact" hasDividers header={<Text weight="medium">Files</Text>}>
            {manifest.files.map((f) => (
              <ListItem key={f.path} label={f.path} endContent={<Text type="supporting" color="secondary">{formatSize(f.bytes)}</Text>} />
            ))}
          </List>
          <VStack gap={2}>
            <Text weight="medium">SKILL.md</Text>
            <Markdown text={bodyOf(manifest.skill_md)} />
          </VStack>
          <HStack gap={2} justify="end">
            <Button label="Discard" variant="ghost" onClick={onDiscard} isDisabled={busy} />
            <Button label="Install" variant="primary" onClick={onInstall} isLoading={busy} />
          </HStack>
        </VStack>
      )}
    </Dialog>
  )
}

export interface SkillDraft {
  name: string
  description: string
  body: string
}

export function SkillEditorDialog({ isOpen, initial, onSave, onClose, error, busy }: {
  isOpen: boolean
  /** Editing keeps the name fixed. */
  initial?: SkillDraft
  onSave(draft: SkillDraft): void
  onClose(): void
  error?: string | null
  busy?: boolean
}) {
  const [draft, setDraft] = useState<SkillDraft>(initial ?? { name: '', description: '', body: '' })
  const set = (patch: Partial<SkillDraft>) => setDraft((d) => ({ ...d, ...patch }))
  return (
    <Dialog isOpen={isOpen} onOpenChange={(open) => !open && onClose()} width={640} purpose="form">
      <VStack gap={4}>
        <DialogHeader title={initial ? `Edit ${initial.name}` : 'Write a skill'} subtitle="A skill is a set of instructions your agents load when a task needs it." onOpenChange={(open) => !open && onClose()} />
        {error && <Banner status="error" title={error} />}
        <TextInput label="Name" description="Lowercase words joined by hyphens, such as weekly-report." value={draft.name} onChange={(name) => set({ name })} isDisabled={initial !== undefined} isRequired />
        <TextInput label="Description" description="When an agent should use it." value={draft.description} onChange={(description) => set({ description })} isRequired />
        <TextArea label="Instructions" description="Markdown." rows={12} value={draft.body} onChange={(body) => set({ body })} isRequired />
        <HStack gap={2} justify="end">
          <Button label="Cancel" variant="ghost" onClick={onClose} />
          <Button label="Save skill" variant="primary" onClick={() => onSave(draft)} isLoading={busy} isDisabled={!draft.name || !draft.description || !draft.body} />
        </HStack>
      </VStack>
    </Dialog>
  )
}
