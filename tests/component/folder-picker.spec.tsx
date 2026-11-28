// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import '../helpers/dom'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const apiMock = vi.hoisted(() => ({ listEnvironmentFolders: vi.fn() }))
vi.mock('@/api/client', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/api/client')>()), api: apiMock }))

const { FolderPicker } = await import('@/ui/sandboxes/FolderPicker')

const list = (path: string, names: string[]) => ({ object: 'list', path, has_more: false, data: names.map((name) => ({ name, path: path ? `${path}/${name}` : name })) })
const tree: Record<string, string[]> = { '': ['.git', 'biology', 'chem'], biology: ['notes'], 'biology/notes': [] }

beforeEach(() => {
  apiMock.listEnvironmentFolders.mockReset()
  apiMock.listEnvironmentFolders.mockImplementation(async (_id: string, path: string) => list(path, tree[path] ?? []))
})
afterEach(() => cleanup())

function open(value = '') {
  const onChoose = vi.fn()
  render(<FolderPicker environmentId="env_1" value={value} isOpen onClose={vi.fn()} onChoose={onChoose} />)
  return onChoose
}

describe('FolderPicker', () => {
  it('lists the root without dot-folders, opens a sub-folder column, and returns the nested path', async () => {
    const user = userEvent.setup()
    const onChoose = open()
    expect(await screen.findByRole('button', { name: 'biology' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '.git' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Choose' })).toHaveAttribute('aria-disabled', 'true')
    await user.click(screen.getByRole('button', { name: 'biology' }))
    await user.click(await screen.findByRole('button', { name: 'notes' }))
    await user.click(screen.getByRole('button', { name: 'Choose' }))
    expect(onChoose).toHaveBeenCalledWith('biology/notes')
  })

  it('goes back up through the breadcrumb', async () => {
    const user = userEvent.setup()
    const onChoose = open('biology/notes')
    expect(await screen.findByText('No folders')).toBeInTheDocument()
    await user.click(screen.getByText('biology', { selector: 'nav *' }))
    await user.click(screen.getByRole('button', { name: 'Choose' }))
    expect(onChoose).toHaveBeenCalledWith('biology')
  })

  it('adds a new folder in the selected column and selects it', async () => {
    const user = userEvent.setup()
    const onChoose = open()
    await user.click(await screen.findByRole('button', { name: 'biology' }))
    await user.click(screen.getByRole('button', { name: 'New folder' }))
    await user.type(await screen.findByRole('textbox', { name: 'New folder name' }), 'fresh{Enter}')
    expect(await screen.findByRole('button', { name: 'fresh' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Choose' }))
    expect(onChoose).toHaveBeenCalledWith('biology/fresh')
  })

  it('rejects a bad new folder name inline', async () => {
    const user = userEvent.setup()
    open()
    await user.click(await screen.findByRole('button', { name: 'New folder' }))
    await user.type(await screen.findByRole('textbox', { name: 'New folder name' }), '..{Enter}')
    expect((await screen.findAllByText(/cannot contain/)).length).toBeGreaterThan(0)
  })

  it('chooses the whole workspace as an empty folder', async () => {
    const user = userEvent.setup()
    const onChoose = open('biology')
    await user.click(await screen.findByRole('button', { name: 'Use whole workspace' }))
    expect(onChoose).toHaveBeenCalledWith('')
  })

  it('shows an error with Retry when a column fails', async () => {
    const user = userEvent.setup()
    apiMock.listEnvironmentFolders.mockRejectedValueOnce(new Error('boom'))
    open()
    await user.click(await screen.findByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'biology' })).toBeInTheDocument())
  })
})
