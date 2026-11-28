'use client'

/**
 * The agent editor, shown in a wide dialog over the Agents page. The left pane
 * is who the agent is (name, model, instructions); the right pane is what it
 * may use (tools, skills, apps, subagents), one tab each. The header shows the
 * avatar and takes the agent's colour as it is picked, and the footer says what
 * is still missing before it can be saved. `agentId` absent means a new agent.
 */
import { AlertDialog } from '@astryxdesign/core/AlertDialog'
import { Banner } from '@astryxdesign/core/Banner'
import { Link } from '@astryxdesign/core/Link'
import { Button } from '@astryxdesign/core/Button'
import { Heading } from '@astryxdesign/core/Heading'
import { HStack } from '@astryxdesign/core/HStack'
import { Icon } from '@astryxdesign/core/Icon'
import { IconButton } from '@astryxdesign/core/IconButton'
import { StackItem } from '@astryxdesign/core/Layout'
import { Popover } from '@astryxdesign/core/Popover'
import { Selector } from '@astryxdesign/core/Selector'
import { Skeleton } from '@astryxdesign/core/Skeleton'
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl'
import { Switch } from '@astryxdesign/core/Switch'
import { Tab, TabList } from '@astryxdesign/core/TabList'
import { Text } from '@astryxdesign/core/Text'
import { TextArea } from '@astryxdesign/core/TextArea'
import { TextInput } from '@astryxdesign/core/TextInput'
import { ToggleButton } from '@astryxdesign/core/ToggleButton'
import { VStack } from '@astryxdesign/core/VStack'
import { CheckCircleIcon, ExclamationCircleIcon, XMarkIcon } from '@heroicons/react/24/outline'
import * as stylex from '@stylexjs/stylex'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { api, ApiError, isSignedOut } from '@/api/client'
import type { HostToolInfo } from '@/api/types'
import { connectedAppsMemo, hostToolsMemo, modelsMemo } from '@/agents/form-data'
import { agentToForm, delegationError, descriptionError, emptyForm, formToParams, MAX_SUBAGENTS, type AgentForm as FormState, type EffortChoice } from '@/agents/form'
import { applyDraft, pendingDraft, type PendingDraft } from '@/agents/draft'
import { goToLogin } from '@/chat/use-conversation'
import { HUES, tint } from '@/ui/brand/palette'
import { AgentAvatar } from './AgentAvatar'
import { AppsSection } from './AppsSection'
import { AvatarPicker } from './AvatarPicker'
import { DelegationSection } from './DelegationSection'
import { SkillsSection } from './SkillsSection'
import { ToolsPicker } from './ToolsPicker'

