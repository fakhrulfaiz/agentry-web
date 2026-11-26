'use client'

import { Button } from '@astryxdesign/core/Button'
import { Card } from '@astryxdesign/core/Card'
import { CheckboxList, CheckboxListItem } from '@astryxdesign/core/CheckboxList'
import { HStack } from '@astryxdesign/core/HStack'
import { RadioList, RadioListItem } from '@astryxdesign/core/RadioList'
import { Text } from '@astryxdesign/core/Text'
import { TextInput } from '@astryxdesign/core/TextInput'
import { VStack } from '@astryxdesign/core/VStack'
import { useState, type FormEvent } from 'react'
import { ApiError } from '@/api/client'
import type { AskUserQuestionItem, OAIApprovalAction } from '@/api/types'
import type { ActionAnswer } from '@/chat/use-conversation'
import { useFocusFirstControl } from './focus'

interface Reply {
  selected: string[]
  custom: string
}

/** The questions to show: the action's own list, or one built from its prompt and options. */
function questionsOf(action: OAIApprovalAction): AskUserQuestionItem[] {
  if (action.questions && action.questions.length > 0) return action.questions
  return [{ id: action.id, question: action.prompt, options: action.options.map((label) => ({ label })) }]
}

const EMPTY: Reply = { selected: [], custom: '' }

function payloadOf(questions: AskUserQuestionItem[], replies: Record<string, Reply>) {
  const one = (q: AskUserQuestionItem) => {
    const r = replies[q.id] ?? EMPTY
    const custom = r.custom.trim()
    // A single-choice typed answer replaces the pick; a multi-select one adds to the picks.
    return { selected: custom && !q.multiSelect ? [] : r.selected, ...(custom ? { custom } : {}) }
  }
  if (questions.length === 1) return one(questions[0])
  return { answers: questions.map((q) => ({ id: q.id, ...one(q) })) }
}

/**
 * A question from the agent: pick an option or type an answer, then Send; Skip
 * declines. Focus moves to the first control when it appears.
 */
export function QuestionCard({
  action,
  answer,
}: {
  action: OAIApprovalAction
  answer(actionId: string, a: ActionAnswer): Promise<void>
}) {
  const ref = useFocusFirstControl<HTMLElement>()
  const questions = questionsOf(action)
  const [replies, setReplies] = useState<Record<string, Reply>>({})
  const [busy, setBusy] = useState<'answer' | 'deny' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const update = (id: string, patch: Partial<Reply>) =>
    setReplies((prev) => ({ ...prev, [id]: { ...EMPTY, ...prev[id], ...patch } }))
  const complete = questions.every((q) => {
    const r = replies[q.id]
    return Boolean(r && (r.selected.length > 0 || r.custom.trim()))
  })

  async function send(decision: 'answer' | 'deny') {
    if (busy) return
    setBusy(decision)
    setError(null)
    try {
      await answer(action.id, decision === 'answer' ? { decision, payload: payloadOf(questions, replies) } : { decision })
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not send your answer. Try again.')
      setBusy(null)
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    if (complete) void send('answer')
  }

  return (
    <Card padding={4} width="100%">
      <form onSubmit={submit}>
        <VStack ref={ref} gap={4} role="group" aria-label="Question">
          {questions.map((q) => {
            const reply = replies[q.id] ?? EMPTY
            const options = q.options ?? []
            return (
              <VStack key={q.id} gap={2}>
                {options.length > 0 && q.multiSelect ? (
                  <CheckboxList label={q.question} description={q.detail} value={reply.selected} onChange={(v) => update(q.id, { selected: v })}>
                    {options.map((o) => (
                      <CheckboxListItem key={o.label} value={o.label} label={o.label} description={o.description} />
                    ))}
                  </CheckboxList>
                ) : options.length > 0 ? (
                  <RadioList label={q.question} description={q.detail} value={reply.selected[0] ?? ''} onChange={(v) => update(q.id, { selected: [v], custom: '' })}>
                    {options.map((o) => (
                      <RadioListItem key={o.label} value={o.label} label={o.label} description={o.description} />
                    ))}
                  </RadioList>
                ) : (
                  <Text type="label" weight="semibold">
                    {q.question}
                  </Text>
                )}
                <TextInput
                  label={options.length > 0 ? 'Or type your own answer' : 'Your answer'}
                  value={reply.custom}
                  onChange={(v) => update(q.id, { custom: v, ...(v.trim() && !q.multiSelect ? { selected: [] } : {}) })}
                />
              </VStack>
            )
          })}
          <HStack gap={2}>
            <Button label="Send answer" variant="primary" type="submit" isDisabled={!complete || busy === 'deny'} isLoading={busy === 'answer'} />
            <Button label="Skip" variant="ghost" isDisabled={busy === 'answer'} isLoading={busy === 'deny'} onClick={() => void send('deny')} />
          </HStack>
          {error && (
            <Text type="supporting" role="alert">
              {error}
            </Text>
          )}
        </VStack>
      </form>
    </Card>
  )
}
