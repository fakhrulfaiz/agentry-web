// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import '../helpers/dom'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OAIAgent, OAIProject, SandboxEnvironment } from '@/api/types'

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), query: '' }))
const pendingFirst = vi.hoisted(() => ({ setPendingFirst: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace, refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(nav.query),
  usePathname: () => '/',
}))

const apiMock = vi.hoisted(() => ({ models: vi.fn(), createSession: vi.fn(), listSkills: vi.fn(), listCommands: vi.fn(), listAgents: vi.fn(), listSandboxEnvironments: vi.fn(), listSandboxProviders: vi.fn(), listSandboxTemplates: vi.fn(), getProject: vi.fn() }))
vi.mock('@/api/client', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/api/client')>()), api: apiMock }))
vi.mock('@/chat/pending-first', () => ({ setPendingFirst: pendingFirst.setPendingFirst }))
vi.mock('@/chat/use-conversation', () => ({ goToLogin: vi.fn() }))
vi.mock('@/ui/shell/TopBar', () => ({ TopBar: () => null }))

const { NewChat } = await import('@/ui/chat/NewChat')
const { scheduleSeedText } = await import('@/schedule/seed')

const input = () => screen.queryByRole('combobox', { name: 'Message input' }) ?? screen.getByRole('textbox', { name: 'Message input' })

beforeEach(() => {
  nav.push.mockReset()
  nav.replace.mockReset()
  pendingFirst.setPendingFirst.mockReset()
  apiMock.getProject.mockReset()
  apiMock.models.mockResolvedValue(['m1'])
  for (const list of [apiMock.listAgents, apiMock.listSandboxEnvironments, apiMock.listSandboxProviders, apiMock.listSandboxTemplates]) list.mockResolvedValue({ object: 'list', data: [], has_more: false })
})
afterEach(() => cleanup())

describe('New chat prefill from the URL', () => {
  it.each([
    ['docs', '/office-docx'],
    ['slides', '/office-pptx'],
    ['data', '/office-xlsx'],
  ])('?seed=%s starts the composer with %s and clears the query', async (seed, text) => {
    nav.query = `seed=${seed}`
    render(<NewChat />)
    await waitFor(() => expect(input()).toHaveTextContent(text))
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/'))
  })

  it('?schedule=1 starts the composer with the schedule request and the browser time zone, then clears the query', async () => {
    nav.query = 'schedule=1'
    render(<NewChat />)
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
    await waitFor(() => expect(input()).toHaveTextContent(`Set up a scheduled task:`))
    expect(input()).toHaveTextContent(`My time zone is ${zone}.`)
    expect(scheduleSeedText(zone)).toContain(zone)
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/'))
  })

  it('?prompt= prefills sanitized, length-limited text without sending, then clears the query', async () => {
    nav.query = `prompt=${encodeURIComponent(`Connect my Gmail account\n\u0007${'x'.repeat(500)}`)}`
    render(<NewChat />)
    await waitFor(() => expect(input()).toHaveTextContent('Connect my Gmail account x'))
    expect(input().textContent?.length).toBeLessThanOrEqual(200)
    expect(apiMock.createSession).not.toHaveBeenCalled()
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/'))
  })

  it('an unknown seed or no query leaves the composer empty and does not rewrite the URL', async () => {
    nav.query = ''
    render(<NewChat />)
    await waitFor(() => expect(input()).toBeInTheDocument())
    expect(input()).toHaveTextContent('')
    expect(nav.replace).not.toHaveBeenCalled()
    cleanup()
    nav.query = 'seed=nope'
    render(<NewChat />)
    await waitFor(() => expect(input()).toBeInTheDocument())
    expect(input()).toHaveTextContent('')
  })
})

describe('New chat send', () => {
  it('shows the message and thinking state before the session exists, and restores the composer on failure', async () => {
    nav.query = ''
    let fail!: (e: Error) => void
    apiMock.createSession.mockReturnValue(new Promise((_, reject) => { fail = reject }))
    render(<NewChat />)
    await waitFor(() => expect(input()).toBeInTheDocument())
    await userEvent.type(input(), 'hello world{Enter}')
    await waitFor(() => expect(screen.getByText('Starting the chat…')).toBeInTheDocument(), { timeout: 5000 })
    expect(screen.getAllByText('hello world').length).toBeGreaterThan(0)
    fail(new Error('boom'))
    await waitFor(() => expect(screen.queryByText('Starting the chat…')).not.toBeInTheDocument(), { timeout: 5000 })
    await waitFor(() => expect(input()).toHaveTextContent('hello world'), { timeout: 5000 })
    expect(input().closest('[data-tall]')).not.toBeNull()
  })
}, 15_000)

describe('New chat first prompt', () => {
  it('docks the composer under the sent message while the chat is created, like an open chat', async () => {
    nav.query = ''
    apiMock.createSession.mockReturnValue(new Promise(() => {}))
    const user = userEvent.setup()
    render(<NewChat />)
    await waitFor(() => expect(input()).toBeInTheDocument())
    expect(input().closest('[data-tall]')).not.toBeNull()
    await user.click(input())
    await user.keyboard('Plan my week{Enter}')
    const pane = await screen.findByTestId('new-chat-pending')
    expect(input().closest('[data-tall]')).toBeNull()
    expect(pane).toHaveTextContent('Plan my week')
    expect(pane).toContainElement(input())
    expect(screen.queryByTestId('new-chat-start')).toBeNull()
  })
})

describe('New chat environment menu', () => {
  const page = <T,>(data: T[]) => ({ object: 'list', data, has_more: false })
  beforeEach(() => {
    nav.query = ''
    apiMock.listAgents.mockResolvedValue(page([]))
    apiMock.listSandboxEnvironments.mockResolvedValue(page([{ id: 'env_1', object: 'agent.environment', type: 'openai_hosted', status: 'connected', provider: 'sandbox', name: 'Data box', created_at: 1, sandbox: { state: 'stopped' } }]))
    apiMock.listSandboxProviders.mockResolvedValue(page([{ object: 'sandbox.provider', name: 'sandbox', default: false, available: true, capabilities: { templateFields: ['image'], files: true, exec: true } }]))
    apiMock.listSandboxTemplates.mockResolvedValue(page([{ id: 'tpl_1', object: 'agent.environment.template', name: 'Python data', provider: 'sandbox', files: [], packages: { npm: [], python: ['pandas'], system: [] }, network: { access: 'enabled', allowed_domains: [] }, unsupported_fields: [], created_at: 1, updated_at: 1 }]))
    apiMock.createSession.mockReturnValue(new Promise(() => {}))
  })

  it('offers existing environments and a fresh sandbox per template, and sends the choice', async () => {
    const user = userEvent.setup()
    render(<NewChat />)
    await user.click(await screen.findByRole('combobox', { name: 'Environment' }))
    expect(await screen.findByText('Data box (Isolated sandbox, stopped)')).toBeInTheDocument()
    expect(screen.getByText('New sandbox for this chat')).toBeInTheDocument()
    expect(screen.getByText('Empty sandbox')).toBeInTheDocument()
    await user.click(screen.getByRole('option', { name: /Python data/ }))
    await user.click(input())
    await user.keyboard('hello{Enter}')
    await waitFor(() => expect(apiMock.createSession).toHaveBeenCalledWith(expect.objectContaining({ environmentId: 'new:tpl_1' })))
  })

  it('offers no fresh sandbox while the isolated sandbox is down', async () => {
    apiMock.listSandboxProviders.mockResolvedValue(page([{ object: 'sandbox.provider', name: 'sandbox', default: false, available: false, reason: 'down', capabilities: { templateFields: [], files: true, exec: true } }]))
    const user = userEvent.setup()
    render(<NewChat />)
    await user.click(await screen.findByRole('combobox', { name: 'Environment' }))
    expect(await screen.findByText('Data box (Isolated sandbox, stopped)')).toBeInTheDocument()
    expect(screen.queryByText('New sandbox for this chat')).not.toBeInTheDocument()
  })

  it('carries the sandbox start label into the new-chat handoff', async () => {
    const user = userEvent.setup()
    apiMock.createSession.mockResolvedValue({ id: 'sess_created' } as never)
    render(<NewChat />)
    await user.click(await screen.findByRole('combobox', { name: 'Environment' }))
    await user.click(screen.getByRole('option', { name: /Empty sandbox/ }))
    await user.click(input())
    await user.keyboard('hello{Enter}')
    await waitFor(() => expect(pendingFirst.setPendingFirst).toHaveBeenCalledWith('sess_created', expect.objectContaining({ text: 'hello', startLabel: 'Starting a sandbox…' })))
  })
})

describe('New chat project preset', () => {
  const page = <T,>(data: T[]) => ({ object: 'list', data, has_more: false })
  const agent = (id: string, name: string, model: string, effort?: 'low' | 'medium' | 'high'): OAIAgent => ({
    id, object: 'agent', created_at: 1, updated_at: 1, name, instructions: null, model,
    metadata: {}, tools: [], ...(effort ? { reasoning: { effort } } : {}),
  })
  const environment = (id: string, name: string): SandboxEnvironment => ({
    id, object: 'agent.environment', type: 'openai_hosted', status: 'connected', provider: 'sandbox', name,
    created_at: 1, sandbox: { state: 'stopped' },
  })
  const project = (over: Partial<OAIProject> = {}): OAIProject => ({
    id: 'proj_1', object: 'project', name: 'Research', status: 'active', pinned: false,
    agent_id: 'agent_1', environment: { type: 'sandbox', environment_id: 'env_1' },
    archived_at: null, created_at: 1, updated_at: 1, ...over,
  })
  const selection = () => ({
    agent: screen.getByRole('combobox', { name: 'Agent' }),
    environment: screen.getByRole('combobox', { name: 'Environment' }),
    model: screen.getByRole('combobox', { name: 'Model' }),
    effort: screen.getByRole('combobox', { name: 'Reasoning effort' }),
  })
  const send = async () => {
    await userEvent.type(input(), 'hello{Enter}')
    await waitFor(() => expect(apiMock.createSession).toHaveBeenCalled())
  }

  beforeEach(() => {
    nav.query = 'project=proj_1'
    apiMock.models.mockResolvedValue(['m-default', 'm-saved'])
    apiMock.listAgents.mockResolvedValue(page([
      agent('agent_1', 'Research agent', 'm-saved', 'medium'),
      agent('agent_2', 'Override agent', 'm-default'),
    ]))
    apiMock.listSandboxEnvironments.mockResolvedValue(page([environment('env_1', 'Data box'), environment('env_2', 'Other box')]))
    apiMock.listSandboxProviders.mockResolvedValue(page([]))
    apiMock.listSandboxTemplates.mockResolvedValue(page([]))
    apiMock.getProject.mockResolvedValue(project())
    apiMock.createSession.mockResolvedValue({ id: 'sess_created' } as never)
  })

  it('preselects agent environment model and effort from a project preset', async () => {
    render(<NewChat />)
    await waitFor(() => expect(selection().agent).toHaveTextContent('Research agent'))
    expect(selection().environment).toHaveTextContent('Data box')
    await waitFor(() => expect(selection().model).toHaveTextContent('m-saved'))
    expect(selection().effort).toHaveTextContent('Medium')
    await send()
    expect(apiMock.createSession).toHaveBeenCalledWith({ text: 'hello', model: 'm-saved', effort: 'medium', agentId: 'agent_1', environmentId: 'env_1', projectId: 'proj_1' })
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/'))
  })

  it('keeps explicit agent and environment overrides while sending projectId', async () => {
    const user = userEvent.setup()
    render(<NewChat />)
    await waitFor(() => expect(selection().agent).toHaveTextContent('Research agent'))
    expect(selection().environment).toHaveTextContent('Data box')
    await user.click(selection().agent)
    await user.click(await screen.findByRole('option', { name: 'Override agent' }))
    await user.click(selection().environment)
    await user.click(await screen.findByRole('option', { name: /Other box/ }))
    await user.click(input())
    await user.keyboard('hello{Enter}')
    await waitFor(() => expect(apiMock.createSession).toHaveBeenCalledWith({ text: 'hello', model: 'm-saved', effort: 'medium', agentId: 'agent_2', environmentId: 'env_2', projectId: 'proj_1' }))
  })

  it('ignores an archived project preset', async () => {
    apiMock.getProject.mockResolvedValue(project({ status: 'archived' }))
    render(<NewChat />)
    await waitFor(() => expect(selection().agent).toHaveTextContent('Default agent'))
    expect(selection().environment).toHaveTextContent('Default workspace')
    expect(selection().model).toHaveTextContent('m-default')
    expect(selection().effort).toHaveTextContent('Auto')
    await send()
    expect(apiMock.createSession).toHaveBeenCalledWith({ text: 'hello', model: 'm-default' })
  })

  it('ignores an unknown or foreign project preset', async () => {
    nav.query = 'project=bad_id'
    apiMock.getProject.mockRejectedValue(Object.assign(new Error('Project not found'), { status: 404 }))
    render(<NewChat />)
    await waitFor(() => expect(apiMock.getProject).toHaveBeenCalledWith('bad_id'))
    await waitFor(() => expect(selection().agent).toHaveTextContent('Default agent'))
    expect(selection().environment).toHaveTextContent('Default workspace')
    expect(selection().model).toHaveTextContent('m-default')
    expect(selection().effort).toHaveTextContent('Auto')
    await send()
    expect(apiMock.createSession).toHaveBeenCalledWith({ text: 'hello', model: 'm-default' })
  })

  it('creates an unfiled chat when no project preset is present', async () => {
    nav.query = ''
    apiMock.models.mockResolvedValue(['m-default'])
    render(<NewChat />)
    await waitFor(() => expect(input()).toBeInTheDocument())
    await send()
    expect(apiMock.getProject).not.toHaveBeenCalled()
    expect(apiMock.createSession).toHaveBeenCalledWith({ text: 'hello', model: 'm-default' })
    expect(nav.replace).not.toHaveBeenCalled()
  })
})
