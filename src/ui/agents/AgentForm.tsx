'use client'

/** Create or edit one saved agent. `agentId` absent means a new agent (optionally from `?starter=`). */
import { AlertDialog } from '@astryxdesign/core/AlertDialog'
import { Banner } from '@astryxdesign/core/Banner'
import { Button } from '@astryxdesign/core/Button'
import { CheckboxList, CheckboxListItem } from '@astryxdesign/core/CheckboxList'
import { Heading } from '@astryxdesign/core/Heading'
import { HStack } from '@astryxdesign/core/HStack'
import { StackItem } from '@astryxdesign/core/Layout'
import { Link } from '@astryxdesign/core/Link'
import { Selector } from '@astryxdesign/core/Selector'
import { Skeleton } from '@astryxdesign/core/Skeleton'
import { Switch } from '@astryxdesign/core/Switch'
import { Text } from '@astryxdesign/core/Text'
import { TextArea } from '@astryxdesign/core/TextArea'
import { TextInput } from '@astryxdesign/core/TextInput'
import { ToggleButton } from '@astryxdesign/core/ToggleButton'
import { VStack } from '@astryxdesign/core/VStack'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { api, ApiError, isSignedOut } from '@/api/client'
import type { HostToolInfo } from '@/api/types'
import { agentToForm, emptyForm, formToParams, MAX_SUBAGENTS, toolMask, type AgentForm as FormState, type EffortChoice } from '@/agents/form'
import { STARTERS } from '@/agents/starters'
import { goToLogin } from '@/chat/use-conversation'

