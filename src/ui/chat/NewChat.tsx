'use client'

/**
 * The empty state at `/`: a large composer with the model picker. The first
 * send creates the session (its title comes from the message) and opens it.
 */
import { Center } from '@astryxdesign/core/Center'
import { VStack } from '@astryxdesign/core/VStack'
import { Text } from '@astryxdesign/core/Text'
import { ChatLayout, ChatMessageList } from '@astryxdesign/core/Chat'
import * as stylex from '@stylexjs/stylex'
import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, ApiError, isSignedOut } from '@/api/client'
import type { OAIAgent, SandboxEnvironment, SandboxProvider, SandboxTemplate } from '@/api/types'
import { seedText } from '@/artifacts/seed'
import { chooseEffort, chooseModel, type AppCommandHandlers } from '@/commands/app-commands'
import { promptText } from '@/connectors/catalog'
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
import { RecentFiles } from './RecentFiles'
import { Thinking } from './Thinking'
import { Composer, ContextMenus, type ComposerSettings, type EffortChoice } from './Composer'
import { canChatIn, environmentMenuLabel, NEW_SANDBOX, templateSummary } from '@/ui/sandboxes/format'
import { pickModel, readModelCookie } from './model-cookie'

const styles = stylex.create({
  page: { blockSize: '100%', minBlockSize: 0 },
  chat: { flexGrow: 1, minBlockSize: 0 },
})

type Failure = { message: string; unavailable: boolean; retry: () => void }

