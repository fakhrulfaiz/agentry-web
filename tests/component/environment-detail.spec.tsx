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
  listSandboxProviders: vi.fn(),
  startSandboxEnvironment: vi.fn(),
  stopSandboxEnvironment: vi.fn(),
  resetSandboxEnvironment: vi.fn(),
  deleteSandboxEnvironment: vi.fn(),
  uploadEnvironmentFile: vi.fn(),
}))
vi.mock('@/api/client', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/api/client')>()), api: apiMock }))
vi.mock('@/chat/use-conversation', () => ({ goToLogin: vi.fn() }))

import { ApiError } from '@/api/client'
import { EnvironmentDetail } from '@/ui/sandboxes/EnvironmentDetail'

const base = { id: 'env_sbx', object: 'agent.environment', type: 'openai_hosted', status: 'connected', provider: 'sandbox', name: 'Data box', created_at: 1_700_000_000 }
const running = { ...base, sandbox: { state: 'running', image: 'python:3.13' } }
const stopped = { ...base, sandbox: { state: 'stopped', image: 'python:3.13' } }

beforeEach(() => {
  apiMock.getSandboxEnvironment.mockResolvedValue(running)
  apiMock.listEnvironmentFiles.mockResolvedValue({ object: 'list', data: [], has_more: false })
  apiMock.listSandboxProviders.mockRejectedValue(new Error('no places'))
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('EnvironmentDetail', () => {
  it('shows a sandbox that is still being set up without actions, then refreshes until it is ready', async () => {
    const setting = { ...base, status: 'pending', sandbox: { state: 'provisioning' } }
    apiMock.getSandboxEnvironment.mockResolvedValue(setting)
    render(<EnvironmentDetail environmentId="env_sbx" />)
    expect(await screen.findByRole('heading', { name: 'Data box' })).toBeInTheDocument()
    expect(screen.getByText('Setting up')).toBeInTheDocument()
    expect(screen.getByText(/terminal and files appear when it is ready/)).toBeInTheDocument()
    for (const name of ['Start', 'Stop', 'Reset', 'New chat here']) expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
    expect(apiMock.listEnvironmentFiles).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Delete environment' })).toBeInTheDocument()
    apiMock.getSandboxEnvironment.mockResolvedValue(running)
    expect(await screen.findByRole('button', { name: 'Stop' }, { timeout: 6000 })).toBeInTheDocument()
    await waitFor(() => expect(apiMock.listEnvironmentFiles).toHaveBeenCalled())
  }, 10000)

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

  it('says reset deletes all files, and offers no keep-files switch, on a place that cannot keep them', async () => {
    apiMock.getSandboxEnvironment.mockResolvedValue({ ...base, sandbox: { state: 'running', image: 'base', place: 'e2b1' } })
    apiMock.listSandboxProviders.mockResolvedValue({ object: 'list', data: [{ name: 'sandbox', places: [{ id: 'e2b1', name: 'E2B', kind: 'e2b', default: false, available: true, capabilities: { reset: true, keepFilesOnReset: false, isolated: true, gpu: false } }] }] })
    apiMock.resetSandboxEnvironment.mockResolvedValue(running)
    const user = userEvent.setup()
    render(<EnvironmentDetail environmentId="env_sbx" />)
    await screen.findByText('Runs on E2B')
    await user.click(await screen.findByRole('button', { name: 'Reset' }))
    expect(await screen.findByText('Reset deletes all files in this environment.')).toBeInTheDocument()
    expect(screen.queryByRole('switch', { name: 'Keep workspace files' })).not.toBeInTheDocument()
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
    expect(await screen.findByText('This sandbox is gone')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'New chat here' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reset' })).not.toBeInTheDocument()
  })

  it('a gone environment shows one panel with Delete and no files section', async () => {
    apiMock.getSandboxEnvironment.mockResolvedValue({ ...base, sandbox: { state: 'gone' } })
    render(<EnvironmentDetail environmentId="env_sbx" />)
    expect(await screen.findByText('This sandbox is gone')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Delete environment' })).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Back to sandboxes' })).toBeInTheDocument()
    expect(apiMock.listEnvironmentFiles).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Files' })).not.toBeInTheDocument()
    expect(document.querySelector('input[type="file"]')).toBeNull()
  })

  it('a raw files error is shown in plain words without Retry', async () => {
    apiMock.listEnvironmentFiles.mockRejectedValue(new ApiError(500, 'internal', '[unimplemented]'))
    render(<EnvironmentDetail environmentId="env_sbx" />)
    expect(await screen.findByText("Couldn't list the files.")).toBeInTheDocument()
    expect(screen.queryByText(/unimplemented/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
  })

  it('an unreachable sandbox offers Retry for files', async () => {
    apiMock.listEnvironmentFiles.mockRejectedValueOnce(new ApiError(503, 'unavailable', 'down'))
    const user = userEvent.setup()
    render(<EnvironmentDetail environmentId="env_sbx" />)
    expect(await screen.findByText("Couldn't reach the sandbox to list files.")).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(apiMock.listEnvironmentFiles).toHaveBeenCalledTimes(2))
  })

  it('a stopped environment asks to start it instead of offering Retry', async () => {
    apiMock.getSandboxEnvironment.mockResolvedValue(stopped)
    apiMock.listEnvironmentFiles.mockRejectedValue(new ApiError(500, 'internal', '[unimplemented]'))
    render(<EnvironmentDetail environmentId="env_sbx" />)
    expect(await screen.findByText('Start the environment to see its files.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
  })
})
