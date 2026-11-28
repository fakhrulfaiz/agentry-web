'use client'

/**
 * A Finder-style column view of an environment's folders. Column 1 lists the
 * workspace root's sub-folders; picking one selects it and opens its sub-folders
 * as the next column. Columns load lazily. "New folder" only adds a name here:
 * the folder is created for real when the first chat starts.
 */
import { Button } from '@astryxdesign/core/Button'
import { Breadcrumbs, BreadcrumbItem } from '@astryxdesign/core/Breadcrumbs'
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog'
import { HStack } from '@astryxdesign/core/HStack'
import { Icon } from '@astryxdesign/core/Icon'
import { Spinner } from '@astryxdesign/core/Spinner'
import { Text } from '@astryxdesign/core/Text'
import { TextInput } from '@astryxdesign/core/TextInput'
import { VStack } from '@astryxdesign/core/VStack'
import { ChevronRightIcon, FolderIcon, FolderPlusIcon } from '@heroicons/react/24/outline'
import * as stylex from '@stylexjs/stylex'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '@/api/client'
import { normalizeWorkspaceFolder } from './workspace-folder'

const ui = stylex.create({
  columns: {
    display: 'flex',
    flexDirection: 'row',
    overflowX: 'auto',
    blockSize: 320,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: 'var(--color-border)',
  },
  column: {
    flexShrink: 0,
    inlineSize: 220,
    overflowY: 'auto',
    padding: 4,
    borderInlineEndWidth: 1,
    borderInlineEndStyle: 'solid',
    borderInlineEndColor: 'var(--color-border)',
  },
  body: { padding: 24, maxInlineSize: '100%' },
})

type Column = {
  /** Folder this column lists (relative path, '' = workspace root). */
  path: string
  state: 'loading' | 'ready' | 'error'
  names: string[]
  error?: string
}

const join = (parent: string, name: string) => (parent ? `${parent}/${name}` : name)
const parts = (path: string) => (path ? path.split('/') : [])

/**
 * @param environmentId - the environment whose folders are shown.
 * @param value - the folder currently chosen ('' = whole workspace); the picker opens on it.
 * @param onChoose - called with the chosen relative folder ('' for the whole workspace).
 */
