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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, ApiError, isSignedOut } from '@/api/client'
import type { OAIAgent, OAIProject, SandboxEnvironment, SandboxProvider, SandboxTemplate } from '@/api/types'
import { seedText } from '@/artifacts/seed'
import { descriptionOf } from '@/agents/form'
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


function NewChatInner() {
  const router = useRouter()
  const params = useSearchParams()
  // `?seed=docs|slides|data` (Artifacts tiles) and `?schedule=1` (Scheduled page) prefill the composer once.
  const seed = params.get('seed')
  const schedule = params.get('schedule')
  // `?prompt=` (Connectors page Connect) prefills sanitized, length-limited text; the user still presses send.
  const prompt = params.get('prompt')
  const fresh = params.get('fresh')
  // `?environment=` (an environment's "New chat here") preselects it in the environment menu.
  const [wantedEnvironment] = useState(() => params.get('environment'))
  // `?project=` (a Project's "New chat here") files the chat under the Project and inherits its defaults.
  const [wantedProject] = useState(() => params.get('project'))
  // `?agent=` (the sidebar's Ask Agentry) preselects that agent in the agent menu.
  const [wantedAgent] = useState(() => params.get('agent'))
  const [initialValue] = useState(() => seedText(seed) ?? (schedule === '1' ? scheduleSeedText() : promptText(prompt)))
  useEffect(() => {
    // Clean the URL so presets don't linger; the outer wrapper ignores this cleanup navigation.
    if (seed !== null || schedule !== null || prompt !== null || fresh !== null || wantedEnvironment !== null || wantedProject !== null || wantedAgent !== null) {
      router.replace('/', { scroll: false })
    }
  }, [seed, schedule, prompt, fresh, wantedEnvironment, wantedProject, wantedAgent, router])
  const commands = useSkillCommands()
  const [models, setModels] = useState<string[] | null>(null)
  const [model, setModel] = useState('')
  const [effort, setEffort] = useState<EffortChoice>('auto')
  // Saved agents for the agent menu; '' is the default agent. A failed load just hides the menu.
  const [agents, setAgents] = useState<OAIAgent[]>([])
  const [agentId, setAgentId] = useState('')
  // Each menu loads on its own, so a slow sandbox provider cannot delay the environment chooser.
  const [agentsLoaded, setAgentsLoaded] = useState(false)
  const [environmentsLoaded, setEnvironmentsLoaded] = useState(false)
  const [freshLoading, setFreshLoading] = useState(true)
  const [usableEnvironments, setUsableEnvironments] = useState<SandboxEnvironment[]>([])
  const [freshEnvironments, setFreshEnvironments] = useState<{ id: string; name: string; group: 'new'; description?: string }[]>([])
  const environments = useMemo(
    () => [...usableEnvironments.map((e) => ({ id: e.id, name: environmentMenuLabel(e) })), ...freshEnvironments],
    [usableEnvironments, freshEnvironments],
  )
  // '' is the default workspace.
  const [environmentId, setEnvironmentId] = useState('')
  // A Project preset stays with this chat even when its agent/environment are overridden before the first send.
  const [projectId, setProjectId] = useState('')
  // `undefined` while the optional Project request is in flight; `null` when there is none to apply.
  const [project, setProject] = useState<OAIProject | null | undefined>(undefined)
  const presetsApplied = useRef(false)
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
    // A failed list just hides its menu.
    Promise.resolve()
      .then(() => api.listAgents())
      .catch(() => null)
      .then((list) => {
        if (list) setAgents(list.data)
        setAgentsLoaded(true)
      })
  }, [])
  useEffect(() => {
    Promise.resolve()
      .then(() => api.listSandboxEnvironments())
      .catch(() => null)
      .then((list) => {
        // Running and stopped sandboxes (a stopped one starts on send) and ready local environments.
        if (list) setUsableEnvironments(list.data.filter(canChatIn))
        setEnvironmentsLoaded(true)
      })
  }, [])
  useEffect(() => {
    // Fresh sandboxes are offered only while the isolated sandbox is up; either list failing just offers less.
    Promise.all([
      Promise.resolve().then(() => api.listSandboxProviders()).catch(() => ({ data: [] as SandboxProvider[] })),
      Promise.resolve().then(() => api.listSandboxTemplates()).catch(() => ({ data: [] as SandboxTemplate[] })),
    ])
      .then(([providers, templates]) => {
        const sandboxUp = providers.data.some((p) => p.name === 'sandbox' && p.available !== false && p.capabilities.exec)
        if (!sandboxUp) return
        setFreshEnvironments([
          { id: NEW_SANDBOX, name: 'Empty sandbox', group: 'new' as const, description: 'Standard image; deleted with the chat.' },
          ...templates.data
            .filter((t) => t.provider === 'sandbox' && t.unsupported_fields.length === 0)
            .map((t) => ({ id: `${NEW_SANDBOX}${t.id}`, name: t.name || 'Untitled template', group: 'new' as const, description: `${templateSummary(t)}; deleted with the chat.` })),
        ])
      })
      .catch(() => {})
      .finally(() => setFreshLoading(false))
  }, [])
  useEffect(() => {
    if (!wantedProject) {
      setProject(null)
      return
    }
    // A missing, foreign or archived Project is ignored.
    api.getProject(wantedProject).catch(() => null).then((body) => setProject(body?.status === 'active' ? body : null))
  }, [wantedProject])
  useEffect(() => {
    // Apply presets once every source they read has settled: URL choices first, then the Project's saved choices.
    if (presetsApplied.current || !agentsLoaded || !environmentsLoaded || project === undefined) return
    presetsApplied.current = true
    if (wantedAgent && agents.some((a) => a.id === wantedAgent)) setAgentId(wantedAgent)
    if (wantedEnvironment && usableEnvironments.some((e) => e.id === wantedEnvironment)) setEnvironmentId(wantedEnvironment)
    if (project) {
      setProjectId(project.id)
      if (project.agent_id) setAgentId(project.agent_id)
      const saved = agents.find((a) => a.id === project.agent_id)
      if (saved) {
        setPresetModel(saved.model)
        const effort = saved.reasoning?.effort
        if (effort === 'low' || effort === 'medium' || effort === 'high') setEffort(effort)
      }
      const environment = (project.environment as { environment_id?: unknown } | null | undefined)?.environment_id
      if (typeof environment === 'string' && usableEnvironments.some((e) => e.id === environment)) {
        setEnvironmentId(environment)
        const folder = project.environment?.directory
        if (typeof folder === 'string' && folder) setProjectFolder({ environmentId: environment, directory: folder })
      }
    }
  }, [agents, agentsLoaded, environmentsLoaded, project, usableEnvironments, wantedAgent, wantedEnvironment])

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
  const settings: ComposerSettings = { models, model, onModelChange: setModel, effort, onEffortChange: setEffort, agents: agents.map((a) => ({ id: a.id, name: a.name ?? '', ...(a.built_in ? { builtIn: true, description: descriptionOf(a) } : {}) })), agentId, onAgentChange: setAgentId, environments, environmentId, onEnvironmentChange: setEnvironmentId, environmentLoading: !environmentsLoaded || freshLoading }
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

