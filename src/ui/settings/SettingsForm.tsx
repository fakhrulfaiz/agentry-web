'use client'

/**
 * Settings: profile (from the BFF's identity), theme (light / dark / system,
 * stored in the `agentry_theme` cookie) and the default model for new chats
 * (the `agentry_model` cookie). The apikey-mode API key list stays hidden until
 * Agentry exposes key management (spec §9).
 */
import { Card } from '@astryxdesign/core/Card'
import { Heading } from '@astryxdesign/core/Heading'
import { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList'
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl'
import { Selector } from '@astryxdesign/core/Selector'
import { Switch } from '@astryxdesign/core/Switch'
import { Text } from '@astryxdesign/core/Text'
import { VStack } from '@astryxdesign/core/VStack'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { api, ApiError, isSignedOut } from '@/api/client'
import { goToLogin } from '@/chat/use-conversation'
import { pickModel, writeModelCookie } from '@/ui/chat/model-cookie'
import { readShowSteps, writeShowSteps } from '@/chat/show-steps'
import type { ShellIdentity } from '@/ui/shell/UserMenu'
import { parseThemeMode, writeThemeCookie, type ThemeMode } from '@/ui/theme/theme-cookie'

export function SettingsForm({
  identity,
  theme: initialTheme,
  model: savedModel,
}: {
  identity: ShellIdentity
  theme: ThemeMode
  model: string | null
}) {
  const router = useRouter()
  const [theme, setTheme] = useState<ThemeMode>(initialTheme)
  const [models, setModels] = useState<string[] | null>(null)
  const [model, setModel] = useState(savedModel ?? '')
  const [modelError, setModelError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [showSteps, setShowSteps] = useState(false)
  useEffect(() => setShowSteps(readShowSteps()), [])

  useEffect(() => {
    api.models().then(
      (list) => {
        setModels(list)
        setModel(pickModel(list, savedModel))
      },
      (error: unknown) => {
        if (isSignedOut(error)) return goToLogin()
        setModels([])
        setModelError(error instanceof ApiError ? error.message : 'Could not load models.')
      },
    )
  }, [savedModel])

  function changeTheme(value: string) {
    const mode = parseThemeMode(value)
    setTheme(mode)
    writeThemeCookie(mode)
    router.refresh()
  }

  function changeModel(value: string) {
    setModel(value)
    writeModelCookie(value)
    setSaved(true)
  }

  return (
    <VStack gap={6} padding={4} width="100%" maxWidth={720}>
      <Card padding={5}>
        <VStack gap={3}>
          <Heading level={2}>Profile</Heading>
          <MetadataList>
            <MetadataListItem label="Name">{identity.displayName}</MetadataListItem>
            {identity.owner && <MetadataListItem label="Owner">{identity.owner}</MetadataListItem>}
            <MetadataListItem label="Roles">{identity.roles.length > 0 ? identity.roles.join(', ') : 'None'}</MetadataListItem>
          </MetadataList>
        </VStack>
      </Card>
      <Card padding={5}>
        <VStack gap={3}>
          <Heading level={2}>Appearance</Heading>
          <SegmentedControl label="Theme" value={theme} onChange={changeTheme}>
            <SegmentedControlItem value="system" label="System" />
            <SegmentedControlItem value="light" label="Light" />
            <SegmentedControlItem value="dark" label="Dark" />
          </SegmentedControl>
        </VStack>
      </Card>
      <Card padding={5}>
        <VStack gap={3}>
          <Heading level={2}>Chat</Heading>
          <Switch
            label="Always show steps"
            description="Show every command, edit and subagent of a finished reply. When off, they fold into one summary line you can open."
            value={showSteps}
            onChange={(on) => {
              setShowSteps(on)
              writeShowSteps(on)
            }}
          />
        </VStack>
      </Card>
      <Card padding={5}>
        <VStack gap={3}>
          <Heading level={2}>Default model</Heading>
          <Selector
            label="Default model for new chats"
            options={models ?? []}
            value={model}
            onChange={changeModel}
            isLoading={models === null}
            isDisabled={models !== null && models.length === 0}
            status={modelError ? { type: 'error', message: modelError } : undefined}
            width="100%"
          />
          {saved && (
            <Text type="supporting" role="status">
              New chats will use {model}.
            </Text>
          )}
        </VStack>
      </Card>
    </VStack>
  )
}
