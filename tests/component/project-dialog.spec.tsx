// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import '../helpers/dom'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OAIProject } from '@/api/types'

const apiMock = vi.hoisted(() => ({
  listAgents: vi.fn(),
  listSandboxEnvironments: vi.fn(),
  listEnvironmentFiles: vi.fn(),
  createProject: vi.fn(),
  updateProject: vi.fn(),
}))
vi.mock('@/api/client', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/api/client')>()), api: apiMock }))

const { ProjectDialog } = await import('@/ui/shell/project-actions')
const { topLevelFolders, normalizeWorkspaceFolder } = await import('@/ui/sandboxes/workspace-folder')

const page = <T,>(data: T[]) => ({ object: 'list', data, has_more: false })
const project = (environment: OAIProject['environment']): OAIProject => ({
  id: 'proj_1', object: 'project', name: 'Biology', status: 'active', pinned: false,
  agent_id: null, environment, archived_at: null, created_at: 1, updated_at: 1,
})
const file = (path: string) => ({ object: 'agent.environment.file', environment_id: 'env_1', path, size_bytes: 1 })

beforeEach(() => {
  for (const mock of Object.values(apiMock)) mock.mockReset()
  apiMock.listAgents.mockResolvedValue(page([]))
  apiMock.listSandboxEnvironments.mockResolvedValue(page([{ id: 'env_1', object: 'agent.environment', name: 'Data box', status: 'connected' }]))
  apiMock.listEnvironmentFiles.mockResolvedValue(page([file('/workspace/biology/a.txt'), file('/workspace/.git/x'), file('/workspace/top.txt')]))
  apiMock.createProject.mockResolvedValue({})
  apiMock.updateProject.mockResolvedValue({})
})
afterEach(() => cleanup())

describe('workspace folder helpers', () => {
  it('lists top-level folders without dot-folders or root files', () => {
    expect(topLevelFolders(['/workspace/b/x', '/workspace/a/y/z', '/workspace/.git/c', '/workspace/f.txt'])).toEqual(['a', 'b'])
  })
  it('mirrors the API rules', () => {
    expect(normalizeWorkspaceFolder(' ./biology/ ')).toEqual({ value: 'biology' })
    expect(normalizeWorkspaceFolder('/')).toEqual({ value: '' })
    for (const bad of ['../x', '/etc', 'a\\b', 'a/../b']) expect(normalizeWorkspaceFolder(bad)).toHaveProperty('error')
  })
})

describe('Project dialog folder', () => {
  const renderEdit = (environment: OAIProject['environment']) => render(<ProjectDialog project={project(environment)} isOpen onClose={vi.fn()} />)

  it('pre-fills the folder, offers existing folders, and saves a changed one', async () => {
    const user = userEvent.setup()
    renderEdit({ type: 'sandbox', environment_id: 'env_1', directory: 'biology' })
    const field = await screen.findByRole('textbox', { name: /Folder/ })
    expect(field).toHaveValue('biology')
    await user.click(await screen.findByRole('button', { name: 'biology' }))
    await user.clear(field)
    await user.type(field, 'notes/')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(apiMock.updateProject).toHaveBeenCalledWith('proj_1', expect.objectContaining({ environment: { type: 'sandbox', environment_id: 'env_1', directory: 'notes' } })))
  })

  it('omits an empty folder', async () => {
    const user = userEvent.setup()
    renderEdit({ type: 'sandbox', environment_id: 'env_1', directory: 'biology' })
    const field = await screen.findByRole('textbox', { name: /Folder/ })
    await user.clear(field)
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(apiMock.updateProject).toHaveBeenCalledWith('proj_1', expect.objectContaining({ environment: { type: 'sandbox', environment_id: 'env_1' } })))
  })

  it('rejects ../x inline and saves nothing', async () => {
    const user = userEvent.setup()
    renderEdit({ type: 'sandbox', environment_id: 'env_1' })
    await user.type(await screen.findByRole('textbox', { name: /Folder/ }), '../x')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect((await screen.findAllByText(/cannot contain/)).length).toBeGreaterThan(0)
    expect(apiMock.updateProject).not.toHaveBeenCalled()
  })

  it('shows no folder field without an environment, and clearing the environment drops the folder', async () => {
    const user = userEvent.setup()
    renderEdit({ type: 'sandbox', environment_id: 'env_1', directory: 'biology' })
    await screen.findByRole('textbox', { name: /Folder/ })
    await user.click(screen.getByRole('combobox', { name: 'Environment' }))
    await user.click(await screen.findByRole('option', { name: 'Default workspace' }))
    expect(screen.queryByRole('textbox', { name: /Folder/ })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(apiMock.updateProject).toHaveBeenCalledWith('proj_1', expect.objectContaining({ environment: null })))
  })
})
