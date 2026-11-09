'use client'

import { Button } from '@astryxdesign/core/Button'
import { Card } from '@astryxdesign/core/Card'
import { Code } from '@astryxdesign/core/Code'
import { HStack } from '@astryxdesign/core/HStack'
import { Text } from '@astryxdesign/core/Text'
import { VStack } from '@astryxdesign/core/VStack'
import { useState } from 'react'
import { ApiError } from '@/api/client'
import type { OAIApprovalAction } from '@/api/types'
import type { ActionAnswer } from '@/chat/use-conversation'
import { useFocusFirstControl } from './focus'

const TITLE = { tool_approval: 'Approval needed', sandbox_escalation: 'Permission needed', user_question: 'Question' } as const

/** A tool approval or sandbox escalation: Allow / Deny. Focus moves to Allow when it appears. */
export function ApprovalCard({
  action,
  answer,
}: {
  action: OAIApprovalAction
  answer(actionId: string, a: ActionAnswer): Promise<void>
}) {
  const ref = useFocusFirstControl<HTMLElement>()
  const [busy, setBusy] = useState<'approve' | 'deny' | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function decide(decision: 'approve' | 'deny') {
    if (busy) return
    setBusy(decision)
    setError(null)
    try {
      await answer(action.id, { decision })
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not send your answer. Try again.')
      setBusy(null)
    }
  }

  return (
    <Card padding={4} width="100%">
      <VStack ref={ref} gap={3} role="group" aria-label={TITLE[action.kind]}>
        <HStack gap={2} vAlign="center" wrap="wrap">
          <Text type="label" weight="semibold">
            {TITLE[action.kind]}
          </Text>
          {action.tool_name && <Code>{action.tool_name}</Code>}
        </HStack>
        <Text>{action.prompt}</Text>
        <HStack gap={2}>
          <Button label="Allow" variant="primary" isLoading={busy === 'approve'} isDisabled={busy === 'deny'} onClick={() => void decide('approve')} />
          <Button label="Deny" isLoading={busy === 'deny'} isDisabled={busy === 'approve'} onClick={() => void decide('deny')} />
        </HStack>
        {error && (
          <Text type="supporting" role="alert">
            {error}
          </Text>
        )}
      </VStack>
    </Card>
  )
}
