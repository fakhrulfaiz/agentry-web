'use client'

/** The open conversation's state the preview panel's Tasks, Plan and subagent tabs read (provided by `Conversation`, never refetched). */
import { createContext, useContext } from 'react'
import type { OAIApprovalAction, OAIJob, StoredSessionItem } from '@/api/types'
import { EMPTY_BROWSER, type BrowserState } from './browser-tools'
import type { TaskRow } from './tasks'
import type { SubagentView } from './tasks'
import type { Todo } from './todos'
import type { ActionAnswer } from './use-conversation'

export interface PanelConversation {
  tasks: TaskRow[]
  /** Background jobs (commands the agent runs in the background), oldest first. */
  jobs: OAIJob[]
  subagentViews: SubagentView[]
  todos: Todo[]
  /** The web browser's page, screenshot and history (Browser tab). */
  browser: BrowserState
  items: ReadonlyMap<string, StoredSessionItem[]>
  actions: ReadonlyMap<string, OAIApprovalAction[]>
  answer(actionId: string, a: ActionAnswer): Promise<void>
}

export const PanelConversationContext = createContext<PanelConversation>({
  tasks: [],
  jobs: [],
  subagentViews: [],
  todos: [],
  browser: EMPTY_BROWSER,
  items: new Map(),
  actions: new Map(),
  answer: async () => {},
})

export const usePanelConversation = () => useContext(PanelConversationContext)
