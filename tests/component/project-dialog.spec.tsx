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
  listEnvironmentFolders: vi.fn(),
  createProject: vi.fn(),
  updateProject: vi.fn(),
}))
vi.mock('@/api/client', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/api/client')>()), api: apiMock }))

const { ProjectDialog } = await import('@/ui/shell/project-actions')
const { normalizeWorkspaceFolder } = await import('@/ui/sandboxes/workspace-folder')

const page = <T,>(data: T[]) => ({ object: 'list', data, has_more: false })
const project = (environment: OAIProject['environment']): OAIProject => ({
  id: 'proj_1', object: 'project', name: 'Biology', status: 'active', pinned: false,
  agent_id: null, environment, archived_at: null, created_at: 1, updated_at: 1,
})
const folders = (path: string, names: string[]) => ({ object: 'list', path, has_more: false, data: names.map((name) => ({ name, path: path ? `${path}/${name}` : name })) })

beforeEach(() => {
  for (const mock of Object.values(apiMock)) mock.mockReset()
  apiMock.listAgents.mockResolvedValue(page([]))
  apiMock.listSandboxEnvironments.mockResolvedValue(page([{ id: 'env_1', object: 'agent.environment', name: 'Data box', status: 'connected' }]))
  apiMock.listEnvironmentFolders.mockImplementation(async (_id: string, path: string) => folders(path, path === '' ? ['biology', 'chem'] : path === 'biology' ? ['notes'] : []))
  apiMock.createProject.mockResolvedValue({})
  apiMock.updateProject.mockResolvedValue({})
})
afterEach(() => cleanup())

describe('workspace folder helpers', () => {
  it('mirrors the API rules', () => {
    expect(normalizeWorkspaceFolder(' ./biology/ ')).toEqual({ value: 'biology' })
    expect(normalizeWorkspaceFolder('/')).toEqual({ value: '' })
    for (const bad of ['../x', '/etc', 'a\\b', 'a/../b']) expect(normalizeWorkspaceFolder(bad)).toHaveProperty('error')
  })
})

describe('Project dialog folder', () => {
  const renderEdit = (environment: OAIProject['environment']) => render(<ProjectDialog project={project(environment)} isOpen onClose={vi.fn()} />)

  it('shows the folder as a button, and saves the folder picked in the column view', async () => {
    const user = userEvent.setup()
    renderEdit({ type: 'sandbox', environment_id: 'env_1', directory: 'biology' })
    await user.click(await screen.findByRole('button', { name: '/workspace/biology' }))
    await user.click(await screen.findByRole('button', { name: 'notes' }))
    await user.click(screen.getByRole('button', { name: 'Choose' }))
    await user.click(screen.getByRole('button', { name: '/workspace/biology/notes' }))
    await user.click(await screen.findByRole('button', { name: 'Use whole workspace' }))
    expect(await screen.findByRole('button', { name: 'Whole workspace' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Whole workspace' }))
    await user.click(await screen.findByRole('button', { name: 'chem' }))
    await user.click(screen.getByRole('button', { name: 'Choose' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(apiMock.updateProject).toHaveBeenCalledWith('proj_1', expect.objectContaining({ environment: { type: 'sandbox', environment_id: 'env_1', directory: 'chem' } })))
  })

  it('clears the folder with the Clear button and omits it on save', async () => {
    const user = userEvent.setup()
    renderEdit({ type: 'sandbox', environment_id: 'env_1', directory: 'biology' })
    await user.click(await screen.findByRole('button', { name: 'Clear folder' }))
    expect(screen.getByRole('button', { name: 'Whole workspace' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(apiMock.updateProject).toHaveBeenCalledWith('proj_1', expect.objectContaining({ environment: { type: 'sandbox', environment_id: 'env_1' } })))
  })

  it('shows no folder field without an environment, and clearing the environment drops the folder', async () => {
    const user = userEvent.setup()
    renderEdit({ type: 'sandbox', environment_id: 'env_1', directory: 'biology' })
    await screen.findByRole('button', { name: '/workspace/biology' })
    await user.click(screen.getByRole('combobox', { name: 'Environment' }))
    await user.click(await screen.findByRole('option', { name: 'Default workspace' }))
    expect(screen.queryByRole('button', { name: '/workspace/biology' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Whole workspace' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(apiMock.updateProject).toHaveBeenCalledWith('proj_1', expect.objectContaining({ environment: null })))
  })
})
