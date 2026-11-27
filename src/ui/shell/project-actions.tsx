'use client'

/**
 * Project management dialogs and the chat-to-Project move action shared by the
 * sidebar rows. Like `session-actions`, every successful change is broadcast on
 * `window` (`PROJECTS_CHANGED` for Projects, `SESSIONS_CHANGED` for a moved
 * chat) so all open views reload. A failed move reports an error toast.
 */
import { Button } from '@astryxdesign/core/Button'
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog'
import { HStack } from '@astryxdesign/core/HStack'
import { Selector } from '@astryxdesign/core/Selector'
import { Switch } from '@astryxdesign/core/Switch'
import { Text } from '@astryxdesign/core/Text'
import { TextInput } from '@astryxdesign/core/TextInput'
import { useToast } from '@astryxdesign/core/Toast'
import { VStack } from '@astryxdesign/core/VStack'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api, ApiError, isSignedOut } from '@/api/client'
import type { OAIAgent, OAIEnvironmentConfig, OAIProject, SandboxEnvironment } from '@/api/types'
import { announceProjects } from './project-events'
import { announceSessions, type SessionRef } from './session-actions'

type MoveSession = SessionRef & { project_id?: string | null }

function errorText(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Something went wrong. Try again.'
}

/** Moves a chat into a Project, or to Unfiled with `null`; resolves to whether it worked. */
export function useSessionMove(): (session: MoveSession, projectId: string | null) => Promise<boolean> {
  const toast = useToast()
  return useCallback(
    async (session, projectId) => {
      try {
        await api.setSessionProject(session.id, projectId)
        announceSessions()
        return true
      } catch (error) {
        if (isSignedOut(error)) {
          window.location.assign('/login')
          return false
        }
        toast({ type: 'error', body: errorText(error), uniqueID: `move-${session.id}` })
        return false
      }
    },
    [toast],
  )
}

