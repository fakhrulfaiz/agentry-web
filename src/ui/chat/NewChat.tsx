'use client'

/**
 * The empty state at `/`: a large composer with the model picker. The first
 * send creates the session (its title comes from the message) and opens it.
 */
import { Center } from '@astryxdesign/core/Center'
import { VStack } from '@astryxdesign/core/VStack'
import * as stylex from '@stylexjs/stylex'
import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, ApiError, isSignedOut } from '@/api/client'
import type { OAIAgent } from '@/api/types'
import { seedText } from '@/artifacts/seed'
import { chooseEffort, chooseModel, type AppCommandHandlers } from '@/commands/app-commands'
import { scheduleSeedText } from '@/schedule/seed'
import { useSkillCommands } from '@/skills/skills-store'
import { setPendingFirst } from '@/chat/pending-first'
import { goToLogin } from '@/chat/use-conversation'
import { Wordmark } from '@/ui/brand/Wordmark'
import { ErrorBanner, isUnavailable } from '@/ui/errors/ErrorBanner'
import { SESSIONS_CHANGED } from '@/ui/shell/session-actions'
import { TopBar } from '@/ui/shell/TopBar'
import type { UserFile } from '@/chat/attachments'
import { Message } from './Message'
import { Thinking } from './Thinking'
import { Composer, type EffortChoice } from './Composer'
import { pickModel, readModelCookie } from './model-cookie'

const styles = stylex.create({ page: { blockSize: '100%', minBlockSize: 0 } })

type Failure = { message: string; unavailable: boolean; retry: () => void }

export function NewChat() {
  const router = useRouter()
  const params = useSearchParams()
  // `?seed=docs|slides|data` (Artifacts tiles) and `?schedule=1` (Scheduled page) prefill the composer once.
  const seed = params.get('seed')
  const schedule = params.get('schedule')
  const [initialValue] = useState(() => seedText(seed) ?? (schedule === '1' ? scheduleSeedText() : ''))
  useEffect(() => {
    if (seed !== null || schedule !== null) router.replace('/')
  }, [seed, schedule, router])
  const commands = useSkillCommands()
  const [models, setModels] = useState<string[] | null>(null)
  const [model, setModel] = useState('')
  const [effort, setEffort] = useState<EffortChoice>('auto')
  // Saved agents for the agent menu; '' is the default agent. A failed load just hides the menu.
  const [agents, setAgents] = useState<OAIAgent[]>([])
  const [agentId, setAgentId] = useState('')
  const [failure, setFailure] = useState<Failure | null>(null)
  // The message being sent, shown with a thinking state until the session exists and the chat opens.
  const [pending, setPending] = useState<{ text: string; files?: UserFile[] } | null>(null)

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
  useEffect(() => {
    // A failed or unavailable list just leaves the agent menu hidden.
    Promise.resolve()
      .then(() => api.listAgents())
      .then((list) => setAgents(list.data), () => undefined)
  }, [])

  async function start(text: string, files?: UserFile[]) {
    setPending({ text, ...(files?.length ? { files } : {}) })
    try {
      const session = await api.createSession({ text, model, files, ...(effort === 'auto' ? {} : { effort }), ...(agentId ? { agentId } : {}) })
      setPendingFirst(session.id, { text, ...(files?.length ? { files } : {}) })
      window.dispatchEvent(new Event(SESSIONS_CHANGED))
      router.push(`/c/${encodeURIComponent(session.id)}`)
    } catch (error) {
      setPending(null)
      if (isSignedOut(error)) goToLogin()
      else setFailure({ message: error instanceof ApiError ? error.message : 'Could not start the chat.', unavailable: isUnavailable(error), retry: () => setFailure(null) })
      throw error
    }
  }

  const appHandlers = useMemo<AppCommandHandlers>(
    () => ({
      new: (arg) => (arg ? start(arg) : undefined),
      clear: () => undefined,
      model: (arg, { openMenu }) => {
        if (!arg) return openMenu('model') ? undefined : `Model: ${model}`
        setModel(chooseModel(arg, models))
        return `Model set to ${arg}.`
      },
      effort: (arg, { openMenu }) => {
        if (!arg) return openMenu('effort') ? undefined : `Reasoning effort: ${effort}`
        const chosen = chooseEffort(arg, undefined)
        setEffort(chosen)
        return `Reasoning effort set to ${chosen}.`
      },
    }),
    // `start` reads the model and effort chosen at call time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [model, models, effort],
  )
  const noModels = models !== null && models.length === 0 && !failure
  return (
    <VStack xstyle={styles.page}>
      <TopBar />
      {failure?.unavailable && <ErrorBanner message={failure.message} onRetry={failure.retry} />}
      <Center axis="both" padding={6} paddingBlockStart={10} minHeight="85%">
        <VStack gap={6} width="100%" maxWidth={760} hAlign="stretch">
          {pending ? (
            <>
              <Message view={{ kind: 'user', id: 'pending', text: pending.text, ...(pending.files ? { files: pending.files } : {}) }} answer={async () => undefined} />
              <Thinking label="Agentry is thinking…" />
            </>
          ) : (
            <Center>
              <Wordmark size="lg" />
            </Center>
          )}
          <Composer
            onSend={start}
            autoFocus
            isDisabled={!model}
            commands={commands}
            appHandlers={appHandlers}
            density="spacious"
            initialValue={initialValue}
            placeholder="How can Agentry help today?"
            status={
              failure && !failure.unavailable
                ? { type: 'error', message: failure.message }
                : noModels
                  ? { type: 'warning', message: 'No models are configured.' }
                  : undefined
            }
            settings={{ models, model, onModelChange: setModel, effort, onEffortChange: setEffort, agents: agents.map((a) => ({ id: a.id, name: a.name ?? '' })), agentId, onAgentChange: setAgentId }}
          />
        </VStack>
      </Center>
    </VStack>
  )
}
