'use client'

/**
 * The agent form's Skills section: all built-ins (the default) or a chosen
 * set of built-in and library skills, plus the agent's private skills.
 */
import { Button } from '@astryxdesign/core/Button'
import { CheckboxList, CheckboxListItem } from '@astryxdesign/core/CheckboxList'
import { List, ListItem } from '@astryxdesign/core/List'
import { Switch } from '@astryxdesign/core/Switch'
import { Text } from '@astryxdesign/core/Text'
import { Token } from '@astryxdesign/core/Token'
import { VStack } from '@astryxdesign/core/VStack'
import { useCallback, useEffect, useState } from 'react'
import { api } from '@/api/client'
import type { AgentSkill, AgentSkillSelection, InstalledSkill, SkillManifest } from '@/api/types'
import { announceSkillsChanged } from '@/skills/skills-store'
import { AddSkillMenu } from '@/ui/plugins/AddSkillMenu'
import { SkillReviewDialog } from '@/ui/plugins/SkillDialogs'

export function SkillsSection({ agentId, value, onChange }: { agentId?: string; value: AgentSkillSelection | null; onChange(next: AgentSkillSelection | null): void }) {
  const [catalog, setCatalog] = useState<AgentSkill[]>([])
  const [library, setLibrary] = useState<InstalledSkill[]>([])
  const [own, setOwn] = useState<InstalledSkill[]>([])
  const [review, setReview] = useState<SkillManifest | null>(null)

  const load = useCallback(async () => {
    const [skills, lib, mine] = await Promise.all([
      api.listSkills().catch(() => ({ data: [] as AgentSkill[] })),
      api.listInstalledSkills('library').catch(() => [] as InstalledSkill[]),
      agentId ? api.listInstalledSkills('agent', agentId).catch(() => [] as InstalledSkill[]) : Promise.resolve([] as InstalledSkill[]),
    ])
    setCatalog(skills.data)
    setLibrary(lib.filter((s) => s.status === 'active'))
    setOwn(mine)
  }, [agentId])
  useEffect(() => { void load() }, [load])

  const builtins = catalog.filter((s) => s.kind === 'builtin').map((s) => s.name)
  const bundled = catalog.filter((s) => s.kind === 'bundled').map((s) => s.name)
  const libraryIds = new Set(library.map((s) => s.id))
  const checked = value ? [...value.builtin, ...value.library, ...bundled] : []
  const pick = (values: string[]) => onChange({ builtin: builtins.filter((n) => values.includes(n)), library: values.filter((v) => libraryIds.has(v)) })

  return (
    <VStack gap={4}>
      <Switch
        label="Use all built-in skills"
        description="Turn off to choose which built-in and library skills this agent loads."
        value={value === null}
        onChange={(all) => onChange(all ? null : { builtin: builtins, library: [] })}
      />
      {value === null && builtins.length + bundled.length > 0 && (
        <List hasDividers density="compact" header={<Text type="supporting" color="secondary">Included ({builtins.length + bundled.length})</Text>}>
          {builtins.map((name) => <ListItem key={name} label={name} description="Built-in" />)}
          {bundled.map((name) => <ListItem key={name} label={name} description="Always on" />)}
        </List>
      )}
      {value !== null && (
        <CheckboxList label="Skills" isLabelHidden density="compact" value={checked} onChange={pick}>
          {builtins.map((name) => <CheckboxListItem key={name} value={name} label={name} description="Built-in" />)}
          {library.map((s) => <CheckboxListItem key={s.id} value={s.id} label={s.name} description="Library" />)}
          {bundled.map((name) => <CheckboxListItem key={name} value={name} label={name} description="Always on" isDisabled />)}
        </CheckboxList>
      )}
      {agentId && (
        <VStack gap={2}>
          <Text weight="medium">Private skills</Text>
          <Text type="supporting" color="secondary">Only this agent loads these.</Text>
          {own.length > 0 && (
            <List hasDividers density="compact">
              {own.map((s) => (
                <ListItem
                  key={s.id}
                  label={s.name}
                  description={s.description}
                  endContent={s.status === 'pending_review'
                    ? <Button label="Review" size="sm" variant="secondary" onClick={() => void api.getSkill(s.id).then(setReview)} />
                    : s.has_scripts ? <Token label="Has scripts" size="sm" color="orange" /> : undefined}
                />
              ))}
            </List>
          )}
          <AddSkillMenu target={{ scope: 'agent', agentId }} onStaged={(s) => { void load(); void api.getSkill(s.id).then(setReview) }} onCreated={() => { announceSkillsChanged(); void load() }} />
        </VStack>
      )}
      <SkillReviewDialog
        manifest={review}
        onInstall={() => review && void api.activateSkill(review.skill.id).then(() => { setReview(null); announceSkillsChanged(); void load() })}
        onDiscard={() => review && void api.deleteSkill(review.skill.id).then(() => { setReview(null); announceSkillsChanged(); void load() })}
        onClose={() => setReview(null)}
      />
    </VStack>
  )
}