/** Create (`project` is null) or edit a Project's name, defaults and pinned flag. */
export function ProjectDialog({ project, isOpen, onClose }: { project: OAIProject | null; isOpen: boolean; onClose(): void }) {
  const [name, setName] = useState('')
  const [agentId, setAgentId] = useState('')
  const [environmentId, setEnvironmentId] = useState('')
  const [pinned, setPinned] = useState(false)
  const [agents, setAgents] = useState<OAIAgent[]>([])
  const [environments, setEnvironments] = useState<SandboxEnvironment[]>([])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setName(project?.name ?? '')
    setAgentId(project?.agent_id ?? '')
    const current = project?.environment as { environment_id?: unknown } | null | undefined
    setEnvironmentId(current && typeof current.environment_id === 'string' ? current.environment_id : '')
    setPinned(project?.pinned ?? false)
    setError(null)
  }, [project])

  useEffect(() => {
    if (!isOpen) return
    Promise.resolve()
      .then(() => api.listAgents())
      .then((list) => setAgents(list.data), () => undefined)
    Promise.resolve()
      .then(() => api.listSandboxEnvironments())
      .then((list) => setEnvironments(list.data), () => undefined)
  }, [isOpen])

  async function save(event: FormEvent) {
    event.preventDefault()
    if (saving) return
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Enter a name.')
      return
    }
    setSaving(true)
    try {
      const environment: OAIEnvironmentConfig | null = environmentId ? { type: 'sandbox', environment_id: environmentId } : null
      const params = { name: trimmed, agent_id: agentId || null, environment, pinned }
      if (project) await api.updateProject(project.id, params)
      else await api.createProject(params)
      announceProjects()
      onClose()
    } catch (e) {
      if (isSignedOut(e)) window.location.assign('/login')
      setError(errorText(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog isOpen={isOpen} onOpenChange={(open) => !open && onClose()} purpose="form">
      <DialogHeader title={project ? 'Edit project' : 'New project'} />
      <form onSubmit={save}>
        <VStack gap={4}>
          <TextInput
            label="Name"
            value={name}
            onChange={(value) => {
              setName(value)
              setError(null)
            }}
            hasAutoFocus
            status={error ? { type: 'error', message: error } : undefined}
            statusVariant="detached"
          />
          <Selector
            label="Default agent"
            value={agentId}
            onChange={(value) => setAgentId(value ?? '')}
            options={[
              { value: '', label: 'Default agent' },
              ...agents.map((agent) => ({ value: agent.id, label: agent.name || 'Unnamed agent' })),
            ]}
          />
          <Selector
            label="Environment"
            value={environmentId}
            onChange={(value) => setEnvironmentId(value ?? '')}
            options={[
              { value: '', label: 'Default workspace' },
              ...environments.map((environment) => ({ value: environment.id, label: environment.name || 'Untitled sandbox' })),
            ]}
          />
          <Switch label="Pinned" value={pinned} onChange={setPinned} />
          <HStack gap={2} hAlign="end">
            <Button label="Cancel" variant="ghost" onClick={onClose} />
            <Button label="Save" variant="primary" type="submit" isLoading={saving} />
          </HStack>
        </VStack>
      </form>
    </Dialog>
  )
}

/** Moves a chat to one of the active Projects, or back to Unfiled. */
export function MoveProjectDialog({
  session,
  projects,
  onClose,
}: {
  session: MoveSession | null
  projects: OAIProject[]
  onClose(): void
}) {
  const move = useSessionMove()
  const [target, setTarget] = useState('')

  useEffect(() => {
    if (session) setTarget(session.project_id ?? '')
  }, [session])

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!session) return
    if (await move(session, target || null)) onClose()
  }

  return (
    <Dialog isOpen={session !== null} onOpenChange={(open) => !open && onClose()} purpose="form">
      <DialogHeader title="Move to project" />
      <form onSubmit={save}>
        <VStack gap={4}>
          <Selector
            label="Project"
            value={target}
            onChange={(value) => setTarget(value ?? '')}
            options={[
              { value: '', label: 'Unfiled' },
              ...projects.filter((project) => project.status === 'active').map((project) => ({ value: project.id, label: project.name })),
            ]}
          />
          <HStack gap={2} hAlign="end">
            <Button label="Cancel" variant="ghost" onClick={onClose} />
            <Button label="Save" variant="primary" type="submit" />
          </HStack>
        </VStack>
      </form>
    </Dialog>
  )
}

/** Archived Projects and their Unarchive actions, opened from the sidebar. */
export function ArchivedProjectsDialog({ isOpen, onClose }: { isOpen: boolean; onClose(): void }) {
  const toast = useToast()
  const [items, setItems] = useState<OAIProject[]>([])
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const page = await api.listProjects({ status: 'archived' })
      setItems(page.data.filter((project) => project.status === 'archived'))
      setError(null)
    } catch (e) {
      if (isSignedOut(e)) window.location.assign('/login')
      else setError(errorText(e))
    }
  }, [])

  useEffect(() => {
    if (isOpen) void load()
  }, [isOpen, load])

  async function unarchive(project: OAIProject) {
    try {
      await api.unarchiveProject(project.id)
      announceProjects()
      await load()
    } catch (e) {
      if (isSignedOut(e)) window.location.assign('/login')
      else toast({ type: 'error', body: errorText(e), uniqueID: `unarchive-${project.id}` })
    }
  }

  return (
    <Dialog isOpen={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogHeader title="Archived projects" />
      <VStack gap={2}>
        {error && <Text type="supporting">{error}</Text>}
        {items.length === 0 && !error && <Text type="supporting">No archived projects.</Text>}
        {items.map((project) => (
          <HStack key={project.id} gap={2} hAlign="between">
            <Text>{project.name}</Text>
            <Button label="Unarchive" size="sm" onClick={() => void unarchive(project)} />
          </HStack>
        ))}
        <HStack gap={2} hAlign="end">
          <Button label="Close" variant="ghost" onClick={onClose} />
        </HStack>
      </VStack>
    </Dialog>
  )
}
