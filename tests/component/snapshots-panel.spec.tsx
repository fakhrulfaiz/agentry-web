// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import '../helpers/dom'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const apiMock = vi.hoisted(() => ({
  listEnvironmentSnapshots: vi.fn(),
  listAllEnvironmentSnapshots: vi.fn(),
  importEnvironmentSnapshot: vi.fn(),
  snapshotDownloadUrl: vi.fn((id: string) => `/api/agentry/agents/environments/snapshots/${id}/content`),
  saveEnvironmentSnapshot: vi.fn(),
  deleteEnvironmentSnapshot: vi.fn(),
  restoreEnvironmentSnapshot: vi.fn(),
  createSandboxEnvironment: vi.fn(),
}))
vi.mock('@/api/client', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/api/client')>()), api: apiMock }))
vi.mock('@/chat/use-conversation', () => ({ goToLogin: vi.fn() }))

import { ApiError } from '@/api/client'
import { SnapshotsPanel } from '@/ui/sandboxes/SnapshotsPanel'
import { DeleteEnvironmentDialog } from '@/ui/sandboxes/DeleteEnvironmentDialog'

const now = Math.floor(Date.now() / 1000)
const snap = (over: object = {}) => ({ id: `snap_${'a'.repeat(32)}`, object: 'snapshot', environment_id: 'env_1', place: 'service', level: 'workspace', name: 'Before the refactor', state: 'ready', size_bytes: 2048, error: null, created_at: now - 120, expires_at: null, ...over })
const page = (data: object[]) => ({ object: 'list', data, has_more: false })

const renderPanel = (props: Partial<React.ComponentProps<typeof SnapshotsPanel>> = {}) => {
  const onRestored = vi.fn()
  const onNewEnvironment = vi.fn()
  render(<SnapshotsPanel environmentId="env_1" levels={['workspace', 'disk']} canSave onRestored={onRestored} onNewEnvironment={onNewEnvironment} {...props} />)
  return { onRestored, onNewEnvironment }
}

beforeEach(() => {
  apiMock.listEnvironmentSnapshots.mockResolvedValue(page([snap()]))
  apiMock.listAllEnvironmentSnapshots.mockResolvedValue(page([]))
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('SnapshotsPanel', () => {
  it('lists snapshots with name, level, size, age and no save text button', async () => {
    renderPanel()
    expect(await screen.findByText('Before the refactor')).toBeInTheDocument()
    const row = within(screen.getByRole('list', { name: 'Snapshots' }))
    expect(row.getByText('Files only')).toBeInTheDocument()
    expect(screen.getByText('2 KB')).toBeInTheDocument()
    expect(screen.getByText('2 min ago')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save snapshot' })).toBeInTheDocument()
  })

  it('shows a Download link on files-only rows kept on the service and not on the others', async () => {
    apiMock.listEnvironmentSnapshots.mockResolvedValue(page([snap(), snap({ id: `snap_${'d'.repeat(32)}`, name: 'Whole box', level: 'disk' }), snap({ id: `snap_${'e'.repeat(32)}`, name: 'Half done', state: 'saving', size_bytes: null }), snap({ id: `snap_${'c'.repeat(32)}`, name: 'Kept by the place', place: 'local' })]))
    renderPanel()
    await screen.findByText('Whole box')
    const link = screen.getByRole('link', { name: 'Download Before the refactor' })
    expect(link).toHaveAttribute('href', `/api/agentry/agents/environments/snapshots/snap_${'a'.repeat(32)}/content`)
    expect(screen.getAllByRole('link', { name: /^Download/ })).toHaveLength(1)
  })

  it('uploads an archive from the toolbar icon with an optional name and lists it as uploaded', async () => {
    apiMock.importEnvironmentSnapshot.mockResolvedValue(snap({ id: `snap_${'f'.repeat(32)}`, name: 'From laptop', environment_id: null }))
    const user = userEvent.setup()
    renderPanel()
    await screen.findByText('Before the refactor')
    await user.click(screen.getByRole('button', { name: 'Upload snapshot' }))
    const file = new File(['x'], 'work.tar.gz', { type: 'application/gzip' })
    await screen.findByText('Upload snapshot', { selector: 'h2, h1, [role=heading]' })
    await user.upload(document.querySelector('input[type=file]') as HTMLInputElement, file)
    await user.type(screen.getByRole('textbox', { name: /Name/ }), 'From laptop')
    await user.click(screen.getByRole('button', { name: 'Upload' }))
    await waitFor(() => expect(apiMock.importEnvironmentSnapshot).toHaveBeenCalledWith(file, expect.objectContaining({ name: 'From laptop' })))
    const uploaded = await screen.findByRole('list', { name: 'Uploaded snapshots' })
    expect(within(uploaded).getByText('From laptop')).toBeInTheDocument()
    expect(screen.getByText('Uploaded and from deleted sandboxes')).toBeInTheDocument()
  })

  it('shows an upload error inline and keeps the dialog open', async () => {
    apiMock.importEnvironmentSnapshot.mockRejectedValue(new ApiError(400, 'invalid_request', "symlink 'l' points outside the workspace"))
    const user = userEvent.setup()
    renderPanel()
    await screen.findByText('Before the refactor')
    await user.click(screen.getByRole('button', { name: 'Upload snapshot' }))
    await screen.findByText('Upload snapshot', { selector: 'h2, h1, [role=heading]' })
    await user.upload(document.querySelector('input[type=file]') as HTMLInputElement, new File(['x'], 'bad.tar.gz'))
    await user.click(screen.getByRole('button', { name: 'Upload' }))
    expect(await screen.findByText("symlink 'l' points outside the workspace")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Upload' })).toBeInTheDocument()
  })

  it('lists snapshots without an environment (uploaded or orphaned) so they can be restored here', async () => {
    apiMock.listAllEnvironmentSnapshots.mockResolvedValue(page([snap({ id: `snap_${'9'.repeat(32)}`, name: 'Old box', environment_id: null }), snap()]))
    renderPanel()
    const list = await screen.findByRole('list', { name: 'Uploaded snapshots' })
    expect(within(list).getByText('Old box')).toBeInTheDocument()
    expect(within(list).queryByText('Before the refactor')).not.toBeInTheDocument()
  })

  it('shows one line and the save button when there are none', async () => {
    apiMock.listEnvironmentSnapshots.mockResolvedValue(page([]))
    renderPanel()
    expect(await screen.findByText('No snapshots yet.')).toBeInTheDocument()
    expect(screen.getByText('Save one before a risky change.')).toBeInTheDocument()
  })

  it('saves from the dialog: only the place levels, plain words, name optional', async () => {
    apiMock.listEnvironmentSnapshots.mockResolvedValue(page([]))
    apiMock.saveEnvironmentSnapshot.mockResolvedValue(snap({ id: `snap_${'b'.repeat(32)}`, name: 'Nightly', level: 'disk', state: 'saving', size_bytes: null }))
    const user = userEvent.setup()
    renderPanel()
    await user.click(await screen.findByRole('button', { name: 'Save snapshot' }))
    expect(await screen.findByRole('radio', { name: /Files only/ })).toBeChecked()
    expect(screen.getByRole('radio', { name: /Whole sandbox, including installed software/ })).toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: /Running state/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'Stop the sandbox while saving' })).not.toBeInTheDocument()
    await user.type(screen.getByRole('textbox', { name: /Name/ }), 'Nightly')
    await user.click(screen.getByRole('radio', { name: /Whole sandbox/ }))
    await user.click(screen.getByRole('checkbox', { name: 'Stop the sandbox while saving' }))
    await user.click(screen.getAllByRole('button', { name: 'Save snapshot' }).at(-1)!)
    await waitFor(() => expect(apiMock.saveEnvironmentSnapshot).toHaveBeenCalledWith('env_1', { name: 'Nightly', level: 'disk', stopFirst: true }))
    expect(await screen.findByText('Saving…')).toBeInTheDocument()
  })

  it('disables saving when the place offers no level', async () => {
    renderPanel({ levels: [] })
    const save = await screen.findByRole('button', { name: 'Save snapshot' })
    expect(save.hasAttribute('disabled') || save.getAttribute('aria-disabled') === 'true').toBe(true)
  })

  it('polls while a snapshot is saving and shows it ready', async () => {
    apiMock.listEnvironmentSnapshots.mockResolvedValueOnce(page([snap({ state: 'saving', size_bytes: null })])).mockResolvedValue(page([snap()]))
    renderPanel()
    expect(await screen.findByText('Saving…')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('Saving…')).not.toBeInTheDocument(), { timeout: 5000 })
    expect(screen.getByText('2 KB')).toBeInTheDocument()
    const calls = apiMock.listEnvironmentSnapshots.mock.calls.length
    await new Promise((r) => setTimeout(r, 2500))
    expect(apiMock.listEnvironmentSnapshots.mock.calls.length).toBe(calls)
  }, 12000)

  it('shows the reason for a failed one and offers only Delete', async () => {
    apiMock.listEnvironmentSnapshots.mockResolvedValue(page([snap({ state: 'failed', error: 'The workspace is larger than 2048 MB.', size_bytes: null })]))
    const user = userEvent.setup()
    renderPanel()
    expect(await screen.findByText('The workspace is larger than 2048 MB.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'More options for Before the refactor' }))
    expect(await screen.findByRole('menuitem', { name: 'Delete' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Restore' })).not.toBeInTheDocument()
  })

  it('confirms before restoring and says what is replaced', async () => {
    const env = { id: 'env_1', sandbox: { state: 'running' } }
    apiMock.restoreEnvironmentSnapshot.mockResolvedValue(env)
    const user = userEvent.setup()
    const { onRestored } = renderPanel()
    await user.click(await screen.findByRole('button', { name: 'More options for Before the refactor' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Restore' }))
    expect(await screen.findByText('Replaces the files in this sandbox with the snapshot. Changes made since are lost.')).toBeInTheDocument()
    expect(apiMock.restoreEnvironmentSnapshot).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Restore' }))
    await waitFor(() => expect(apiMock.restoreEnvironmentSnapshot).toHaveBeenCalledWith('env_1', `snap_${'a'.repeat(32)}`))
    expect(onRestored).toHaveBeenCalledWith(env)
  })

  it('uses the rebuild warning for a disk snapshot and shows a refused restore', async () => {
    apiMock.listEnvironmentSnapshots.mockResolvedValue(page([snap({ level: 'disk' })]))
    apiMock.restoreEnvironmentSnapshot.mockRejectedValue(new ApiError(400, 'invalid_request', 'That snapshot belongs to another place.'))
    const user = userEvent.setup()
    renderPanel()
    await user.click(await screen.findByRole('button', { name: 'More options for Before the refactor' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Restore' }))
    expect(await screen.findByText('Rebuilds this sandbox from the snapshot. Programs running now stop.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Restore' }))
    expect(await screen.findByText('That snapshot belongs to another place.')).toBeInTheDocument()
  })

  it('confirms before deleting, then reloads the list', async () => {
    apiMock.deleteEnvironmentSnapshot.mockResolvedValue(undefined)
    const user = userEvent.setup()
    renderPanel()
    await user.click(await screen.findByRole('button', { name: 'More options for Before the refactor' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    expect(await screen.findByText('This cannot be undone.')).toBeInTheDocument()
    expect(apiMock.deleteEnvironmentSnapshot).not.toHaveBeenCalled()
    apiMock.listEnvironmentSnapshots.mockResolvedValue(page([]))
    await user.click(screen.getByRole('button', { name: 'Delete snapshot' }))
    await waitFor(() => expect(apiMock.deleteEnvironmentSnapshot).toHaveBeenCalledWith(`snap_${'a'.repeat(32)}`))
    expect(await screen.findByText('No snapshots yet.')).toBeInTheDocument()
  })

  it('starts a new environment from a snapshot', async () => {
    apiMock.createSandboxEnvironment.mockResolvedValue({ id: 'env_new' })
    const user = userEvent.setup()
    const { onNewEnvironment } = renderPanel()
    await user.click(await screen.findByRole('button', { name: 'More options for Before the refactor' }))
    await user.click(await screen.findByRole('menuitem', { name: 'New sandbox from this snapshot' }))
    await user.type(await screen.findByRole('textbox', { name: /Name/ }), 'Copy')
    await user.click(screen.getByRole('button', { name: 'Create sandbox' }))
    await waitFor(() => expect(apiMock.createSandboxEnvironment).toHaveBeenCalledWith({ provider: 'sandbox', snapshotId: `snap_${'a'.repeat(32)}`, name: 'Copy' }))
    expect(onNewEnvironment).toHaveBeenCalled()
  })
})

describe('DeleteEnvironmentDialog', () => {
  const open = (onConfirm = vi.fn()) => {
    render(<DeleteEnvironmentDialog environmentId="env_1" name="Data box" isOpen onClose={vi.fn()} onConfirm={onConfirm} />)
    return onConfirm
  }

  it('keeps snapshots by default and offers to delete them when there are some', async () => {
    apiMock.listEnvironmentSnapshots.mockResolvedValue(page([snap(), snap({ id: `snap_${'c'.repeat(32)}` })]))
    const user = userEvent.setup()
    const onConfirm = open()
    const box = await screen.findByRole('checkbox', { name: 'Also delete its 2 snapshots' })
    expect(box).not.toBeChecked()
    await user.click(screen.getByRole('button', { name: 'Delete sandbox' }))
    expect(onConfirm).toHaveBeenLastCalledWith(false)
    await user.click(box)
    await user.click(screen.getByRole('button', { name: 'Delete sandbox' }))
    expect(onConfirm).toHaveBeenLastCalledWith(true)
  })

  it('hides the checkbox when there are none or they cannot be read', async () => {
    apiMock.listEnvironmentSnapshots.mockResolvedValue(page([]))
    const onConfirm = open()
    await waitFor(() => expect(apiMock.listEnvironmentSnapshots).toHaveBeenCalled())
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Delete sandbox' }))
    expect(onConfirm).toHaveBeenCalledWith(false)
  })
})
