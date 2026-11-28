/**
 * The agent's current to-do list, from the stream's tool items. DSH's
 * `todo_write` tool replaces the whole list on every call (`{ todos: [{ content,
 * status }] }`), so the latest call is the current list. The tool's output
 * echoes the validated list; it wins over the arguments when present.
 */
import type { MessageView } from './reducer'

export type TodoStatus = 'pending' | 'in_progress' | 'completed'
export interface Todo {
  content: string
  status: TodoStatus
}

const STATUSES = new Set<string>(['pending', 'in_progress', 'completed'])

function parse(value: unknown): Todo[] | null {
  let v = value
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v)
    } catch {
      return null
    }
  }
  const list = v && typeof v === 'object' && 'todos' in v ? (v as { todos: unknown }).todos : null
  if (!Array.isArray(list)) return null
  return list.flatMap((t): Todo[] => {
    const o = t as { content?: unknown; status?: unknown } | null
    return o && typeof o.content === 'string' && typeof o.status === 'string' && STATUSES.has(o.status) ? [{ content: o.content, status: o.status as TodoStatus }] : []
  })
}

/** @returns the list from the latest `todo_write` call in `items` (empty when there is none). */
export function deriveTodos(items: MessageView[]): Todo[] {
  for (let i = items.length - 1; i >= 0; i--) {
    const v = items[i]
    if (v.kind !== 'tool' || !/(^|[._])todo_write$/.test(v.name)) continue
    const list = (v.status === 'done' ? parse(v.output) : null) ?? parse(v.args)
    if (list) return list
  }
  return []
}

/** `done/total`, or null for an empty list. */
export function todoCount(todos: Todo[]): string | null {
  return todos.length === 0 ? null : `${String(todos.filter((t) => t.status === 'completed').length)}/${String(todos.length)}`
}
