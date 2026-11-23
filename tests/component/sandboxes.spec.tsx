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

    await user.click(screen.getByRole('button', { name: 'Runtimes' }))
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
})
