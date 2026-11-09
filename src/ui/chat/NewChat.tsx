'use client'

/**
 * The empty state at `/`: a large composer with the model picker. The first
 * send creates the session (its title comes from the message) and opens it.
 */
import { Center } from '@astryxdesign/core/Center'
import { Selector } from '@astryxdesign/core/Selector'
import { VStack } from '@astryxdesign/core/VStack'
import * as stylex from '@stylexjs/stylex'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { api, ApiError, isSignedOut } from '@/api/client'
import { goToLogin } from '@/chat/use-conversation'
import { Wordmark } from '@/ui/brand/Wordmark'
import { ErrorBanner, isUnavailable } from '@/ui/errors/ErrorBanner'
import { SESSIONS_CHANGED } from '@/ui/shell/Sidebar'
import { TopBar } from '@/ui/shell/TopBar'
import { Composer } from './Composer'
import { pickModel, readModelCookie } from './model-cookie'

const styles = stylex.create({ page: { blockSize: '100%', minBlockSize: 0 } })

type Failure = { message: string; unavailable: boolean; retry: () => void }

export function NewChat() {
  const router = useRouter()
  const [models, setModels] = useState<string[] | null>(null)
  const [model, setModel] = useState('')
  const [failure, setFailure] = useState<Failure | null>(null)

  const loadModels = useCallback(async () => {
    try {
      const list = await api.models()
      setModels(list)
      setModel((current) => (current && list.includes(current) ? current : pickModel(list, readModelCookie())))
      setFailure(null)
    } catch (error) {
      if (isSignedOut(error)) return goToLogin()
      setModels([])
      setFailure({ message: error instanceof ApiError ? error.message : 'Could not load models.', unavailable: isUnavailable(error), retry: () => void loadModels() })
    }
  }, [])
  useEffect(() => {
    void loadModels()
  }, [loadModels])

  async function start(text: string) {
    try {
      const session = await api.createSession({ text, model })
      window.dispatchEvent(new Event(SESSIONS_CHANGED))
      router.push(`/c/${encodeURIComponent(session.id)}`)
    } catch (error) {
      if (isSignedOut(error)) goToLogin()
      else setFailure({ message: error instanceof ApiError ? error.message : 'Could not start the chat.', unavailable: isUnavailable(error), retry: () => setFailure(null) })
      throw error
    }
  }

  const noModels = models !== null && models.length === 0 && !failure
  return (
    <VStack xstyle={styles.page}>
      <TopBar title="New chat" />
      {failure?.unavailable && <ErrorBanner message={failure.message} onRetry={failure.retry} />}
      <Center axis="both" padding={6} minHeight="70%">
        <VStack gap={6} width="100%" maxWidth={760} hAlign="stretch">
          <Center>
            <Wordmark size="lg" />
          </Center>
          <Composer
            onSend={start}
            autoFocus
            isDisabled={!model}
            placeholder="How can Agentry help today?"
            status={
              failure && !failure.unavailable
                ? { type: 'error', message: failure.message }
                : noModels
                  ? { type: 'warning', message: 'No models are configured.' }
                  : undefined
            }
            footer={
              <Selector
                label="Model"
                isLabelHidden
                size="sm"
                variant="ghost"
                options={models ?? []}
                value={model}
                onChange={setModel}
                isLoading={models === null}
                placeholder="Model"
              />
            }
          />
        </VStack>
      </Center>
    </VStack>
  )
}
