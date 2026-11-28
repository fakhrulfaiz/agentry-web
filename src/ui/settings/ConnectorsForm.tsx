'use client'

/**
 * Connectors settings: key section. Without a saved key it explains what the key unlocks;
 * with one it shows a compact Saved row (`ck_…1234`) with Replace and Remove icons. The key lives
 * in the Agentry API; the BFF only ever returns its last four characters. After a save or removal
 * the page refreshes so the server decides whether to show the directory.
 */
import { Button } from '@astryxdesign/core/Button'
import { Icon } from '@astryxdesign/core/Icon'
import { IconButton } from '@astryxdesign/core/IconButton'
import { ArrowPathIcon, TrashIcon } from '@heroicons/react/24/outline'
import { Card } from '@astryxdesign/core/Card'
import { Heading } from '@astryxdesign/core/Heading'
import { HStack } from '@astryxdesign/core/HStack'
import { Text } from '@astryxdesign/core/Text'
import { TextInput } from '@astryxdesign/core/TextInput'
import { VStack } from '@astryxdesign/core/VStack'
import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import { goToLogin } from '@/chat/use-conversation'
import { ApiError, isSignedOut, request } from '@/api/client'

const KEY_URL = '/api/agentry/connectors/key'

/** Shown when the API has no `AGENTRY_SECRETS_KEY` (501 `secrets_disabled`). */
export const SECRETS_DISABLED_MESSAGE = 'This server cannot store connector keys. Ask the administrator to set AGENTRY_SECRETS_KEY.'

export function ConnectorsForm({ configured, last4, disabled = false }: { configured: boolean; last4?: string | null; disabled?: boolean }) {
  const router = useRouter()
  const [replacing, setReplacing] = useState(false)
  const [key, setKey] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  function fail(e: unknown) {
    if (isSignedOut(e)) return goToLogin()
    if (e instanceof ApiError && e.code === 'invalid_key') setError('Enter a valid connector key (it starts with ck_).')
    else if (e instanceof ApiError && e.code === 'secrets_disabled') setError(SECRETS_DISABLED_MESSAGE)
    else setError('Could not update the connector key. Try again.')
  }

  async function change(run: () => Promise<unknown>) {
    if (pending) return
    setPending(true)
    setError(null)
    try {
      await run()
      setKey('')
      setReplacing(false)
      router.refresh()
    } catch (e) {
      fail(e)
    }
    setPending(false)
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void change(() => request('PUT', KEY_URL, { key }))
  }

  const showField = (!configured || replacing) && !disabled

  if (disabled) {
    return (
      <Card padding={4}>
        <Text type="supporting" role="status">{SECRETS_DISABLED_MESSAGE}</Text>
      </Card>
    )
  }

  return (
    <Card padding={configured ? 4 : 5}>
      <form onSubmit={save} noValidate>
        <VStack gap={3}>
          {configured ? (
            <HStack gap={3} vAlign="center" hAlign="between">
              <HStack gap={2} vAlign="center">
                <Text weight="medium">Connector key</Text>
                <Text type="supporting" role="status">
                  {last4 ? `Saved · ck_…${last4}` : 'Saved'}
                </Text>
              </HStack>
              {!replacing && (
                <HStack gap={1}>
                  <IconButton label="Replace" tooltip="Replace the key" variant="ghost" size="sm" icon={<Icon icon={ArrowPathIcon} size="sm" />} onClick={() => setReplacing(true)} isDisabled={pending} />
                  <IconButton label="Remove" tooltip="Remove the key" variant="ghost" size="sm" icon={<Icon icon={TrashIcon} size="sm" />} onClick={() => void change(() => request('DELETE', KEY_URL))} isDisabled={pending} />
                </HStack>
              )}
            </HStack>
          ) : (
            <>
              <Heading level={2}>Your connector key</Heading>
              <Text type="supporting">Add your connector key to browse and connect apps.</Text>
            </>
          )}
          {showField && (
            <>
              <TextInput
                label="Connector key"
                type="password"
                htmlName="connector-key"
                value={key}
                onChange={(value) => {
                  setKey(value)
                  setError(null)
                }}
                status={error ? { type: 'error', message: error } : undefined}
              />
              <Text type="supporting">Your key lets chats use your connected apps. It is stored encrypted and never shown again. A new key applies to chats you start after saving it.</Text>
              <HStack gap={2}>
                <Button type="submit" variant="primary" label="Save" isLoading={pending} isDisabled={!key.trim()} />
                {replacing && <Button variant="secondary" label="Cancel" onClick={() => { setReplacing(false); setKey(''); setError(null) }} isDisabled={pending} />}
              </HStack>
            </>
          )}
          {!showField && error && <Text type="supporting" role="alert">{error}</Text>}
        </VStack>
      </form>
    </Card>
  )
}
