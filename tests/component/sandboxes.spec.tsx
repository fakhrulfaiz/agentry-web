// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import '../helpers/dom'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
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
  renameSandboxEnvironment: vi.fn(),
  startSandboxEnvironment: vi.fn(),
  stopSandboxEnvironment: vi.fn(),
  deleteSandboxEnvironment: vi.fn(),
  createSandboxTemplate: vi.fn(),
  updateSandboxTemplate: vi.fn(),
  deleteSandboxTemplate: vi.fn(),
  listSessions: vi.fn(),
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
  apiMock.listSessions.mockResolvedValue({ object: 'list', data: [], has_more: false, first_id: null, last_id: null })
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
    expect(await screen.findByText('Server workspace')).toBeInTheDocument()
    expect(screen.getByText('Ready')).toBeInTheDocument()
    expect(screen.getAllByText('This server').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Python data').length).toBeGreaterThan(0)
    expect(screen.getByRole('link', { name: 'Server workspace' })).toHaveAttribute('href', '/sandboxes/env_abc')

    await user.click(screen.getByRole('button', { name: 'Templates' }))
    expect(screen.getByText('This server cannot apply internet access and packages')).toBeInTheDocument()
    expect(screen.getByText('pandas; network disabled')).toBeInTheDocument()

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

  it('keeps the new-environment form scrollable and its actions outside the scroll area', async () => {
    const user = userEvent.setup()
    render(<SandboxesPage />)
    await user.click((await screen.findAllByRole('button', { name: 'New environment' }))[0]!)
    const dialog = await screen.findByRole('dialog')
    const content = dialog.querySelector('.astryx-layout-content') as HTMLElement | null
    expect(content).not.toBeNull()
    expect(within(content!).getByRole('textbox', { name: /Name/ })).toBeInTheDocument()
    expect(within(content!).getByRole('radiogroup', { name: 'Runs on' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Create environment' }).closest('.astryx-layout-footer')).not.toBeNull()
  })

  it('shows a named sandbox with its live state, image and last use; an unavailable provider says why', async () => {
    const sandboxEnv = { ...env, id: 'env_sbx', name: 'Data box', provider: 'sandbox', type: 'openai_hosted', template_id: undefined, sandbox: { state: 'stopped', image: 'python:3.13', last_used_at: Math.floor(Date.now() / 1000) - 120 } }
    apiMock.listSandboxEnvironments.mockResolvedValue(page([sandboxEnv]))
    apiMock.listSandboxProviders.mockResolvedValue(page([provider, { object: 'sandbox.provider', name: 'sandbox', default: false, available: false, reason: 'Agentry Sandbox is not reachable', capabilities: { templateFields: ['image', 'packages', 'setup_commands', 'env', 'network', 'files'], files: true, exec: true } }]))
    const user = userEvent.setup()
    render(<SandboxesPage />)
    expect(await screen.findByText('Data box')).toBeInTheDocument()
    expect(screen.getByText('Stopped, last used 2 min ago')).toBeInTheDocument()
    expect(screen.getAllByText('python:3.13').length).toBeGreaterThan(0)
    await user.click(screen.getByRole('button', { name: 'Providers' }))
    expect(screen.getAllByText('Agentry Sandbox is not reachable').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Unavailable').length).toBeGreaterThan(0)
  })

  it('renames, starts, stops and deletes an environment from its card menu', async () => {
    const sandboxEnv = { ...env, id: 'env_sbx', name: 'Data box', provider: 'sandbox', type: 'openai_hosted', template_id: undefined, sandbox: { state: 'stopped' } }
    apiMock.listSandboxEnvironments.mockResolvedValue(page([sandboxEnv]))
    apiMock.renameSandboxEnvironment.mockResolvedValue({ ...sandboxEnv, name: 'Notebook' })
    apiMock.startSandboxEnvironment.mockResolvedValue({ ...sandboxEnv, name: 'Notebook', sandbox: { state: 'running' } })
    apiMock.stopSandboxEnvironment.mockResolvedValue({ ...sandboxEnv, name: 'Notebook', sandbox: { state: 'stopped' } })
    apiMock.deleteSandboxEnvironment.mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(<SandboxesPage />)
    expect(await screen.findByText('Data box')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'More options for Data box' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Rename' }))
    const input = await screen.findByRole('textbox', { name: 'Name' })
    await user.clear(input)
    await user.type(input, ' Notebook ')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(apiMock.renameSandboxEnvironment).toHaveBeenCalledWith('env_sbx', 'Notebook'))
    expect(await screen.findByText('Notebook')).toBeInTheDocument()

    // Start and Stop are icon buttons on the card, not menu items.
    expect(screen.queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Start' }))
    await waitFor(() => expect(apiMock.startSandboxEnvironment).toHaveBeenCalledWith('env_sbx'))

    await user.click(await screen.findByRole('button', { name: 'Stop' }))
    await waitFor(() => expect(apiMock.stopSandboxEnvironment).toHaveBeenCalledWith('env_sbx'))

    await user.click(await screen.findByRole('button', { name: 'More options for Notebook' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    await user.click(await screen.findByRole('button', { name: 'Delete environment' }))
    await waitFor(() => expect(apiMock.deleteSandboxEnvironment).toHaveBeenCalledWith('env_sbx'))
    await waitFor(() => expect(screen.queryByText('Notebook')).not.toBeInTheDocument())
  })

  it('closes the dialog at once and lists the record the server answers with, setting up until it is ready', async () => {
    const setting = { ...env, id: 'env_new', name: 'Data box', provider: 'sandbox', status: 'pending', template_id: undefined, sandbox: { state: 'provisioning' } }
    apiMock.createSandboxEnvironment.mockResolvedValue(setting)
    apiMock.listSandboxEnvironments.mockResolvedValueOnce(page([env])).mockResolvedValue(page([env, setting]))
    const user = userEvent.setup()
    render(<SandboxesPage />)
    await user.click((await screen.findAllByRole('button', { name: 'New environment' }))[0]!)
    await user.type(await screen.findByRole('textbox', { name: /Name/ }), 'Data box')
    await user.click(screen.getByRole('button', { name: 'Create environment' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const link = await screen.findByRole('link', { name: 'Data box' })
    expect(link).toHaveAttribute('href', '/sandboxes/env_new')
    expect(screen.getAllByText('Setting up').length).toBeGreaterThan(0)
    // The list refreshes on its own until the sandbox is ready.
    apiMock.listSandboxEnvironments.mockResolvedValue(page([env, { ...setting, status: 'connected', sandbox: { state: 'running' } }]))
    await waitFor(() => expect(screen.queryByText('Setting up')).not.toBeInTheDocument(), { timeout: 6000 })
    expect(screen.getAllByText('Running').length).toBeGreaterThan(1)
  }, 10000)

  it('shows the setup stage on a card that is still setting up', async () => {
    const setting = { ...env, id: 'env_new', name: 'Data box', provider: 'sandbox', status: 'pending', template_id: undefined, sandbox: { state: 'provisioning', progress: { stage: 'pulling_image', updated_at: 1 } } }
    apiMock.listSandboxEnvironments.mockResolvedValue(page([env, setting]))
    render(<SandboxesPage />)
    expect(await screen.findByText('Setting up: Downloading the image')).toBeInTheDocument()
  })

  it('shows a failed environment with its reason and deletes it', async () => {
    const failed = { ...env, id: 'env_bad', name: 'Data box', provider: 'sandbox', status: 'failed', template_id: undefined, error: 'sandbox limit reached: owner-a has 5 sandboxes (limit 5)', sandbox: { state: 'failed' } }
    apiMock.listSandboxEnvironments.mockResolvedValue(page([failed]))
    apiMock.deleteSandboxEnvironment.mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(<SandboxesPage />)
    expect(await screen.findByText(/limit 5/)).toBeInTheDocument()
    expect(screen.getByText(/^Failed: /)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'More options for Data box' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    await user.click(await screen.findByRole('button', { name: 'Delete environment' }))
    await waitFor(() => expect(apiMock.deleteSandboxEnvironment).toHaveBeenCalledWith('env_bad'))
    await waitFor(() => expect(screen.queryByText(/limit 5/)).not.toBeInTheDocument())
  })

  it('shows a refused create as an error banner', async () => {
    apiMock.createSandboxEnvironment.mockRejectedValue(new (await import('@/api/client')).ApiError(400, 'bad_request', 'template not found'))
    const user = userEvent.setup()
    render(<SandboxesPage />)
    await user.click((await screen.findAllByRole('button', { name: 'New environment' }))[0]!)
    await user.click(await screen.findByRole('button', { name: 'Create environment' }))
    expect(await screen.findByText('template not found')).toBeInTheDocument()
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
    await user.click(screen.getByRole('button', { name: 'Create template' }))
    await waitFor(() => expect(apiMock.createSandboxTemplate).toHaveBeenCalledWith({
      name: 'Data work', provider: 'sandbox', packages: { system: [], python: ['polars', 'rich'], npm: [] }, network: { access: 'disabled' }, resources: { cpus: 2 },
    }))
  })

  it('opens a template to show exactly what it installs', async () => {
    const data = { ...template, id: 'tpl_builtin_data_science', name: 'Data science', built_in: true, provider: 'sandbox', unsupported_fields: [], network: { access: 'enabled', allowed_domains: [] }, packages: { npm: [], python: ['matplotlib', 'seaborn', 'scipy', 'scikit-learn'], system: ['ripgrep'] } }
    apiMock.listSandboxTemplates.mockResolvedValue(page([data]))
    const user = userEvent.setup()
    render(<SandboxesPage />)
    await user.click(await screen.findByRole('button', { name: 'Templates' }))
    expect(screen.getByText('ripgrep, matplotlib, seaborn, scipy, scikit-learn'.split(', ').slice(0, 3).join(', ') + ' and 2 more')).toBeInTheDocument()
    await user.click(screen.getByRole('link', { name: 'Data science' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('matplotlib, seaborn, scipy, scikit-learn')).toBeInTheDocument()
    expect(within(dialog).getByText('ripgrep')).toBeInTheDocument()
    expect(within(dialog).getByText('Built in. It cannot be changed or deleted.')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('marks built-in templates and offers no delete for them', async () => {
    apiMock.listSandboxTemplates.mockResolvedValue(page([{ ...template, id: 'tpl_builtin_offline', name: 'Offline', built_in: true, provider: 'sandbox', unsupported_fields: [] }, template]))
    const user = userEvent.setup()
    render(<SandboxesPage />)
    await user.click(await screen.findByRole('button', { name: 'Templates' }))
    expect(await screen.findByText('Built in')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit Offline' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'More options for Offline' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Duplicate Offline' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit Python data' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'More options for Python data' }))
    expect(await screen.findByRole('menuitem', { name: 'Delete' })).toBeInTheDocument()
  })

  describe('edit and duplicate', () => {
    const sandbox = { object: 'sandbox.provider', name: 'sandbox', default: false, available: true, capabilities: { templateFields: ['image', 'packages', 'setup_commands', 'env', 'network', 'files', 'resources'], files: true, exec: true } }
    const custom = {
      ...template, id: 'tpl_sbx', name: 'Data work', provider: 'sandbox', unsupported_fields: [], network: { access: 'enabled', allowed_domains: [] },
      packages: { npm: [], python: ['polars'], system: [] }, resources: { cpus: 2, memory_mb: 4096 },
    }
    beforeEach(() => {
      apiMock.listSandboxProviders.mockResolvedValue(page([provider, sandbox]))
      apiMock.listSandboxTemplates.mockResolvedValue(page([custom]))
    })

    it('Edit pre-fills the template and sends an update that clears nothing else', async () => {
      apiMock.updateSandboxTemplate.mockResolvedValue(custom)
      const user = userEvent.setup()
      render(<SandboxesPage />)
      await user.click(await screen.findByRole('button', { name: 'Templates' }))
      await user.click(screen.getByRole('button', { name: 'Edit Data work' }))
      const dialog = await screen.findByRole('dialog')
      expect(within(dialog).getByRole('textbox', { name: /^Name/ })).toHaveValue('Data work')
      expect(within(dialog).getByRole('textbox', { name: /Python packages/ })).toHaveValue('polars')
      expect(within(dialog).getByText(/Changes apply to new environments only/)).toBeInTheDocument()
      await user.type(within(dialog).getByRole('textbox', { name: /npm packages/ }), 'tsx')
      await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))
      await waitFor(() => expect(apiMock.updateSandboxTemplate).toHaveBeenCalledWith('tpl_sbx', {
        name: 'Data work', provider: 'sandbox', image: '', packages: { system: [], python: ['polars'], npm: ['tsx'] }, resources: { cpus: 2, memory_mb: 4096 },
      }))
      expect(apiMock.createSandboxTemplate).not.toHaveBeenCalled()
    })

    it('clicking a custom template row opens Edit', async () => {
      const user = userEvent.setup()
      render(<SandboxesPage />)
      await user.click(await screen.findByRole('button', { name: 'Templates' }))
      await user.click(screen.getByRole('link', { name: 'Data work' }))
      expect(await screen.findByRole('button', { name: 'Save changes' })).toBeInTheDocument()
    })

    it('Duplicate pre-fills a built-in template as "<name> copy" and creates a new one', async () => {
      const builtIn = { ...custom, id: 'tpl_builtin_x', name: 'Data science', built_in: true }
      apiMock.listSandboxTemplates.mockResolvedValue(page([builtIn]))
      apiMock.createSandboxTemplate.mockResolvedValue(custom)
      const user = userEvent.setup()
      render(<SandboxesPage />)
      await user.click(await screen.findByRole('button', { name: 'Templates' }))
      await user.click(screen.getByRole('button', { name: 'Duplicate Data science' }))
      const dialog = await screen.findByRole('dialog')
      expect(within(dialog).getByRole('textbox', { name: /^Name/ })).toHaveValue('Data science copy')
      expect(within(dialog).getByText('Duplicate template')).toBeInTheDocument()
      await user.click(within(dialog).getByRole('button', { name: 'Create copy' }))
      await waitFor(() => expect(apiMock.createSandboxTemplate).toHaveBeenCalledWith({
        name: 'Data science copy', provider: 'sandbox', packages: { system: [], python: ['polars'], npm: [] }, resources: { cpus: 2, memory_mb: 4096 },
      }))
      expect(apiMock.updateSandboxTemplate).not.toHaveBeenCalled()
    })
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

  describe('the rack', () => {
    const now = Math.floor(Date.now() / 1000)
    const sbx = (id: string, name: string, sandbox: object, extra: object = {}) => ({ ...env, id, name, provider: 'sandbox', type: 'openai_hosted', template_id: undefined, sandbox, ...extra })
    const sbxTemplate = { ...template, id: 'tpl_s', name: 'Data science', provider: 'sandbox', unsupported_fields: [], network: { access: 'enabled', allowed_domains: [] }, resources: { cpus: 2, memory_mb: 4096 } }

    it('groups machines into Running, Stopped and This server, with a summary', async () => {
      apiMock.listSandboxEnvironments.mockResolvedValue(page([
        sbx('env_a', 'Alpha', { state: 'running', started_at: now - 7300 }),
        sbx('env_b', 'Beta', { state: 'stopped' }),
        sbx('env_c', 'Gamma', { state: 'failed' }, { status: 'failed', error: 'no room' }),
        env,
      ]))
      render(<SandboxesPage />)
      expect(await screen.findByText('1 running, 2 stopped, 1 on this server')).toBeInTheDocument()
      const running = screen.getByRole('group', { name: 'Running' })
      const stopped = screen.getByRole('group', { name: 'Stopped' })
      const server = screen.getByRole('group', { name: 'This server' })
      expect(within(running).getByText('Alpha')).toBeInTheDocument()
      expect(within(running).getByText('Running for 2 h')).toBeInTheDocument()
      expect(within(stopped).getByText('Beta')).toBeInTheDocument()
      expect(within(stopped).getByText('Failed: no room')).toBeInTheDocument()
      expect(within(server).getByText('Server workspace')).toBeInTheDocument()
    })

    it('hides sections that are empty', async () => {
      apiMock.listSandboxEnvironments.mockResolvedValue(page([sbx('env_a', 'Alpha', { state: 'running' })]))
      render(<SandboxesPage />)
      await screen.findByText('Alpha')
      expect(screen.queryByRole('group', { name: 'Stopped' })).not.toBeInTheDocument()
      expect(screen.queryByRole('group', { name: 'This server' })).not.toBeInTheDocument()
    })

    it('shows template, facts and the number of chats, and Stop and Start work from the card', async () => {
      const running = sbx('env_a', 'Alpha', { state: 'running', image: 'ghcr.io/x/agentry-sandbox:1', gpus: 1 }, { template_id: 'tpl_s' })
      apiMock.listSandboxTemplates.mockResolvedValue(page([sbxTemplate]))
      apiMock.listSandboxEnvironments.mockResolvedValue(page([running]))
      apiMock.listSessions.mockResolvedValue({ object: 'list', has_more: false, first_id: null, last_id: null, data: [
        { id: 's1', environment: { type: 'sandbox', environment_id: 'env_a' }, metadata: {} },
        { id: 's2', environment: { type: 'sandbox', environment_id: 'env_a' }, metadata: {} },
        { id: 's3', environment: null, metadata: {} },
      ] })
      apiMock.stopSandboxEnvironment.mockResolvedValue({ ...running, sandbox: { state: 'stopped' } })
      apiMock.startSandboxEnvironment.mockResolvedValue(running)
      const user = userEvent.setup()
      render(<SandboxesPage />)
      expect(await screen.findByText('Data science')).toBeInTheDocument()
      expect(screen.getByText('agentry-sandbox:1')).toBeInTheDocument()
      expect(screen.getByText('2 CPU')).toBeInTheDocument()
      expect(screen.getByText('4 GB')).toBeInTheDocument()
      expect(screen.getByText('1 GPU')).toBeInTheDocument()
      expect(screen.getByText('Internet on')).toBeInTheDocument()
      expect(await screen.findByText('2 chats')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'New chat here' })).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Stop' }))
      await waitFor(() => expect(apiMock.stopSandboxEnvironment).toHaveBeenCalledWith('env_a'))
      await user.click(await screen.findByRole('button', { name: 'Start' }))
      await waitFor(() => expect(apiMock.startSandboxEnvironment).toHaveBeenCalledWith('env_a'))
    })

    it('refreshes the states when the window regains focus', async () => {
      apiMock.listSandboxEnvironments.mockResolvedValue(page([sbx('env_a', 'Alpha', { state: 'running' })]))
      render(<SandboxesPage />)
      await screen.findByText('Alpha')
      apiMock.listSandboxEnvironments.mockResolvedValue(page([sbx('env_a', 'Alpha', { state: 'stopped' })]))
      window.dispatchEvent(new Event('focus'))
      expect(await screen.findByRole('group', { name: 'Stopped' })).toBeInTheDocument()
    })
  })
})
