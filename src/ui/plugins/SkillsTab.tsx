'use client'

/**
 * The Skills tab of the Plugins page: Agentry's built-in skills, and your
 * library with add (upload, GitHub, write), review, edit, update and delete.
 */
import { AlertDialog } from '@astryxdesign/core/AlertDialog'
import { Banner } from '@astryxdesign/core/Banner'
import { Button } from '@astryxdesign/core/Button'
import { EmptyState } from '@astryxdesign/core/EmptyState'
import { HStack } from '@astryxdesign/core/HStack'
import { StackItem } from '@astryxdesign/core/Layout'
import { Tab, TabList } from '@astryxdesign/core/TabList'
import { Text } from '@astryxdesign/core/Text'
import { Token } from '@astryxdesign/core/Token'
import { VStack } from '@astryxdesign/core/VStack'
import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { api } from '@/api/client'
import type { AgentSkill, InstalledSkill, SkillManifest } from '@/api/types'
import { announceSkillsChanged } from '@/skills/skills-store'
import { CardGrid, EntityCard } from '@/ui/cards/EntityCard'
import { IconTile } from '@/ui/shared/IconTile'
import { AddSkillMenu } from './AddSkillMenu'
import { SkillDetail } from './SkillDetail'
import { skillVisual } from './skill-visual'
import { SkillEditorDialog, SkillReviewDialog, type SkillDraft } from './SkillDialogs'
import { useCachedState } from '@/ui/page-cache'

const NO_NAMES = new Map<string, string>()

const SOURCE: Record<InstalledSkill['source'], string> = { upload: 'Upload', github: 'GitHub', editor: 'Written here', chat: 'Made in chat' }
const message = (error: unknown): string => (error instanceof Error ? error.message : 'Something went wrong.')
const plural = (n: number, word: string) => `${String(n)} ${word}${n === 1 ? '' : 's'}`

/** A skill's body without frontmatter, for the editor. */
const bodyOf = (text: string): string => text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/u, '').trim()

