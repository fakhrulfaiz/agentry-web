'use client'

/**
 * The agent form's Apps section: every connected app (the default), or a
 * per-app choice of all tools, chosen tools, or off; plus whether writes on
 * the user's behalf ask first. Agentry enforces these on every app call.
 */
import { HStack } from '@astryxdesign/core/HStack'
import { StackItem } from '@astryxdesign/core/Layout'
import { Link } from '@astryxdesign/core/Link'
import { Switch } from '@astryxdesign/core/Switch'
import { Text } from '@astryxdesign/core/Text'
import { TextInput } from '@astryxdesign/core/TextInput'
import { ToggleButton } from '@astryxdesign/core/ToggleButton'
import { VStack } from '@astryxdesign/core/VStack'
import { useState } from 'react'
import type { AgentAppGrants } from '@/api/types'

type Mode = 'all' | 'choose' | 'off'
const MODES: { mode: Mode; label: string }[] = [{ mode: 'all', label: 'All tools' }, { mode: 'choose', label: 'Choose tools' }, { mode: 'off', label: 'Off' }]

/** Tool slugs typed as a comma list. */
export const parseSlugs = (text: string): string[] => [...new Set(text.split(/[\s,]+/u).map((s) => s.trim().toUpperCase()).filter(Boolean))]

export function AppsSection({ connected, value, onChange, sendPolicy, onSendPolicy }: {
  /** Connected app slugs; `null` when the status is unknown. */
  connected: string[] | null
  value: AgentAppGrants | null
  onChange(next: AgentAppGrants | null): void
  sendPolicy: 'ask' | 'auto'
  onSendPolicy(next: 'ask' | 'auto'): void
}) {
  const apps = [...new Set([...(connected ?? []), ...Object.keys(value ?? {})])]
  const [drafts, setDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(value ?? {}).flatMap(([slug, grant]) => (Array.isArray(grant) ? [[slug, grant.join(', ')]] : []))),
  )
  const modeOf = (slug: string): Mode => {
    const grant = value?.[slug]
    return grant === undefined ? 'off' : grant === 'all' ? 'all' : 'choose'
  }
  const setMode = (slug: string, mode: Mode) => {
    const next = { ...value }
    if (mode === 'off') delete next[slug]
    else next[slug] = mode === 'all' ? 'all' : parseSlugs(drafts[slug] ?? '')
    onChange(next)
  }
  const setTools = (slug: string, text: string) => {
    setDrafts((d) => ({ ...d, [slug]: text }))
    onChange({ ...value, [slug]: parseSlugs(text) })
  }

  return (
    <VStack gap={2}>
      <Text weight="medium">Apps</Text>
      {apps.length === 0 ? (
        <Text type="supporting" color="secondary">Connect apps on the <Link href="/plugins?tab=connectors">Plugins page</Link> to choose which this agent may use.</Text>
      ) : (
        <>
          <Switch
            label="Limit this agent to specific apps"
            description="Off: the agent may use every app you connect."
            value={value !== null}
            onChange={(limit) => onChange(limit ? Object.fromEntries(apps.map((slug) => [slug, 'all' as const])) : null)}
          />
          {value !== null && apps.map((slug) => (
            <VStack key={slug} gap={1}>
              <HStack gap={2} vAlign="center">
                <StackItem size="fill"><Text>{slug}</Text></StackItem>
                <HStack gap={1} role="group" aria-label={`${slug} access`}>
                  {MODES.map(({ mode, label }) => (
                    <ToggleButton key={mode} label={label} size="sm" isPressed={modeOf(slug) === mode} onPressedChange={() => setMode(slug, mode)} />
                  ))}
                </HStack>
              </HStack>
              {modeOf(slug) === 'choose' && (
                <TextInput label={`${slug} tools`} description="Tool names, comma separated, such as GMAIL_FETCH_EMAILS." value={drafts[slug] ?? ''} onChange={(text) => setTools(slug, text)} />
              )}
            </VStack>
          ))}
        </>
      )}
      <HStack gap={2} vAlign="center" role="group" aria-label="Sending on your behalf">
        <StackItem size="fill"><Text type="supporting" color="secondary">Sending on your behalf</Text></StackItem>
        <ToggleButton label="Ask every time" size="sm" isPressed={sendPolicy === 'ask'} onPressedChange={() => onSendPolicy('ask')} />
        <ToggleButton label="Send without asking" size="sm" isPressed={sendPolicy === 'auto'} onPressedChange={() => onSendPolicy('auto')} />
      </HStack>
    </VStack>
  )
}