export function NewChat() {
  const router = useRouter()
  const params = useSearchParams()
  // `?seed=docs|slides|data` (Artifacts tiles) and `?schedule=1` (Scheduled page) prefill the composer once.
  const seed = params.get('seed')
  const schedule = params.get('schedule')
  // `?prompt=` (Connectors page Connect) prefills sanitized, length-limited text; the user still presses send.
  const prompt = params.get('prompt')
  // `?environment=` (an environment's "New chat here") preselects it in the environment menu.
  const [wantedEnvironment] = useState(() => params.get('environment'))
  // `?project=` (a Project's "New chat here") files the chat under the Project and inherits its defaults.
  const [wantedProject] = useState(() => params.get('project'))
  const [initialValue] = useState(() => seedText(seed) ?? (schedule === '1' ? scheduleSeedText() : promptText(prompt)))
  useEffect(() => {
    if (seed !== null || schedule !== null || prompt !== null || wantedEnvironment !== null || wantedProject !== null) router.replace('/')
  }, [seed, schedule, prompt, wantedEnvironment, wantedProject, router])
  const commands = useSkillCommands()
  const [models, setModels] = useState<string[] | null>(null)
  const [model, setModel] = useState('')
  const [effort, setEffort] = useState<EffortChoice>('auto')
  // Saved agents for the agent menu; '' is the default agent. A failed load just hides the menu.
  const [agents, setAgents] = useState<OAIAgent[]>([])
  const [agentId, setAgentId] = useState('')
  // Ready sandbox environments for the environment menu; '' is the default workspace. A failed load hides the menu.
  const [environments, setEnvironments] = useState<{ id: string; name: string; group?: 'new'; description?: string }[]>([])
  const [environmentId, setEnvironmentId] = useState('')
  // A Project preset stays with this chat even when its agent/environment are overridden before the first send.
  const [projectId, setProjectId] = useState('')
  // The Project's starting folder applies only to the Project's own environment, not to an override.
  const [projectFolder, setProjectFolder] = useState<{ environmentId: string; directory: string } | null>(null)
  const directory = projectFolder && projectFolder.environmentId === environmentId ? projectFolder.directory : ''
  // The Project's saved agent model is applied once models load, so the cookie default cannot win the race.
  const [presetModel, setPresetModel] = useState<string | null>(null)
  const [failure, setFailure] = useState<Failure | null>(null)
  // The message being sent, shown with a thinking state until the session exists and the chat opens.
  const [pending, setPending] = useState<{ text: string; files?: UserFile[] } | null>(null)
  // A failed first send gives its text back: the composer remounts in the start layout with it.
  const [restore, setRestore] = useState<{ text: string; n: number } | null>(null)

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
    // The saved agent's model wins over the cookie default, but only when the model list offers it.
    if (presetModel && models?.includes(presetModel)) setModel(presetModel)
  }, [models, presetModel])
  useEffect(() => {
    // A failed list just hides its menu; a missing, foreign or archived Project is ignored.
    Promise.resolve()
      .then(() => Promise.all([
        api.listAgents().catch(() => null),
        Promise.all([
          api.listSandboxEnvironments(),
          // Fresh sandboxes are offered only while the isolated sandbox is up; either list failing just offers less.
          Promise.resolve().then(() => api.listSandboxProviders()).catch(() => ({ data: [] as SandboxProvider[] })),
          Promise.resolve().then(() => api.listSandboxTemplates()).catch(() => ({ data: [] as SandboxTemplate[] })),
        ]).catch(() => null),
        wantedProject ? api.getProject(wantedProject).catch(() => null) : Promise.resolve(null),
      ]))
      .then(([agentList, envData, project]) => {
        if (agentList) setAgents(agentList.data)
        let usable: SandboxEnvironment[] = []
        if (envData) {
          const [list, providers, templates] = envData
          // Running and stopped sandboxes (a stopped one starts on send) and ready local environments.
          usable = list.data.filter(canChatIn)
          const sandboxUp = providers.data.some((p) => p.name === 'sandbox' && p.available !== false && p.capabilities.exec)
          const fresh = sandboxUp
            ? [
                { id: NEW_SANDBOX, name: 'Empty sandbox', group: 'new' as const, description: 'Standard image; deleted with the chat.' },
                ...templates.data
                  .filter((t) => t.provider === 'sandbox' && t.unsupported_fields.length === 0)
                  .map((t) => ({ id: `${NEW_SANDBOX}${t.id}`, name: t.name || 'Untitled template', group: 'new' as const, description: `${templateSummary(t)}; deleted with the chat.` })),
              ]
            : []
          setEnvironments([...usable.map((e) => ({ id: e.id, name: environmentMenuLabel(e) })), ...fresh])
          if (wantedEnvironment && usable.some((e) => e.id === wantedEnvironment)) setEnvironmentId(wantedEnvironment)
        }
        if (project && project.status === 'active') {
          setProjectId(project.id)
          if (project.agent_id) setAgentId(project.agent_id)
          const saved = agentList?.data.find((a) => a.id === project.agent_id)
          if (saved) {
            setPresetModel(saved.model)
            const effort = saved.reasoning?.effort
            if (effort === 'low' || effort === 'medium' || effort === 'high') setEffort(effort)
          }
          const environment = (project.environment as { environment_id?: unknown } | null | undefined)?.environment_id
          if (typeof environment === 'string' && usable.some((e) => e.id === environment)) {
            setEnvironmentId(environment)
            const folder = project.environment?.directory
            if (typeof folder === 'string' && folder) setProjectFolder({ environmentId: environment, directory: folder })
          }
        }
      })
  }, [wantedEnvironment, wantedProject])

  async function start(text: string, files?: UserFile[]) {
    setPending({ text, ...(files?.length ? { files } : {}) })
    try {
      const session = await api.createSession({ text, model, files, ...(effort === 'auto' ? {} : { effort }), ...(agentId ? { agentId } : {}), ...(environmentId ? { environmentId } : {}), ...(directory ? { directory } : {}), ...(projectId ? { projectId } : {}) })
      setPendingFirst(session.id, {
        text,
        ...(files?.length ? { files } : {}),
        startLabel: environmentId?.startsWith(NEW_SANDBOX) ? 'Starting a sandbox…' : 'Starting the chat…',
      })
      window.dispatchEvent(new Event(SESSIONS_CHANGED))
      router.push(`/c/${encodeURIComponent(session.id)}`)
    } catch (error) {
      setPending(null)
      setRestore((r) => ({ text, n: (r?.n ?? 0) + 1 }))
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
  const settings: ComposerSettings = { models, model, onModelChange: setModel, effort, onEffortChange: setEffort, agents: agents.map((a) => ({ id: a.id, name: a.name ?? '' })), agentId, onAgentChange: setAgentId, environments, environmentId, onEnvironmentChange: setEnvironmentId }
  const composer = (
    <VStack gap={2}>
      <Composer
      onSend={start}
      autoFocus
      isDisabled={!model}
      commands={commands}
      appHandlers={appHandlers}
      density={pending ? 'balanced' : 'spacious'}
      key={restore?.n ?? 0}
      initialValue={restore?.text ?? initialValue}
      placeholder="How can Agentry help today?"
      status={
        failure && !failure.unavailable
          ? { type: 'error', message: failure.message }
          : noModels
            ? { type: 'warning', message: 'No models are configured.' }
            : undefined
      }
      settings={settings}
      />
      {/* Who runs the chat and where: under the input, so a long sandbox name does not crowd it. */}
      {!pending && <ContextMenus settings={settings} />}
      {!pending && directory && <Text type="supporting">in /workspace/{directory}</Text>}
    </VStack>
  )
  return (
    <VStack xstyle={styles.page}>
      <TopBar />
      {failure?.unavailable && <ErrorBanner message={failure.message} onRetry={failure.retry} />}
      {pending ? (
        // Like an open chat from the first send: the message on top, the composer docked at the bottom.
        <VStack xstyle={styles.chat} data-testid="new-chat-pending">
          <ChatLayout xstyle={styles.chat} density="spacious" composer={composer}>
            <ChatMessageList isStreaming={false}>
              <Message view={{ kind: 'user', id: 'pending', text: pending.text, ...(pending.files ? { files: pending.files } : {}) }} answer={async () => undefined} />
              {/* The session does not exist yet: say so instead of "thinking" (a new sandbox also has to start). */}
              <Thinking label={environmentId?.startsWith(NEW_SANDBOX) ? 'Starting a sandbox…' : 'Starting the chat…'} />
            </ChatMessageList>
          </ChatLayout>
        </VStack>
      ) : (
        <Center axis="both" padding={6} paddingBlockStart={10} minHeight="85%" data-testid="new-chat-start">
          <VStack gap={6} width="100%" maxWidth={760} hAlign="stretch">
            <Center>
              <Wordmark size="lg" />
            </Center>
            {composer}
            <RecentFiles />
          </VStack>
        </Center>
      )}
    </VStack>
  )
}