const EFFORTS: { value: EffortChoice; label: string }[] = [
  { value: 'auto', label: 'Auto' }, { value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' },
]

type Section = 'tools' | 'skills' | 'apps' | 'subagents'

const SECTIONS: { value: Section; label: string }[] = [
  { value: 'tools', label: 'Tools' },
  { value: 'skills', label: 'Skills' },
  { value: 'apps', label: 'Apps' },
  { value: 'subagents', label: 'Subagents' },
]

const WIDE = '@media (min-width: 900px)'

const ui = stylex.create({
  shell: { display: 'flex', flexDirection: 'column', blockSize: 'min(860px, 94dvh)' },
  header: {
    display: 'flex',
    flexWrap: { default: 'wrap', [WIDE]: 'nowrap' },
    alignItems: 'center',
    columnGap: 16,
    rowGap: 12,
    paddingBlock: 18,
    paddingInlineStart: 24,
    paddingInlineEnd: 16,
    borderBlockEndWidth: 1,
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: 'var(--color-border)',
    transitionProperty: 'background-color',
    transitionDuration: { default: '240ms', '@media (prefers-reduced-motion: reduce)': '0s' },
  },
  titles: { flexGrow: 1, flexBasis: 0, minInlineSize: 0 },
  body: {
    flexGrow: 1,
    minBlockSize: 0,
    overflowY: { default: 'auto', [WIDE]: 'hidden' },
    display: { default: 'block', [WIDE]: 'grid' },
    gridTemplateColumns: { default: 'none', [WIDE]: 'minmax(0, 5fr) minmax(0, 6fr)' },
  },
  profile: {
    display: 'flex',
    flexDirection: 'column',
    gap: 20,
    padding: 24,
    overflowY: { default: 'visible', [WIDE]: 'auto' },
    borderStyle: 'solid',
    borderColor: 'var(--color-border)',
    borderWidth: 0,
    borderInlineEndWidth: { default: 0, [WIDE]: 1 },
    borderBlockEndWidth: { default: 1, [WIDE]: 0 },
  },
  capabilities: {
    display: 'flex',
    flexDirection: 'column',
    minBlockSize: 0,
    backgroundColor: 'var(--color-background-muted)',
  },
  tabs: { paddingInline: 24, paddingBlockStart: 8, flexShrink: 0 },
  panel: { padding: 24, flexGrow: 1, minBlockSize: 0, overflowY: { default: 'visible', [WIDE]: 'auto' } },
  footer: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 12,
    paddingBlock: 14,
    paddingInline: 24,
    borderBlockStartWidth: 1,
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: 'var(--color-border)',
  },
  checks: { flexGrow: 1, minInlineSize: 0 },
  // On wide screens the instructions fill the rest of the profile column instead of leaving a gap under them.
  // Field = label + control wrapper; the grid's 1fr row stretches the wrapper, the control fills it, the textarea stretches.
  instructions: { flexGrow: { default: 0, [WIDE]: 1 }, display: 'grid', gridTemplateRows: 'auto 1fr' },
  instructionsControl: { flexGrow: { default: 0, [WIDE]: 1 }, display: 'flex', alignItems: 'stretch' },
  avatarButton: { padding: 0, borderWidth: 0, backgroundColor: 'transparent', cursor: 'pointer', borderRadius: 14, display: 'block', flexShrink: 0 },
})

/** What each capability tab is for, shown at the top of its panel. */
const INTROS: Record<Section, string> = {
  tools: 'Actions the agent can take on its own, such as reading files, searching the web or running code.',
  skills: 'Know-how the agent loads when a task calls for it, such as writing a Word document or using an app.',
  apps: 'Your connected accounts, such as Gmail or GitHub, that the agent may use for you.',
  subagents: 'Helpers the agent can start to work on parts of a task at the same time.',
}

/** What blocks saving (`required`) and what is worth doing first. */
export function readiness(form: FormState): { label: string; ok: boolean; required: boolean }[] {
  return [
    { label: 'Name', ok: form.name.trim() !== '', required: true },
    { label: 'Description', ok: descriptionError(form.description) === null, required: true },
    { label: 'Model', ok: form.model !== '', required: true },
    { label: 'Tools', ok: form.allTools || form.tools.length > 0, required: true },
    { label: 'Instructions', ok: form.instructions.trim().length >= 20, required: false },
  ]
}

/** The short note on a capability tab. */
export function tabNote(section: Section, form: FormState): string {
  switch (section) {
    case 'tools':
      return form.allTools ? 'All' : String(form.tools.length)
    case 'skills':
      return form.skills === null ? 'Built-in' : String(form.skills.builtin.length + form.skills.library.length)
    case 'apps':
      return form.apps === null ? 'Any' : String(Object.keys(form.apps).length)
    case 'subagents':
      return form.subagents ? `Up to ${String(form.maxSubagents)}` : 'Off'
  }
}

