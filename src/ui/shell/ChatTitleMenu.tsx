'use client'

/**
 * The open chat's title in the header: a quiet button (title and a small
 * chevron, one line, ellipsized) that opens Star / Unstar, Rename and Delete.
 * The actions and dialogs are the sidebar's (`session-actions`). The title and
 * star follow changes broadcast from anywhere (the sidebar, this menu).
 * Deleting the chat goes home.
 */
import { DropdownMenu } from '@astryxdesign/core/DropdownMenu'
import { Icon } from '@astryxdesign/core/Icon'
import { PencilIcon, StarIcon, TrashIcon } from '@heroicons/react/24/outline'
import { StarIcon as StarSolidIcon } from '@heroicons/react/24/solid'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { sessionTitle } from './group'
import { DeleteDialog, isStarred, RenameDialog, useSessionChanges, useStarToggle, type SessionRef } from './session-actions'

export function ChatTitleMenu({ sessionId, metadata }: { sessionId: string; metadata: Record<string, string> | null | undefined }) {
  const router = useRouter()
  const [current, setCurrent] = useState<SessionRef>({ id: sessionId, metadata })
  useEffect(() => setCurrent({ id: sessionId, metadata }), [sessionId, metadata])
  useSessionChanges((change) => {
    if (change && change.id === sessionId && 'metadata' in change) setCurrent({ id: sessionId, metadata: change.metadata })
  })
  const toggleStar = useStarToggle()
  const [renaming, setRenaming] = useState<SessionRef | null>(null)
  const [deleting, setDeleting] = useState<SessionRef | null>(null)
  const starred = isStarred(current)

  return (
    <>
      <DropdownMenu
        button={{ label: sessionTitle(current), variant: 'ghost', size: 'sm' }}
        items={[
          {
            label: starred ? 'Unstar' : 'Star',
            icon: <Icon icon={starred ? StarSolidIcon : StarIcon} />,
            onClick: () => void toggleStar(current),
          },
          { label: 'Rename', icon: <Icon icon={PencilIcon} />, onClick: () => setRenaming(current) },
          { type: 'divider' },
          { label: 'Delete', icon: <Icon icon={TrashIcon} />, variant: 'destructive', onClick: () => setDeleting(current) },
        ]}
        menuWidth={200}
      />
      <RenameDialog session={renaming} onClose={() => setRenaming(null)} />
      <DeleteDialog session={deleting} onClose={() => setDeleting(null)} onDeleted={() => router.push('/')} />
    </>
  )
}
