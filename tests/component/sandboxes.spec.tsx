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
  createSandboxTemplate: vi.fn(),
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
    expect(await screen.findByText('Unnamed environment')).toBeInTheDocument()
    expect(screen.getByText('Ready')).toBeInTheDocument()
    expect(screen.getAllByText('This server').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Python data').length).toBeGreaterThan(0)
    expect(screen.getByRole('link', { name: 'Unnamed environment' })).toHaveAttribute('href', '/sandboxes/env_abc')

    await user.click(screen.getByRole('button', { name: 'Templates' }))
    expect(screen.getByText('This server cannot apply internet access and packages')).toBeInTheDocument()
    expect(screen.getByText('1 package, network disabled')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Providers' }))
    expect(await screen.findByText('Node 24.21.0')).toBeInTheDocument()
    expect(screen.getByText('Python 3.12.14')).toBeInTheDocument()
    expect(screen.getByText('Default')).toBeInTheDocument()
    expect(screen.getByText('Templates can set starter files.')).toBeInTheDocument()
  })

  it('shows the empty state and creates an environment', async () => {
    apiMock.listSandboxEnvironments.mockResolvedValue(page([]))
    apiMock.createSandboxEnvironment.mockResolvedValue(env)
    const user = userEvent.setup()
    render(<SandboxesPage />)
    expect(await screen.findByText('No environments yet.')).toBeInTheDocument()
    await user.click(screen.getAllByRole('button', { name: 'New environment' })[0]!)
    expect(await screen.findByRole('radiogroup', { name: 'Runs on' })).toBeInTheDocument()
    await user.click(await screen.findByRole('button', { name: 'Create environment' }))
    await waitFor(() => expect(apiMock.createSandboxEnvironment).toHaveBeenCalledWith({ provider: 'local' }))
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
    await waitFor(() => expect(apiMock.createSandboxEnvironment).toHaveBeenCalledWith({ name: 'Data box', provider: 'local' }))
    expect(await screen.findByText(/limit 5/)).toBeInTheDocument()
  })

  it('edits a template on the isolated sandbox and sends only what it applies', async () => {
    const sandbox = { object: 'sandbox.provider', name: 'sandbox', default: false, available: true, capabilities: { templateFields: ['image', 'packages', 'setup_commands', 'env', 'network', 'files', 'resources'], files: true, exec: true } }
    apiMock.listSandboxProviders.mockResolvedValue(page([provider, sandbox]))
    apiMock.createSandboxTemplate.mockResolvedValue(template)
    const user = userEvent.setup()
    render(<SandboxesPage />)
    await user.click(await screen.findByRole('button', { name: 'Templates' }))
    await user.click(screen.getByRole('button', { name: 'New template' }))
    await user.type(await screen.findByRole('textbox', { name: /^Name/ }), 'Data work')
    await user.type(screen.getByRole('textbox', { name: /Python packages/ }), 'polars, rich')
    await user.click(screen.getByRole('tab', { name: /Internet and limits/ }))
    await user.click(screen.getByRole('switch', { name: /Internet access/ }))
    await user.type(screen.getByRole('textbox', { name: /CPU cores/ }), '2')
    expect(screen.getByText('Internet off')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save template' }))
    await waitFor(() => expect(apiMock.createSandboxTemplate).toHaveBeenCalledWith({
      name: 'Data work', provider: 'sandbox', packages: { system: [], python: ['polars', 'rich'], npm: [] }, network: { access: 'disabled' }, resources: { cpus: 2 },
    }))
  })

  it('marks built-in templates and offers no delete for them', async () => {
    apiMock.listSandboxTemplates.mockResolvedValue(page([{ ...template, id: 'tpl_builtin_offline', name: 'Offline', built_in: true, provider: 'sandbox', unsupported_fields: [] }, template]))
    const user = userEvent.setup()
    render(<SandboxesPage />)
    await user.click(await screen.findByRole('button', { name: 'Templates' }))
    expect(await screen.findByText('Built in')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete Offline' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete Python data' })).toBeInTheDocument()
  })

  it('on this server the template editor offers only starter files', async () => {
    const user = userEvent.setup()
    render(<SandboxesPage />)
    await user.click(await screen.findByRole('button', { name: 'Templates' }))
    await user.click(screen.getByRole('button', { name: 'New template' }))
    expect(await screen.findByRole('tab', { name: /Startup/ })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: /Software/ })).not.toBeInTheDocument()
    expect(screen.getByText(/This server does not apply image, packages/)).toBeInTheDocument()
  })
})
