'use client'

/** The preview panel's Tasks (subagents and background jobs), Plan and subagent tabs; they read the conversation through `PanelConversationContext`. */
import { EmptyState } from '@astryxdesign/core/EmptyState'
import { HStack } from '@astryxdesign/core/HStack'
import { Icon } from '@astryxdesign/core/Icon'
import { StackItem } from '@astryxdesign/core/Layout'
import { Spinner } from '@astryxdesign/core/Spinner'
import { Text } from '@astryxdesign/core/Text'
import { Token } from '@astryxdesign/core/Token'
import { VStack } from '@astryxdesign/core/VStack'
import { CheckCircleIcon, ClockIcon, CommandLineIcon, UserGroupIcon } from '@heroicons/react/24/outline'
import * as stylex from '@stylexjs/stylex'
import { useEffect, useState } from 'react'
import { usePanelConversation } from '@/chat/panel-data'
import type { TaskRow, TaskStatus } from '@/chat/tasks'
import type { OAIJob } from '@/api/types'
import { isLiveJob, jobElapsed, jobState, jobTitle, jobViewKey, visibleJobs } from '@/chat/jobs'
import type { TodoStatus } from '@/chat/todos'
import { usePreviewPanel } from '@/preview/store'
import { SubagentItems, SubagentActions, SubagentTranscript, Waiting, formatDuration } from '@/ui/chat/SubagentCard'

const styles = stylex.create({
  row: { appearance: 'none', background: 'none', border: 'none', padding: 0, textAlign: 'start', cursor: 'pointer', display: 'block', inlineSize: '100%', color: 'inherit', font: 'inherit' },
})

const LABEL: Record<TaskStatus, string> = { running: 'Running', done: 'Done', failed: 'Failed', closed: 'Closed' }
const COLOR = { running: 'blue', done: 'green', failed: 'red', closed: 'gray' } as const

/** Seconds now, ticking once a second while `live`. */
export function useNow(live: boolean): number {
  const [now, setNow] = useState(() => Date.now() / 1000)
  useEffect(() => {
    if (!live) return
    const id = setInterval(() => setNow(Date.now() / 1000), 1000)
    return () => clearInterval(id)
  }, [live])
  return now
}

function Row({ task, now }: { task: TaskRow; now: number }) {
  const { actions } = usePreviewPanel()
  const end = task.status === 'running' ? now : task.endedAt
  const elapsed = task.startedAt !== undefined && end !== undefined ? formatDuration(end - task.startedAt) : null
  const meta = [task.model, elapsed, task.tokens !== undefined ? `${task.tokens.toLocaleString('en-US')} tokens` : null].filter(Boolean).join(' · ')
  return (
    <button type="button" aria-label={`Open ${task.name}`} onClick={() => actions.openView(`sub:${task.id}`, task.name)} {...stylex.props(styles.row)}>
      <HStack gap={2} vAlign="center">
        <Icon icon={UserGroupIcon} color="secondary" size="sm" />
        <StackItem size="fill">
          <VStack gap={0}>
            <Text maxLines={1} weight="medium">{task.name}</Text>
            {meta && <Text type="supporting" color="secondary" maxLines={1} hasTabularNumbers>{meta}</Text>}
          </VStack>
        </StackItem>
        {task.waiting > 0 && <Token size="sm" color="orange" label={task.waiting === 1 ? 'Approval needed' : `${String(task.waiting)} approvals needed`} />}
        {task.status === 'running' && <Spinner size="sm" aria-label="Working" />}
        <Token size="sm" label={LABEL[task.status]} color={COLOR[task.status]} />
      </HStack>
    </button>
  )
}

export const JOB_COLOR = { running: 'blue', done: 'green', failed: 'red', stopped: 'gray' } as const

function JobRow({ job, now }: { job: OAIJob; now: number }) {
  const { actions } = usePreviewPanel()
  const title = jobTitle(job)
  const state = jobState(job)
  const meta = [job.kind === 'bash' ? 'Command' : job.kind, formatDuration(jobElapsed(job, now))].join(' · ')
  return (
    <button type="button" aria-label={`Open ${title}`} onClick={() => actions.openView(jobViewKey(job.id), title)} {...stylex.props(styles.row)}>
      <HStack gap={2} vAlign="center">
        <Icon icon={CommandLineIcon} color="secondary" size="sm" />
        <StackItem size="fill">
          <VStack gap={0}>
            <Text maxLines={1} weight="medium">{title}</Text>
            <Text type="supporting" color="secondary" maxLines={1} hasTabularNumbers>{meta}</Text>
          </VStack>
        </StackItem>
        {job.status === 'running' && <Spinner size="sm" aria-label="Running" />}
        <Token size="sm" label={state.label} color={JOB_COLOR[state.tone]} />
      </HStack>
    </button>
  )
}

/** The chat's subagents (status, model, time, tokens, a waiting-approval badge) and background commands (status, live time). */
export function TasksTab() {
  const { tasks, jobs } = usePanelConversation()
  const now = useNow(tasks.some((t) => t.status === 'running') || jobs.some(isLiveJob))
  const shown = visibleJobs(jobs, now)
  if (tasks.length === 0 && shown.length === 0) return <EmptyState title="No background tasks" description="Subagents and background commands this chat starts will be listed here." headingLevel={2} />
  return (
    <VStack gap={3} data-testid="tasks-list">
      {tasks.map((t) => <Row key={t.id} task={t} now={now} />)}
      {shown.map((j) => <JobRow key={j.id} job={j} now={now} />)}
    </VStack>
  )
}

const TODO_ICON: Record<TodoStatus, typeof CheckCircleIcon> = { completed: CheckCircleIcon, in_progress: ClockIcon, pending: ClockIcon }

/** The agent's current to-do list. */
export function PlanTab() {
  const { todos } = usePanelConversation()
  if (todos.length === 0) return <EmptyState title="No plan yet" description="When the agent keeps a to-do list, it appears here and ticks off as it works." headingLevel={2} />
  return (
    <VStack gap={2} data-testid="plan-list">
      {todos.map((t, i) => (
        <HStack key={i} gap={2} vAlign="center" data-status={t.status}>
          <Icon icon={TODO_ICON[t.status]} color={t.status === 'completed' ? 'success' : t.status === 'in_progress' ? 'accent' : 'secondary'} size="sm" />
          <StackItem size="fill">
            <Text color={t.status === 'completed' ? 'secondary' : undefined} weight={t.status === 'in_progress' ? 'medium' : undefined}>{t.content}</Text>
          </StackItem>
          <Text type="supporting" color="secondary">{t.status === 'completed' ? 'Done' : t.status === 'in_progress' ? 'In progress' : 'Pending'}</Text>
        </HStack>
      ))}
    </VStack>
  )
}

/** One subagent's full transcript, live while it runs, with its approvals. */
export function SubagentTab({ subagentId }: { subagentId: string }) {
  const { subagentViews, items, actions, answer } = usePanelConversation()
  const view = subagentViews.find((v) => v.subagentId === subagentId)
  if (!view) return <EmptyState title="Subagent not found" description="It is not part of this chat any more." headingLevel={2} />
  const waiting = actions.get(subagentId) ?? []
  return (
    <SubagentItems.Provider value={items}>
      <SubagentActions.Provider value={actions}>
        <VStack gap={3} data-testid="subagent-tab">
          {waiting.length > 0 && <Waiting actions={waiting} answer={answer} />}
          <SubagentTranscript view={view} />
        </VStack>
      </SubagentActions.Provider>
    </SubagentItems.Provider>
  )
}