export function AgentForm({ agentId, fromDraft = false, onClose, onSaved }: {
  agentId?: string
  /** Start from the held draft (an import or a chat's subagent); nothing is saved until Save. */
  fromDraft?: boolean
  /** Close without saving. Defaults to going back to the Agents page. */
  onClose?: () => void
  /** After a create, save or delete. Without it, create and delete go back to the Agents page. */
  onSaved?: (change: 'created' | 'updated' | 'deleted') => void
}) {
  const router = useRouter()
  const close = onClose ?? (() => router.push('/agents'))
  const [form, setForm] = useState<FormState | null>(null)
  const [tools, setTools] = useState<HostToolInfo[]>([])
  const [apps, setApps] = useState<string[] | null>(null)
  const [models, setModels] = useState<string[]>([])
  const [section, setSection] = useState<Section>('tools')
  const [error, setError] = useState<string | null>(null)
  const [missing, setMissing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [avatarOpen, setAvatarOpen] = useState(false)
  const [draftInfo, setDraftInfo] = useState<PendingDraft | null>(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const [modelList, toolList, connected, agent] = await Promise.all([
          modelsMemo.get(),
          hostToolsMemo.get().catch((): HostToolInfo[] => []),
          connectedAppsMemo.get().catch(() => null),
          agentId ? api.getAgent(agentId) : Promise.resolve(null),
        ])
        if (!alive) return
        const defaultModel = modelList[0] ?? ''
        let base = agent ? agentToForm(agent, defaultModel) : emptyForm(defaultModel)
        const held = !agentId && fromDraft ? pendingDraft() : null
        if (held) base = applyDraft(base, held.draft, toolList.map((t) => t.name), modelList)
        setDraftInfo(held)
        setModels(modelList)
        setTools(toolList)
        setApps(connected)
        setForm(base)
      } catch (err) {
        if (isSignedOut(err)) return goToLogin()
        if (err instanceof ApiError && err.status === 404) return alive && setMissing(true)
        if (alive) setError(err instanceof ApiError ? err.message : 'Could not load this agent.')
      }
    })()
    return () => {
      alive = false
    }
  }, [agentId, fromDraft])

  const set = (patch: Partial<FormState>) => {
    setSaved(false)
    setError(null)
    setForm((cur) => (cur ? { ...cur, ...patch } : cur))
  }

  async function save() {
    if (!form) return
    if (!form.name.trim()) return setError('Give the agent a name.')
    const descriptionProblem = descriptionError(form.description)
    if (descriptionProblem) return setError(descriptionProblem)
    if (!form.model) return setError('Choose a model.')
    if (!form.allTools && form.tools.length === 0) return setError('Choose at least one tool, or allow every tool.')
    const delegationProblem = delegationError(form.delegation)
    if (delegationProblem) return setError(delegationProblem)
    setSaving(true)
    setError(null)
    try {
      const params = formToParams(form, tools.map((t) => t.name))
      if (agentId) {
        await api.updateAgent(agentId, params)
        modelsMemo.clear()
        setSaved(true)
        onSaved?.('updated')
      } else {
        await api.createAgent(params)
        modelsMemo.clear()
        if (onSaved) onSaved('created')
        else router.push('/agents')
      }
    } catch (err) {
      if (isSignedOut(err)) return goToLogin()
      setError(err instanceof ApiError ? err.message : 'Could not save the agent.')
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    if (!agentId) return
    try {
      await api.deleteAgent(agentId)
      if (onSaved) onSaved('deleted')
      else router.push('/agents')
    } catch (err) {
      setConfirmDelete(false)
      setError(err instanceof ApiError ? err.message : 'Could not delete the agent.')
    }
  }

  if (missing)
    return (
      <VStack gap={4} padding={6}>
        <Banner status="warning" title="This agent no longer exists." />
        <HStack hAlign="end"><Button label="Close" onClick={close} /></HStack>
      </VStack>
    )

  const title = form?.name.trim() || (agentId ? 'Untitled agent' : 'New agent')
  const hue = form ? HUES[form.color] : undefined
  const checks = form ? readiness(form) : []

  return (
    <div {...stylex.props(ui.shell)}>
      <header {...stylex.props(ui.header)} style={hue ? { backgroundColor: tint(hue, 8) } : undefined}>
        {form ? (
          <Popover
            isOpen={avatarOpen}
            onOpenChange={setAvatarOpen}
            label="Agent avatar"
            width={340}
            content={<AvatarPicker icon={form.icon} color={form.color} onChange={(patch) => set(patch)} />}
          >
            <button type="button" aria-label="Change avatar" title="Change avatar" {...stylex.props(ui.avatarButton)}>
              <AgentAvatar avatar={{ icon: form.icon, color: form.color }} size="lg" />
            </button>
          </Popover>
        ) : (
          <Skeleton width={56} height={56} radius={4} />
        )}
        <div {...stylex.props(ui.titles)}>
          <Heading level={2} maxLines={1}>{title}</Heading>
          <Text type="supporting" color="secondary" maxLines={1}>
            {agentId ? 'Changes apply to new chats with this agent.' : 'Not saved yet. Click the avatar to change it.'}
          </Text>
        </div>
        <IconButton label="Close" icon={<Icon icon={XMarkIcon} />} variant="ghost" size="sm" onClick={close} />
      </header>

      {!form ? (
        <div {...stylex.props(ui.body)} aria-busy="true" aria-label="Loading agent">
          <VStack gap={4} padding={6}>
            <Skeleton height={40} />
            <Skeleton height={40} index={1} />
            <Skeleton height={260} index={2} />
          </VStack>
          <VStack gap={4} padding={6}>
            <Skeleton height={32} />
            <Skeleton height={300} index={1} />
          </VStack>
        </div>
      ) : (
        <div {...stylex.props(ui.body)}>
          <section aria-label="Profile" {...stylex.props(ui.profile)}>
            {draftInfo && (draftInfo.notes.length > 0 || draftInfo.sourceUrl) && (
              <Banner
                status="info"
                title="Review this draft before you save it."
                isDismissable
                dismissLabel="Hide"
                description={
                  <VStack gap={1}>
                    {draftInfo.notes.map((note) => <Text key={note} type="supporting">{note}</Text>)}
                    {draftInfo.sourceUrl && (
                      <>
                        <Link href={draftInfo.sourceUrl} target="_blank" rel="noopener noreferrer">{draftInfo.sourceUrl}</Link>
                        <Text type="supporting">Check the source&apos;s license before you share this agent.</Text>
                      </>
                    )}
                  </VStack>
                }
              />
            )}
            <TextInput label="Name" value={form.name} onChange={(name) => set({ name })} placeholder="Inbox assistant" isRequired />
            <TextInput
              label="Description"
              description="One line that says what this agent does. Shown on its card and to other agents choosing delegates."
              value={form.description}
              onChange={(description) => set({ description })}
              placeholder="Sorts my inbox"
              isRequired
            />
            <HStack gap={3}>
              <StackItem size="fill">
                <Selector label="Model" options={models.length > 0 ? models : [form.model]} value={form.model} onChange={(model) => set({ model })} />
              </StackItem>
              <StackItem size="fill">
                <Selector label="Reasoning effort" options={EFFORTS} value={form.effort} onChange={(v) => set({ effort: v as EffortChoice })} />
              </StackItem>
            </HStack>
            <TextArea
              label="Instructions"
              description="What this agent is for and how it should work. It reads this at the start of every chat."
              rows={16}
              containerXstyle={ui.instructions}
              controlXstyle={ui.instructionsControl}
              value={form.instructions}
              onChange={(instructions) => set({ instructions })}
              placeholder={'You keep my inbox under control.\nEach morning, sort new mail into Reply, Read later and Ignore, then draft replies for the first group.'}
            />
          </section>

          <section aria-label="Capabilities" {...stylex.props(ui.capabilities)}>
            <div {...stylex.props(ui.tabs)}>
              <TabList value={section} onChange={(v) => setSection(v as Section)} role="tablist" hasDivider aria-label="Capabilities">
                {SECTIONS.map((s) => (
                  <Tab
                    key={s.value}
                    value={s.value}
                    label={s.label}
                    panelId="agent-capability-panel"
                    endContent={<Text type="supporting" color="secondary">{tabNote(s.value, form)}</Text>}
                  />
                ))}
              </TabList>
            </div>
            <div {...stylex.props(ui.panel)} role="tabpanel" id="agent-capability-panel" aria-label={SECTIONS.find((s) => s.value === section)?.label}>
              <VStack gap={5}>
              <Text type="supporting" color="secondary">{INTROS[section]}</Text>
              {section === 'tools' && (
                <VStack gap={4}>
                  <VStack gap={2}>
                    <Text type="label">Web browser</Text>
                    <Text type="supporting" color="secondary">Open web pages in a headless Chromium, read them, click, type and take screenshots. Runs in sandbox chats only, inside the sandbox; chats on the server get no browser. Auto turns it on when the chat's sandbox has one (the Web and browser template does).</Text>
                    <SegmentedControl label="Web browser" value={form.browser} onChange={(browser) => set({ browser: browser as 'auto' | 'on' | 'off' })}>
                      <SegmentedControlItem value="auto" label="Auto (when the sandbox has a browser)" />
                      <SegmentedControlItem value="on" label="On" />
                      <SegmentedControlItem value="off" label="Off" />
                    </SegmentedControl>
                  </VStack>
                  <ToolsPicker tools={tools} allTools={form.allTools} value={form.tools} onChange={(next) => set(next)} />
                </VStack>
              )}
              {section === 'skills' && <SkillsSection agentId={agentId} value={form.skills} onChange={(skills) => set({ skills })} />}
              {section === 'apps' && (
                <AppsSection connected={apps} value={form.apps} onChange={(grants) => set({ apps: grants })} sendPolicy={form.sendPolicy} onSendPolicy={(sendPolicy) => set({ sendPolicy })} />
              )}
              {section === 'subagents' && (
                <VStack gap={4}>
                  <Switch
                    label="Let this agent delegate to subagents"
                    description="It can hand parts of a task to helpers that work in parallel and report back."
                    value={form.subagents}
                    onChange={(subagents) => set({ subagents })}
                  />
                  {form.subagents && (
                    <>
                      <VStack gap={2}>
                        <Text weight="medium">Most at once</Text>
                        <HStack gap={1} wrap="wrap" role="group" aria-label="Most subagents at once">
                          {Array.from({ length: MAX_SUBAGENTS }, (_, i) => i + 1).map((n) => (
                            <ToggleButton key={n} label={String(n)} size="sm" isPressed={form.maxSubagents === n} onPressedChange={() => set({ maxSubagents: n })} />
                          ))}
                        </HStack>
                      </VStack>
                      <DelegationSection value={form.delegation} onChange={(delegation) => set({ delegation })} selfId={agentId} />
                    </>
                  )}
                </VStack>
              )}
              </VStack>
            </div>
          </section>
        </div>
      )}

      <div {...stylex.props(ui.footer)}>
        <div {...stylex.props(ui.checks)}>
          {error !== null ? (
            <HStack gap={1} vAlign="center" role="alert">
              <Icon icon={ExclamationCircleIcon} size="sm" color="error" />
              <Text>{error}</Text>
            </HStack>
          ) : (
            <HStack gap={4} wrap="wrap" role="list" aria-label="Before you save">
              {checks.map((c) => (
                <HStack key={c.label} gap={1} vAlign="center" role="listitem">
                  <Icon icon={c.ok ? CheckCircleIcon : ExclamationCircleIcon} size="sm" color={c.ok ? 'success' : c.required ? 'error' : 'secondary'} />
                  <Text type="supporting" color={c.ok ? 'secondary' : 'primary'}>
                    {c.ok ? c.label : c.label === 'Tools' ? 'Choose at least one tool' : c.required ? `${c.label} needed` : `Add ${c.label.toLowerCase()}`}
                  </Text>
                </HStack>
              ))}
            </HStack>
          )}
        </div>
        {agentId && <Button label="Delete" variant="ghost" onClick={() => setConfirmDelete(true)} />}
        <Button label="Cancel" variant="ghost" onClick={close} />
        <Button label={saved ? 'Saved' : agentId ? 'Save changes' : 'Create agent'} variant="primary" isLoading={saving} isDisabled={!form} onClick={() => void save()} />
      </div>

      <AlertDialog
        isOpen={confirmDelete}
        onOpenChange={(open) => !open && setConfirmDelete(false)}
        title="Delete agent?"
        description="The agent is deleted for good. Chats already started with it keep working."
        actionLabel="Delete"
        onAction={() => void remove()}
        cancelLabel="Cancel"
      />
    </div>
  )
}