function actionKeyFrom(params: { get(name: string): string | null }): string | null {
  const seed = params.get('seed')
  const schedule = params.get('schedule')
  const prompt = params.get('prompt')
  const environment = params.get('environment')
  const project = params.get('project')
  const fresh = params.get('fresh')
  const agent = params.get('agent')
  if (seed || schedule || prompt || environment || project || agent) {
    return `preset:${seed ?? ''}|${schedule ?? ''}|${prompt ?? ''}|${environment ?? ''}|${project ?? ''}|${agent ?? ''}`
  }
  if (fresh) return `fresh:${fresh}`
  return null
}

/** Remounts the inner chat when preset/fresh params arrive, but ignores the inner component's URL cleanup. */
export function NewChat() {
  const params = useSearchParams()
  const actionKey = actionKeyFrom(params)
  const lastAction = useRef<string | null>(actionKey)
  const cleaning = useRef(actionKey !== null)
  const [innerKey, setInnerKey] = useState(0)

  useEffect(() => {
    if (actionKey) {
      if (actionKey === lastAction.current) return
      lastAction.current = actionKey
      cleaning.current = true
      setInnerKey((k) => k + 1)
      return
    }
    if (cleaning.current) {
      // The inner component cleaned the preset URL; keep its applied state but allow the same preset again.
      cleaning.current = false
      lastAction.current = null
      return
    }
    if (lastAction.current !== null) {
      lastAction.current = null
      setInnerKey((k) => k + 1)
    }
  }, [actionKey])

  return <NewChatInner key={innerKey} />
}