export function SkillsTab() {
  const router = useRouter()
  const opened = useSearchParams().get('skill')
  const [view, setView] = useState<'builtin' | 'library'>('builtin')
  const [catalog, setCatalog] = useCachedState<AgentSkill[]>('skills.catalog')
  const [installed, setInstalled] = useCachedState<InstalledSkill[]>('skills.library')
  const [cachedNames, setAgentNames] = useCachedState<Map<string, string>>('skills.agentNames')
  const agentNames = cachedNames ?? NO_NAMES
  const [error, setError] = useState<string | null>(null)
  const [review, setReview] = useState<SkillManifest | null>(null)
  const [busy, setBusy] = useState(false)
  const [deleting, setDeleting] = useState<InstalledSkill | null>(null)
  const [editing, setEditing] = useState<{ skill: InstalledSkill; draft: SkillDraft } | null>(null)
  const [editError, setEditError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [skills, rows, agents] = await Promise.all([api.listSkills(), api.listInstalledSkills('library'), api.listAgents()])
      setCatalog(skills.data)
      setInstalled(rows)
      setAgentNames(new Map(agents.data.map((a) => [a.id, a.name ?? 'Untitled agent'])))
    } catch (e) {
      setError(message(e))
    }
  }, [])
  useEffect(() => { void load() }, [load])

  const openReview = async (skill: InstalledSkill) => {
    try {
      setReview(await api.getSkill(skill.id))
    } catch (e) {
      setError(message(e))
    }
  }
  const act = async (run: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await run()
      announceSkillsChanged()
      await load()
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }
  const install = () => review && void act(async () => { await api.activateSkill(review.skill.id); setReview(null) })
  const discard = () => review && void act(async () => { await api.deleteSkill(review.skill.id); setReview(null) })
  const checkUpdate = (skill: InstalledSkill) => void act(async () => {
    const updated = await api.updateSkill(skill.id)
    if (updated.status === 'pending_review') await openReview(updated)
  })
  const startEdit = async (skill: InstalledSkill) => {
    try {
      const manifest = await api.getSkill(skill.id)
      setEditError(null)
      setEditing({ skill, draft: { name: skill.name, description: skill.description, body: bodyOf(manifest.skill_md) } })
    } catch (e) {
      setError(message(e))
    }
  }
  const saveEdit = async (draft: SkillDraft) => {
    if (!editing) return
    setBusy(true)
    try {
      await api.editSkill(editing.skill.id, { description: draft.description, body: draft.body })
      announceSkillsChanged()
      setEditing(null)
      await load()
    } catch (e) {
      setEditError(message(e))
    } finally {
      setBusy(false)
    }
  }

  const builtins = (catalog ?? []).filter((s) => s.kind === 'builtin' || s.kind === 'bundled' || s.kind === undefined)
  const usedBy = (skill: InstalledSkill) => skill.used_by.map((id) => agentNames.get(id) ?? id)

  return (
    <VStack gap={4}>
      <TabList value={view} onChange={(v) => setView(v === 'library' ? 'library' : 'builtin')} size="sm" aria-label="Skill groups">
        <Tab value="builtin" label="Built-in" />
        <Tab value="library" label="Library" />
      </TabList>
      {error && <Banner status="error" title={error} />}

      {view === 'builtin' ? (
        <CardGrid label="Built-in skills">
          {builtins.map((s) => {
            const visual = skillVisual(s)
            return (
              <EntityCard
                key={s.name}
                href={`/plugins?tab=skills&skill=${encodeURIComponent(s.name)}`}
                title={s.name}
                leading={<IconTile icon={visual.icon} hue={visual.hue} />}
                trailing={<Token label={s.kind === 'bundled' ? 'Always on' : 'Built-in'} size="sm" />}
              >
                <Text type="supporting" color="secondary" maxLines={2}>{s.description}</Text>
              </EntityCard>
            )
          })}
        </CardGrid>
      ) : (
        <VStack gap={4}>
          <AddSkillMenu target={{ scope: 'library' }} onStaged={(s) => { void load(); void openReview(s) }} onCreated={() => { announceSkillsChanged(); void load() }} />
          {installed !== null && installed.length === 0 ? (
            <EmptyState title="No skills yet" description="Upload a skill, import one from GitHub, write one here, or ask a chat to make one." />
          ) : (
            <CardGrid label="Library skills">
              {(installed ?? []).map((s) => {
                const visual = skillVisual({ name: s.name, kind: 'library' })
                return (
                  <EntityCard
                    key={s.id}
                    href={s.status === 'active' ? `/plugins?tab=skills&skill=${encodeURIComponent(s.name)}` : undefined}
                    title={s.name}
                    leading={<IconTile icon={visual.icon} hue={visual.hue} />}
                    trailing={s.status === 'pending_review' ? <Token label="Pending review" size="sm" color="yellow" /> : <Text type="supporting" color="secondary">{SOURCE[s.source]}</Text>}
                    footer={
                      <HStack gap={2} vAlign="center" wrap="wrap">
                        {s.has_scripts && <Token label="Has scripts" size="sm" color="orange" />}
                        {s.used_by.length > 0 && <Text type="supporting" color="secondary">Used by {plural(s.used_by.length, 'agent')}</Text>}
                        <StackItem size="fill" />
                        {s.status === 'pending_review' && <Button label="Review" size="sm" variant="secondary" onClick={() => void openReview(s)} />}
                        {(s.source === 'editor' || s.source === 'chat') && <Button label="Edit" size="sm" variant="ghost" onClick={() => void startEdit(s)} />}
                        {s.source === 'github' && <Button label="Check for update" size="sm" variant="ghost" onClick={() => checkUpdate(s)} isDisabled={busy} />}
                        <Button label="Delete" aria-label={`Delete ${s.name}`} size="sm" variant="ghost" onClick={() => setDeleting(s)} />
                      </HStack>
                    }
                  >
                    <Text type="supporting" color="secondary" maxLines={2}>{s.description}</Text>
                  </EntityCard>
                )
              })}
            </CardGrid>
          )}
        </VStack>
      )}

      <SkillDetail name={opened} description={catalog?.find((c) => c.name === opened)?.description} onClose={() => router.replace('/plugins?tab=skills', { scroll: false })} />
      <SkillReviewDialog manifest={review} onInstall={install} onDiscard={discard} onClose={() => setReview(null)} busy={busy} />
      {editing && <SkillEditorDialog isOpen initial={editing.draft} onSave={(d) => void saveEdit(d)} onClose={() => setEditing(null)} error={editError} busy={busy} />}
      <AlertDialog
        isOpen={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Delete ${deleting?.name ?? 'skill'}?`}
        description={deleting && deleting.used_by.length > 0 ? `Used by ${usedBy(deleting).join(', ')}. They stop loading it.` : 'Its files are removed. This cannot be undone.'}
        actionLabel="Delete"
        onAction={() => deleting && void act(async () => { await api.deleteSkill(deleting.id); setDeleting(null) })}
        isActionLoading={busy}
        cancelLabel="Cancel"
      />
    </VStack>
  )
}