const COLUMN_WIDTH = 720
const EFFORTS: { value: EffortChoice; label: string }[] = [
  { value: 'auto', label: 'Auto' }, { value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' },
]

async function connectedApps(): Promise<string[] | null> {
  try {
    const res = await fetch('/api/agentry/connectors/status', { credentials: 'same-origin' })
    return res.ok ? (((await res.json()) as { connected?: string[] | null }).connected ?? null) : null
  } catch {
    return null
  }
}

export function AgentForm({ agentId }: { agentId?: string }) {
  const router = useRouter()
  const starterId = useSearchParams().get('starter')
  const [form, setForm] = useState<FormState | null>(null)
  const [tools, setTools] = useState<HostToolInfo[]>([])
  const [apps, setApps] = useState<string[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [missing, setMissing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [models, setModels] = useState<string[]>([])

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const [modelList, toolList, connected] = await Promise.all([api.models(), api.listHostTools().catch(() => []), connectedApps()])
        const defaultModel = modelList[0] ?? ''
        const base = agentId ? agentToForm(await api.getAgent(agentId), defaultModel) : emptyForm(defaultModel)
        if (!alive) return
        const starter = !agentId ? STARTERS.find((s) => s.id === starterId) : undefined
        if (starter) {
          const names = toolMask(starter.tools, toolList.map((t) => t.name))
          Object.assign(base, { name: starter.name, instructions: starter.instructions, subagents: starter.subagents ?? false, allTools: names === null, tools: names ?? [] })
        }
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
  }, [agentId, starterId])

  const set = (patch: Partial<FormState>) => {
    setSaved(false)
    setForm((cur) => (cur ? { ...cur, ...patch } : cur))
  }

  async function save() {
    if (!form) return
    if (!form.name.trim()) return setError('Give the agent a name.')
    if (!form.model) return setError('Choose a model.')
    setSaving(true)
    setError(null)
    try {
      const params = formToParams(form, tools.map((t) => t.name))
      if (agentId) {
        await api.updateAgent(agentId, params)
        setSaved(true)
      } else {
        await api.createAgent(params)
        router.push('/agents')
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
      router.push('/agents')
    } catch (err) {
      setConfirmDelete(false)
      setError(err instanceof ApiError ? err.message : 'Could not delete the agent.')
    }
  }

  if (missing)
    return (
      <div style={{ maxWidth: COLUMN_WIDTH, margin: '0 auto', padding: '24px 16px' }}>
        <VStack gap={3}>
          <Banner status="warning" title="This agent no longer exists." />
          <Link href="/agents">Back to agents</Link>
        </VStack>
      </div>
    )

  const appChoices = form ? [...new Set([...(apps ?? []), ...form.connectors])] : []
  const toolNames = tools.map((t) => t.name)
  return (
    <div style={{ width: '100%', maxWidth: COLUMN_WIDTH, margin: '0 auto', padding: '24px 16px' }}>
      <VStack gap={5}>
        <HStack gap={3} vAlign="center">
          <StackItem size="fill">
            <Heading level={1} type="display-2">{agentId ? 'Edit agent' : 'New agent'}</Heading>
          </StackItem>
          {agentId && <Button label="Delete" variant="ghost" onClick={() => setConfirmDelete(true)} />}
          <Button label="Cancel" variant="ghost" onClick={() => router.push('/agents')} />
          <Button label={saved ? 'Saved' : 'Save'} variant="primary" isLoading={saving} isDisabled={!form} onClick={() => void save()} />
        </HStack>
        {error !== null && <Banner status="error" title={error} isDismissable onDismiss={() => setError(null)} />}
        {!form ? (
          <Skeleton height={240} />
        ) : (
          <VStack gap={5}>
            <TextInput label="Name" value={form.name} onChange={(name) => set({ name })} isRequired />
            <HStack gap={3}>
              <StackItem size="fill">
                <Selector label="Model" options={models.length > 0 ? models : [form.model]} value={form.model} onChange={(model) => set({ model })} />
              </StackItem>
              <StackItem size="fill">
                <Selector label="Reasoning effort" options={EFFORTS} value={form.effort} onChange={(v) => set({ effort: v as EffortChoice })} />
              </StackItem>
            </HStack>
            <TextArea label="Instructions" description="What this agent is for and how it should work. This is its system prompt." rows={10} value={form.instructions} onChange={(instructions) => set({ instructions })} />

            <VStack gap={2}>
              <Text weight="medium">Tools</Text>
              <Switch label="Allow every tool" description="Turn off to choose which tools this agent can use." value={form.allTools} onChange={(allTools) => set({ allTools, ...(allTools ? {} : { tools: form.tools.length > 0 ? form.tools : toolNames }) })} />
              {!form.allTools &&
                (toolNames.length === 0 ? (
                  <Text type="supporting" color="secondary">The tool list is unavailable right now.</Text>
                ) : (
                  <CheckboxList label="Allowed tools" isLabelHidden density="compact" value={form.tools} onChange={(tools) => set({ tools })}>
                    {tools.map((t) => (
                      <CheckboxListItem key={t.name} value={t.name} label={t.name} description={t.description} />
                    ))}
                  </CheckboxList>
                ))}
            </VStack>

            <VStack gap={2}>
              <Text weight="medium">Apps</Text>
              {apps === null && appChoices.length === 0 ? (
                <Text type="supporting" color="secondary">Connect apps on the <Link href="/settings/connectors">Connectors page</Link> to choose which this agent should use.</Text>
              ) : (
                <>
                  <Text type="supporting" color="secondary">The agent is told to use only these apps. Leave all unchecked for no preference.</Text>
                  <CheckboxList label="Preferred apps" isLabelHidden density="compact" value={form.connectors} onChange={(connectors) => set({ connectors })}>
                    {appChoices.map((slug) => (
                      <CheckboxListItem key={slug} value={slug} label={slug} />
                    ))}
                  </CheckboxList>
                </>
              )}
            </VStack>

            <VStack gap={2}>
              <Text weight="medium">Subagents</Text>
              <Switch label="Let this agent delegate to subagents" value={form.subagents} onChange={(subagents) => set({ subagents })} />
              {form.subagents && (
                <HStack gap={1} vAlign="center" role="group" aria-label="Most subagents at once">
                  <Text type="supporting" color="secondary">Most at once</Text>
                  {Array.from({ length: MAX_SUBAGENTS }, (_, i) => i + 1).map((n) => (
                    <ToggleButton key={n} label={String(n)} size="sm" isPressed={form.maxSubagents === n} onPressedChange={() => set({ maxSubagents: n })} />
                  ))}
                </HStack>
              )}
            </VStack>
          </VStack>
        )}
      </VStack>
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
