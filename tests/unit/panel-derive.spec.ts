import { describe, expect, it } from 'vitest'
import type { OAIApprovalAction, OAISubagent, OAITurn } from '@/api/types'
import type { MessageView } from '@/chat/reducer'
import { deriveTasks } from '@/chat/tasks'
import { deriveTodos, todoCount } from '@/chat/todos'

const tool = (id: string, name: string, args: unknown, output?: unknown, status: 'running' | 'done' = 'done'): MessageView => ({ kind: 'tool', id, callId: id, name, args, status, output })
const list = (...s: string[]) => ({ todos: s.map((status, i) => ({ content: `t${String(i)}`, status })) })

describe('deriveTodos', () => {
  it('is empty without a todo call', () => {
    expect(deriveTodos([tool('a', 'bash', { cmd: 'ls' })])).toEqual([])
  })
  it('takes the latest todo_write, from its arguments while it runs', () => {
    const items = [tool('a', 'todo_write', list('pending')), tool('b', 'bash', {}), tool('c', 'todo_write', list('completed', 'in_progress'), undefined, 'running')]
    expect(deriveTodos(items)).toEqual([
      { content: 't0', status: 'completed' },
      { content: 't1', status: 'in_progress' },
    ])
  })
  it('prefers the echoed output, accepts JSON text and a namespaced name', () => {
    const out = JSON.stringify({ todos: [{ content: 'x', status: 'completed' }], counts: {} })
    expect(deriveTodos([tool('a', 'mcp__todo_write', list('pending'), out)])).toEqual([{ content: 'x', status: 'completed' }])
  })
  it('drops malformed entries and counts done/total', () => {
    const todos = deriveTodos([tool('a', 'todo_write', { todos: [{ content: 'ok', status: 'completed' }, { content: 'bad', status: 'x' }, 3] })])
    expect(todos).toHaveLength(1)
    expect(todoCount(todos)).toBe('1/1')
    expect(todoCount([])).toBeNull()
  })
})

describe('deriveTasks', () => {
  const view = (id: string, status: string): MessageView => ({ kind: 'subagent', id: `v${id}`, sessionId: 's', subagentId: id, name: `n${id}`, status, startedAt: 10, model: 'm' })
  const run = (id: string, status: 'active' | 'closed', tokens: number[]) => ({
    subagent: { id, status } as OAISubagent,
    turns: tokens.map((total_tokens) => ({ usage: { total_tokens } }) as OAITurn),
  })
  it('maps statuses, sums tokens and counts waiting actions', () => {
    const actions = new Map([['b', [{ id: 'x' } as OAIApprovalAction]]])
    const rows = deriveTasks([view('a', 'in_progress'), view('b', 'completed'), view('c', 'failed'), view('d', 'completed'), { kind: 'user', id: 'u', text: '' }], [run('b', 'active', [5, 7]), run('d', 'closed', [])], actions)
    expect(rows.map((r) => [r.id, r.status, r.tokens, r.waiting])).toEqual([
      ['a', 'running', undefined, 0],
      ['b', 'done', 12, 1],
      ['c', 'failed', undefined, 0],
      ['d', 'closed', undefined, 0],
    ])
  })
})
