// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import '../helpers/dom'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  usePathname: () => '/sandboxes',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}))

const apiMock = vi.hoisted(() => ({
  listSandboxEnvironments: vi.fn(),
  listSandboxTemplates: vi.fn(),
  listSandboxProviders: vi.fn(),
  listSandboxRuntimes: vi.fn(),
  createSandboxEnvironment: vi.fn(),
  deleteSandboxTemplate: vi.fn(),
}))
vi.mock('@/api/client', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/api/client')>()), api: apiMock }))
vi.mock('@/chat/use-conversation', () => ({ goToLogin: vi.fn() }))

import { SandboxesPage } from '@/ui/sandboxes/SandboxesPage'

const page = <T,>(data: T[]) => ({ object: 'list' as const, data, has_more: false })
const env = { id: 'env_abc', object: 'agent.environment', type: 'self_hosted', status: 'connected', provider: 'local', template_id: 'tpl_1', created_at: 1_700_000_000 }
const template = {
  id: 'tpl_1', object: 'agent.environment.template', name: 'Python data', created_at: 1, updated_at: 1, files: [],
  network: { access: 'disabled', allowed_domains: [] }, packages: { npm: [], python: ['pandas'], system: [] }, provider: 'local', unsupported_fields: ['network', 'packages'],
}
const provider = { object: 'sandbox.provider', name: 'local', default: true, capabilities: { templateFields: ['files'], files: true, exec: true } }

beforeEach(() => {
  apiMock.listSandboxEnvironments.mockResolvedValue(page([env]))
  apiMock.listSandboxTemplates.mockResolvedValue(page([template]))
  apiMock.listSandboxProviders.mockResolvedValue(page([provider]))
  apiMock.listSandboxRuntimes.mockResolvedValue({ object: 'sandbox.runtimes', available: true, node: '24.21.0', python: '3.12.14', pnpm: '11.28.5', python_packages: { pandas: '3.0.1' } })
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('SandboxesPage', () => {
  it('lists environments with status, provider and template, then switches to templates and providers', async () => {
    const user = userEvent.setup()
    render(<SandboxesPage />)
    expect(await screen.findByText('env_abc')).toBeInTheDocument()
    expect(screen.getByText('Ready')).toBeInTheDocument()
    expect(screen.getAllByText('Python data').length).toBeGreaterThan(0)
    expect(screen.getByRole('link', { name: 'env_abc' })).toHaveAttribute('href', '/sandboxes/env_abc')

    await user.click(screen.getByRole('button', { name: 'Templates' }))
    expect(screen.getByText('local cannot apply network, packages')).toBeInTheDocument()
    expect(screen.getByText('1 package, network disabled')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Providers' }))
    expect(await screen.findByText('Node 24.21.0')).toBeInTheDocument()
    expect(screen.getByText('Python 3.12.14')).toBeInTheDocument()
    expect(screen.getByText('Default')).toBeInTheDocument()
    expect(screen.getByText('Runs agent tools')).toBeInTheDocument()
  })

  it('shows the empty state and creates an environment', async () => {
    apiMock.listSandboxEnvironments.mockResolvedValue(page([]))
    apiMock.createSandboxEnvironment.mockResolvedValue(env)
    const user = userEvent.setup()
    render(<SandboxesPage />)
    expect(await screen.findByText('No environments yet.')).toBeInTheDocument()
    await user.click(screen.getAllByRole('button', { name: 'New environment' })[0]!)
    // One provider means nothing to choose, so the dialog does not ask.
    expect(screen.queryByText('Provider')).not.toBeInTheDocument()
    await user.click(await screen.findByRole('button', { name: 'Create environment' }))
    await waitFor(() => expect(apiMock.createSandboxEnvironment).toHaveBeenCalledWith({}))
  })

  it('shows a named sandbox with its live state, image and last use; an unavailable provider says why', async () => {
    const sandboxEnv = { ...env, id: 'env_sbx', name: 'Data box', provider: 'sandbox', type: 'openai_hosted', template_id: undefined, sandbox: { state: 'stopped', image: 'python:3.13', last_used_at: Math.floor(Date.now() / 1000) - 120 } }
    apiMock.listSandboxEnvironments.mockResolvedValue(page([sandboxEnv]))
    apiMock.listSandboxProviders.mockResolvedValue(page([provider, { object: 'sandbox.provider', name: 'sandbox', default: false, available: false, reason: 'Agentry Sandbox is not reachable', capabilities: { templateFields: ['image', 'packages', 'setup_commands', 'env', 'network', 'files'], files: true, exec: true } }]))
    const user = userEvent.setup()
    render(<SandboxesPage />)
    expect(await screen.findByText('Data box')).toBeInTheDocument()
    expect(screen.getByText('Stopped')).toBeInTheDocument()
    expect(screen.getByText('python:3.13')).toBeInTheDocument()
    expect(screen.getByText('Used 2 min ago')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Providers' }))
    expect(screen.getAllByText('Agentry Sandbox is not reachable').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Unavailable').length).toBeGreaterThan(0)
  })

  it('creates a named environment and keeps the dialog open with the reason when the sandbox is refused', async () => {
    apiMock.listSandboxEnvironments.mockResolvedValue(page([]))
    apiMock.createSandboxEnvironment.mockResolvedValue({ ...env, status: 'failed', error: 'sandbox limit reached: owner-a has 5 sandboxes (limit 5)' })
    const user = userEvent.setup()
    render(<SandboxesPage />)
    await user.click((await screen.findAllByRole('button', { name: 'New environment' }))[0]!)
    await user.type(await screen.findByRole('textbox', { name: /Name/ }), 'Data box')
    await user.click(screen.getByRole('button', { name: 'Create environment' }))
    await waitFor(() => expect(apiMock.createSandboxEnvironment).toHaveBeenCalledWith({ name: 'Data box' }))
    expect(await screen.findByText(/limit 5/)).toBeInTheDocument()
  })
})
