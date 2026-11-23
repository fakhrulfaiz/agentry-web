'use client'

/**
 * The three ways to add a skill from the web: upload a .zip, import a GitHub
 * folder, or write one. Uploads and imports end in review (`onStaged`);
 * written skills are active at once (`onCreated`).
 */
import { Banner } from '@astryxdesign/core/Banner'
import { Button } from '@astryxdesign/core/Button'
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog'
import { FileInput } from '@astryxdesign/core/FileInput'
import { HStack } from '@astryxdesign/core/HStack'
import { TextInput } from '@astryxdesign/core/TextInput'
import { VStack } from '@astryxdesign/core/VStack'
import { useState } from 'react'
import { api } from '@/api/client'
import type { InstalledSkill } from '@/api/types'
import { SkillEditorDialog, type SkillDraft } from './SkillDialogs'

export interface AddSkillTarget {
  scope: 'library' | 'agent'
  agentId?: string
}

const message = (error: unknown): string => (error instanceof Error ? error.message : 'Something went wrong.')

export function AddSkillMenu({ target, onStaged, onCreated }: {
  target: AddSkillTarget
  onStaged(skill: InstalledSkill): void
  onCreated(skill: InstalledSkill): void
}) {
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [github, setGithub] = useState<{ repo: string; path: string; ref: string } | null>(null)
  const [editing, setEditing] = useState(false)
  const [editorError, setEditorError] = useState<string | null>(null)

  const upload = async (picked: File | null) => {
    setFile(picked)
    if (!picked) return
    setError(null)
    setBusy(true)
    try {
      onStaged(await api.uploadSkill(picked, target.scope, target.agentId))
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
      setFile(null)
    }
  }

  const importFromGithub = async () => {
    if (!github) return
    setBusy(true)
    setError(null)
    try {
      onStaged(await api.importSkill({ repo: github.repo.trim(), path: github.path.trim(), ...(github.ref.trim() ? { ref: github.ref.trim() } : {}), ...target }))
      setGithub(null)
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }

  const save = async (draft: SkillDraft) => {
    setBusy(true)
    setEditorError(null)
    try {
      onCreated(await api.createSkill({ ...draft, ...target }))
      setEditing(false)
    } catch (e) {
      setEditorError(message(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <VStack gap={3}>
      {error && <Banner status="error" title={error} />}
      <HStack gap={2} vAlign="end" wrap="wrap">
        <FileInput label="Skill .zip" description="A folder with SKILL.md, zipped. Up to 5 MB." accept=".zip,application/zip" value={file} onChange={(v) => void upload(Array.isArray(v) ? (v[0] ?? null) : v)} isDisabled={busy} />
        <Button label="Import from GitHub" variant="secondary" onClick={() => setGithub({ repo: '', path: '', ref: '' })} />
        <Button label="Write a skill" variant="secondary" onClick={() => { setEditorError(null); setEditing(true) }} />
      </HStack>
      <Dialog isOpen={github !== null} onOpenChange={(open) => !open && setGithub(null)} width={520} purpose="form">
        {github && (
          <VStack gap={4}>
            <DialogHeader title="Import from GitHub" subtitle="A public repository folder that holds SKILL.md." onOpenChange={(open) => !open && setGithub(null)} />
            <TextInput label="Repository" description="owner/name" value={github.repo} onChange={(repo) => setGithub({ ...github, repo })} isRequired />
            <TextInput label="Folder" description="Path to the skill folder, such as skills/pdf" value={github.path} onChange={(path) => setGithub({ ...github, path })} isRequired />
            <TextInput label="Branch or tag" description="Leave empty for the default branch." value={github.ref} onChange={(ref) => setGithub({ ...github, ref })} />
            <HStack gap={2} justify="end">
              <Button label="Cancel" variant="ghost" onClick={() => setGithub(null)} />
              <Button label="Import" variant="primary" onClick={() => void importFromGithub()} isLoading={busy} isDisabled={!github.repo || !github.path} />
            </HStack>
          </VStack>
        )}
      </Dialog>
      {editing && <SkillEditorDialog isOpen onSave={(d) => void save(d)} onClose={() => setEditing(false)} error={editorError} busy={busy} />}
    </VStack>
  )
}
