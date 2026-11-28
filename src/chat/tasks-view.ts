'use client'

/** The Tasks tab's Flow / List choice, remembered in localStorage and shared by the tab and the composer's Helpers button. */
import { useSyncExternalStore } from 'react'

export type TasksView = 'flow' | 'list'
const KEY = 'agentry_tasks_view'
let current: TasksView | null = null
const listeners = new Set<() => void>()

function read(): TasksView {
  if (current) return current
  try {
    current = localStorage.getItem(KEY) === 'list' ? 'list' : 'flow'
  } catch {
    current = 'flow'
  }
  return current
}

export function setTasksView(view: TasksView): void {
  current = view
  try {
    localStorage.setItem(KEY, view)
  } catch {
    /* storage unavailable */
  }
  listeners.forEach((l) => l())
}

export function useTasksView(): TasksView {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => void listeners.delete(cb)
    },
    read,
    () => 'flow',
  )
}