export function FolderPicker({ environmentId, value, isOpen, onClose, onChoose }: {
  environmentId: string
  value: string
  isOpen: boolean
  onClose(): void
  onChoose(folder: string): void
}) {
  const [selected, setSelected] = useState('')
  const [columns, setColumns] = useState<Column[]>([])
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newError, setNewError] = useState<string | null>(null)
  const [added, setAdded] = useState<Record<string, string[]>>({})
  const addedRef = useRef(added)
  addedRef.current = added
  const scroller = useRef<HTMLDivElement | null>(null)

  const inFlight = useRef(new Set<string>())

  const load = useCallback((path: string) => {
    if (inFlight.current.has(path)) return
    inFlight.current.add(path)
    const setColumn = (patch: Partial<Column>) => setColumns((all) => all.map((c) => (c.path === path ? { ...c, ...patch } : c)))
    setColumn({ state: 'loading', error: undefined })
    Promise.resolve()
      .then(() => api.listEnvironmentFolders(environmentId, path))
      .finally(() => inFlight.current.delete(path))
      .then(
        (list) => setColumn({ state: 'ready', names: list.data.map((d) => d.name).filter((n) => !n.startsWith('.')) }),
        // A folder that only exists as a typed name has nothing in it yet.
        (error: { status?: number; message?: string }) => (error?.status === 404 && addedRef.current[path] !== undefined ? setColumn({ state: 'ready', names: [] }) : setColumn({ state: 'error', error: error?.message || 'Could not load folders.' })),
      )
  }, [environmentId])

  // Open on the current value: one column per level down to it.
  useEffect(() => {
    if (!isOpen) return
    const levels = parts(value)
    const paths = ['', ...levels.map((_, i) => levels.slice(0, i + 1).join('/'))]
    setSelected(value)
    setAdding(false)
    setNewName('')
    setAdded({})
    setColumns(paths.map((path) => ({ path, state: 'loading', names: [] })))
  }, [isOpen, value])

  // Load every column still marked loading.
  useEffect(() => {
    for (const column of columns) if (column.state === 'loading') load(column.path)
  }, [columns, load])

  useEffect(() => {
    scroller.current?.scrollTo?.({ left: scroller.current.scrollWidth })
  }, [columns.length])

  function open(parentPath: string, name: string) {
    const path = join(parentPath, name)
    setSelected(path)
    setAdding(false)
    setColumns((all) => {
      const upto = all.findIndex((c) => c.path === parentPath)
      return [...all.slice(0, upto + 1), { path, state: 'loading', names: [] }]
    })
  }

  function goTo(path: string) {
    setSelected(path)
    setAdding(false)
    const levels = parts(path)
    setColumns((all) => all.slice(0, levels.length + 1))
  }

  function addFolder() {
    const name = newName.trim()
    if (!name || name.includes('/')) {
      setNewError('Enter a single folder name.')
      return
    }
    const parent = selected
    const cleaned = normalizeWorkspaceFolder(join(parent, name))
    if ('error' in cleaned) {
      setNewError(cleaned.error)
      return
    }
    setAdded((all) => ({ ...all, [cleaned.value]: [] }))
    setColumns((all) => {
      const upto = all.findIndex((c) => c.path === parent)
      const column = all[upto]
      if (!column) return all
      const names = column.names.includes(name) ? column.names : [...column.names, name].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
      return [...all.slice(0, upto), { ...column, names }, { path: cleaned.value, state: 'ready', names: [] }]
    })
    setSelected(cleaned.value)
    setAdding(false)
    setNewName('')
    setNewError(null)
  }

  const crumbs = parts(selected)

  return (
    <Dialog isOpen={isOpen} onOpenChange={(open) => !open && onClose()} width="min(760px, 96vw)" purpose="form" aria-label="Choose a folder">
      <DialogHeader title="Choose a folder" />
      <VStack gap={3} xstyle={ui.body}>
        <Breadcrumbs label="Selected folder" separator="›">
          <BreadcrumbItem onClick={() => goTo('')} isCurrent={crumbs.length === 0}>/workspace</BreadcrumbItem>
          {crumbs.map((name, i) => (
            <BreadcrumbItem key={crumbs.slice(0, i + 1).join('/')} onClick={() => goTo(crumbs.slice(0, i + 1).join('/'))} isCurrent={i === crumbs.length - 1}>
              {name}
            </BreadcrumbItem>
          ))}
        </Breadcrumbs>
        <HStack ref={scroller} xstyle={ui.columns} aria-label="Folders" gap={0} vAlign="stretch">
          {columns.map((column) => (
            <VStack key={column.path} xstyle={ui.column} gap={0.5}>
              {column.state === 'loading' && <Spinner size="sm" aria-label="Loading folders" />}
              {column.state === 'error' && (
                <VStack gap={2}>
                  <Text type="supporting" color="secondary">{column.error}</Text>
                  <Button label="Retry" size="sm" onClick={() => load(column.path)} />
                </VStack>
              )}
              {column.state === 'ready' && column.names.length === 0 && <Text type="supporting" color="secondary">No folders</Text>}
              {column.state === 'ready' &&
                column.names.map((name) => {
                  const path = join(column.path, name)
                  const isOn = selected === path || selected.startsWith(`${path}/`)
                  return (
                    <Button
                      key={name}
                      label={name}
                      variant={isOn ? 'secondary' : 'ghost'}
                      width="100%"
                      icon={<Icon icon={FolderIcon} />}
                      endContent={<Icon icon={ChevronRightIcon} />}
                      onClick={() => open(column.path, name)}
                    />
                  )
                })}
              {column.state === 'ready' && adding && column.path === selected && (
                <TextInput
                  label="New folder name"
                  value={newName}
                  hasAutoFocus
                  onChange={(v) => {
                    setNewName(v)
                    setNewError(null)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      addFolder()
                    }
                  }}
                  status={newError ? { type: 'error', message: newError } : undefined}
                  statusVariant="detached"
                />
              )}
            </VStack>
          ))}
        </HStack>
        <HStack gap={2} hAlign="between">
          <Button label="New folder" variant="ghost" icon={<Icon icon={FolderPlusIcon} />} onClick={() => { setAdding(true); setNewError(null) }} />
          <HStack gap={2}>
            <Button label="Use whole workspace" variant="ghost" onClick={() => onChoose('')} />
            <Button label="Cancel" variant="ghost" onClick={onClose} />
            <Button label="Choose" variant="primary" isDisabled={selected === ''} onClick={() => onChoose(selected)} />
          </HStack>
        </HStack>
      </VStack>
    </Dialog>
  )
}
