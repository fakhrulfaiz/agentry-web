// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import '../helpers/dom'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
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
  listSandboxTemplates: vi.fn(),
  listSessions: vi.fn(),
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
  apiMock.listSandboxTemplates.mockResolvedValue({ object: 'list', data: [], has_more: false })
  apiMock.listSessions.mockResolvedValue({ object: 'list', data: [], has_more: false, first_id: null, last_id: null })
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
    for (const name of ['Start', 'Stop', 'New chat here']) expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
    expect(apiMock.listEnvironmentFiles).not.toHaveBeenCalled()
    await userEvent.setup().click(screen.getByRole('button', { name: 'More actions' }))
    expect(await screen.findByRole('menuitem', { name: 'Delete environment' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Reset' })).not.toBeInTheDocument()
    apiMock.getSandboxEnvironment.mockResolvedValue(running)
    expect(await screen.findByRole('button', { name: 'Stop' }, { timeout: 6000 })).toBeInTheDocument()
    await waitFor(() => expect(apiMock.listEnvironmentFiles).toHaveBeenCalled())
  }, 10000)

  it('says where the setup is, and moves on as the stage changes', async () => {
    const at = (progress: object) => ({ ...base, status: 'pending', sandbox: { state: 'provisioning', progress } })
    apiMock.getSandboxEnvironment.mockResolvedValue(at({ stage: 'installing_packages', updated_at: 1 }))
    render(<EnvironmentDetail environmentId="env_sbx" />)
    expect(await screen.findByText('Installing packages…')).toBeInTheDocument()
    apiMock.getSandboxEnvironment.mockResolvedValue(at({ stage: 'running_setup', step: 2, steps: 3, detail: 'npm install', updated_at: 2 }))
    expect(await screen.findByText('Running setup (2 of 3): npm install', undefined, { timeout: 6000 })).toBeInTheDocument()
  }, 10000)

  it('stops a running sandbox, then offers Start', async () => {
    apiMock.stopSandboxEnvironment.mockResolvedValue(stopped)
    const user = userEvent.setup()
    render(<EnvironmentDetail environmentId="env_sbx" />)
    expect(await screen.findByRole('heading', { name: 'Data box' })).toBeInTheDocument()
    expect(screen.getByText(/^Running/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Stop' }))
    await waitFor(() => expect(apiMock.stopSandboxEnvironment).toHaveBeenCalledWith('env_sbx'))
    expect(await screen.findByRole('button', { name: 'Start' })).toBeInTheDocument()
    expect(screen.getByText('Stopped')).toBeInTheDocument()
  })

  it('resets after confirmation, wiping files only when asked', async () => {
    apiMock.resetSandboxEnvironment.mockResolvedValue(running)
    const user = userEvent.setup()
    render(<EnvironmentDetail environmentId="env_sbx" />)
    await user.click(await screen.findByRole('button', { name: 'More actions' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Reset' }))
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
    await screen.findByText(/on E2B/)
    await user.click(await screen.findByRole('button', { name: 'More actions' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Reset' }))
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
    expect(screen.queryByRole('menuitem', { name: 'Reset' })).not.toBeInTheDocument()
  })

  it('a gone environment shows one panel with Delete and no files section', async () => {
    apiMock.getSandboxEnvironment.mockResolvedValue({ ...base, sandbox: { state: 'gone' } })
    render(<EnvironmentDetail environmentId="env_sbx" />)
    expect(await screen.findByText('This sandbox is gone')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Delete environment' })).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Back to sandboxes' })).toBeInTheDocument()
    expect(apiMock.listEnvironmentFiles).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Files' })).not.toBeInTheDocument()
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

  it('shows the machine in a header with a status line, and About rows from its template', async () => {
    const template = { id: 'tpl_1', name: 'Data science', network: { access: 'restricted', allowed_domains: ['pypi.org'] }, packages: { system: ['ripgrep'], python: ['pandas'], npm: [] }, resources: { cpus: 2, memory_mb: 4096 }, files: [], provider: 'sandbox', unsupported_fields: [] }
    apiMock.getSandboxEnvironment.mockResolvedValue({ ...base, template_id: 'tpl_1', sandbox: { state: 'running', image: 'ghcr.io/x/agentry-sandbox:1', started_at: Math.floor(Date.now() / 1000) - 7300, last_used_at: Math.floor(Date.now() / 1000) - 60 } })
    apiMock.listSandboxTemplates.mockResolvedValue({ object: 'list', data: [template], has_more: false })
    render(<EnvironmentDetail environmentId="env_sbx" />)
    expect(await screen.findByText('Running for 2 h')).toBeInTheDocument()
    const about = screen.getByRole('region', { name: 'About' })
    expect(await within(about).findByText('Data science')).toBeInTheDocument()
    expect(within(about).getByText('ghcr.io/x/agentry-sandbox:1')).toBeInTheDocument()
    expect(within(about).getByText('2 CPU')).toBeInTheDocument()
    expect(within(about).getByText('4 GB')).toBeInTheDocument()
    expect(within(about).getByText('pypi.org')).toBeInTheDocument()
    expect(within(about).getByText('ripgrep')).toBeInTheDocument()
    expect(within(about).getByText('pandas')).toBeInTheDocument()
    expect(within(about).getByText('Last used')).toBeInTheDocument()
    expect(within(about).getByRole('button', { name: 'Copy environment ID' })).toBeInTheDocument()
    expect(within(about).queryByText('GPUs')).not.toBeInTheDocument()
  })

  it('lists files as a folder tree that opens and closes', async () => {
    const file = (path: string, size_bytes: number) => ({ object: 'agent.environment.file', environment_id: 'env_sbx', path, size_bytes })
    apiMock.listEnvironmentFiles.mockResolvedValue({ object: 'list', has_more: false, data: [file('/workspace/notes/a.txt', 3), file('/workspace/report.md', 2048), file('/workspace/.cache/x', 1)] })
    const user = userEvent.setup()
    render(<EnvironmentDetail environmentId="env_sbx" />)
    expect(await screen.findByText('a.txt')).toBeInTheDocument()
    expect(screen.getByText('report.md')).toBeInTheDocument()
    expect(screen.getByText('3 B')).toBeInTheDocument()
    expect(screen.queryByText('x')).not.toBeInTheDocument()
    await user.click(screen.getByText('notes'))
    expect(screen.queryByText('a.txt')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Show 1 hidden file' }))
    expect(await screen.findByText('.cache')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Upload file' })).toBeInTheDocument()
  })

  it('says what an empty workspace is for', async () => {
    render(<EnvironmentDetail environmentId="env_sbx" />)
    expect(await screen.findByText('No files yet. Files the agent writes in /workspace show here.')).toBeInTheDocument()
  })

  it('switches between Files, Terminal and Chats, and lists the chats on this environment newest first', async () => {
    const chat = (id: string, title: string, env: string, last: number) => ({ id, object: 'agent.session', last_active_at: last, created_at: 1, metadata: { title }, environment: { type: 'sandbox', environment_id: env } })
    apiMock.listSessions.mockResolvedValue({ object: 'list', has_more: false, first_id: null, last_id: null, data: [chat('s1', 'Plot the sales', 'env_sbx', Math.floor(Date.now() / 1000) - 3600), chat('s2', 'Elsewhere', 'env_other', 1), chat('s3', 'Fix the parser', 'env_sbx', Math.floor(Date.now() / 1000) - 7200)] })
    const user = userEvent.setup()
    render(<EnvironmentDetail environmentId="env_sbx" />)
    expect(await screen.findByRole('tab', { name: /Files/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Terminal' })).toBeInTheDocument()
    const chatsTab = screen.getByRole('tab', { name: /Chats/ })
    await waitFor(() => expect(within(chatsTab).getByText('2')).toBeInTheDocument())
    await user.click(chatsTab)
    const links = within(await screen.findByRole('list', { name: 'Chats' })).getAllByRole('link')
    expect(links.map((l) => l.textContent)).toEqual(['Plot the sales', 'Fix the parser'])
    expect(links[0]).toHaveAttribute('href', '/c/s1')
    expect(screen.queryByText('Elsewhere')).not.toBeInTheDocument()
  })
})
