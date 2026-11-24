// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import '../helpers/dom'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const push = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({
  usePathname: () => '/sandboxes/env_sbx',
  useRouter: () => ({ push, refresh: vi.fn(), replace: vi.fn() }),
}))

const apiMock = vi.hoisted(() => ({
  getSandboxEnvironment: vi.fn(),
  listEnvironmentFiles: vi.fn(),
  startSandboxEnvironment: vi.fn(),
  stopSandboxEnvironment: vi.fn(),
  resetSandboxEnvironment: vi.fn(),
  deleteSandboxEnvironment: vi.fn(),
  uploadEnvironmentFile: vi.fn(),
}))
vi.mock('@/api/client', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/api/client')>()), api: apiMock }))
vi.mock('@/chat/use-conversation', () => ({ goToLogin: vi.fn() }))

import { EnvironmentDetail } from '@/ui/sandboxes/EnvironmentDetail'

const base = { id: 'env_sbx', object: 'agent.environment', type: 'openai_hosted', status: 'connected', provider: 'sandbox', name: 'Data box', created_at: 1_700_000_000 }
const running = { ...base, sandbox: { state: 'running', image: 'python:3.13' } }
const stopped = { ...base, sandbox: { state: 'stopped', image: 'python:3.13' } }

beforeEach(() => {
  apiMock.getSandboxEnvironment.mockResolvedValue(running)
  apiMock.listEnvironmentFiles.mockResolvedValue({ object: 'list', data: [], has_more: false })
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('EnvironmentDetail', () => {
  it('stops a running sandbox, then offers Start', async () => {
    apiMock.stopSandboxEnvironment.mockResolvedValue(stopped)
    const user = userEvent.setup()
    render(<EnvironmentDetail environmentId="env_sbx" />)
    expect(await screen.findByRole('heading', { name: 'Data box' })).toBeInTheDocument()
    expect(screen.getByText('Running')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Stop' }))
    await waitFor(() => expect(apiMock.stopSandboxEnvironment).toHaveBeenCalledWith('env_sbx'))
    expect(await screen.findByRole('button', { name: 'Start' })).toBeInTheDocument()
    expect(screen.getByText('Stopped')).toBeInTheDocument()
  })

  it('resets after confirmation, wiping files only when asked', async () => {
    apiMock.resetSandboxEnvironment.mockResolvedValue(running)
    const user = userEvent.setup()
    render(<EnvironmentDetail environmentId="env_sbx" />)
    await user.click(await screen.findByRole('button', { name: 'Reset' }))
    await user.click(await screen.findByRole('switch', { name: 'Keep workspace files' }))
    await user.click(screen.getByRole('button', { name: 'Reset and delete files' }))
    await waitFor(() => expect(apiMock.resetSandboxEnvironment).toHaveBeenCalledWith('env_sbx', false))
  })

  it('opens a new chat in this environment', async () => {
    const user = userEvent.setup()
    render(<EnvironmentDetail environmentId="env_sbx" />)
    await user.click(await screen.findByRole('button', { name: 'New chat here' }))
    expect(push).toHaveBeenCalledWith('/?environment=env_sbx')
  })

  it('says when the sandbox is gone and offers no chat', async () => {
    apiMock.getSandboxEnvironment.mockResolvedValue({ ...base, sandbox: { state: 'gone' } })
    render(<EnvironmentDetail environmentId="env_sbx" />)
    expect(await screen.findByText(/no longer exists in Agentry Sandbox/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'New chat here' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reset' })).not.toBeInTheDocument()
  })
})
