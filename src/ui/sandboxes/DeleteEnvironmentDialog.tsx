'use client'

/**
 * Confirms deleting an environment (list card menu and detail page). When it
 * has snapshots they are kept unless "Also delete its N snapshots" is ticked.
 */
import { Button } from '@astryxdesign/core/Button'
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput'
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog'
import { HStack } from '@astryxdesign/core/HStack'
import { Text } from '@astryxdesign/core/Text'
import { VStack } from '@astryxdesign/core/VStack'
import { useEffect, useState } from 'react'
import { api } from '@/api/client'

export function DeleteEnvironmentDialog({ environmentId, name, isOpen, onClose, onConfirm }: {
  environmentId: string
  name: string
  isOpen: boolean
  onClose(): void
  onConfirm(deleteSnapshots: boolean): void
}) {
  const [count, setCount] = useState(0)
  const [also, setAlso] = useState(false)
  useEffect(() => {
    if (!isOpen) return
    setAlso(false)
    setCount(0)
    let live = true
    void (async () => {
      try {
        const page = await api.listEnvironmentSnapshots(environmentId)
        if (live) setCount(page.data.length)
      } catch {
        // Without the count the checkbox stays hidden and snapshots are kept.
      }
    })()
    return () => { live = false }
  }, [isOpen, environmentId])
  return (
    <Dialog isOpen={isOpen} onOpenChange={(open: boolean) => !open && onClose()} purpose="form" width={440}>
      <DialogHeader title={`Delete ${name}?`} onOpenChange={(open: boolean) => !open && onClose()} />
      <VStack gap={3} padding={4}>
        <Text>Its workspace and every file in it are removed. Chats that used it keep their history.</Text>
        {count > 0 && <CheckboxInput label={`Also delete its ${String(count)} ${count === 1 ? 'snapshot' : 'snapshots'}`} description="Otherwise they are kept and can still start a new sandbox." value={also} onChange={setAlso} />}
        <HStack gap={2} hAlign="end">
          <Button label="Cancel" variant="ghost" onClick={onClose} />
          <Button label="Delete sandbox" variant="destructive" onClick={() => onConfirm(count > 0 && also)} />
        </HStack>
      </VStack>
    </Dialog>
  )
}
