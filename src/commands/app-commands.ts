/**
 * Commands the web app runs itself (the `/` menu's "App" group). They never go
 * to Agentry or the model and never enter the chat history.
 */
export type AppCommandName = 'new' | 'clear' | 'model' | 'effort' | 'rename'

export interface AppCommand {
  name: AppCommandName
  description: string
  /** Placeholder for the optional text after the name. */
  hint?: string
}

/** All app commands, in menu order. A chat page offers the ones it has a handler for. */
export const APP_COMMANDS: readonly AppCommand[] = [
  { name: 'new', description: 'Start a new chat', hint: 'message' },
  { name: 'model', description: 'Change the model', hint: 'model' },
  { name: 'effort', description: 'Change the reasoning effort', hint: 'low, medium, high or auto' },
  { name: 'clear', description: 'Start a new chat' },
  { name: 'rename', description: 'Rename this chat' },
]

/** What the composer lets a handler do. */
export interface AppCommandContext {
  /** Opens the model or reasoning-effort menu of the composer; false when it is not available. */
  openMenu(menu: 'model' | 'effort'): boolean
}

/** Runs an app command with the text after its name (`''` when none). A returned string is shown as a notice. */
export type AppCommandHandler = (arg: string, context: AppCommandContext) => string | void | Promise<string | void>

/** The handlers a page provides; commands without one are not offered. */
export type AppCommandHandlers = Partial<Record<AppCommandName, AppCommandHandler>>

/** A refused app command: the message is shown and the typed text stays. */
export class AppCommandError extends Error {}

/** `/name rest` → `{ name, arg }`, or `null` when the text is not a slash command line. */
export function parseSlashLine(text: string): { name: string; arg: string } | null {
  const match = /^\/([a-z][a-z0-9_-]*)(?:\s+([\s\S]*))?$/u.exec(text.trim())
  return match ? { name: match[1], arg: (match[2] ?? '').trim() } : null
}

/**
 * The model named by `/model <id>`.
 * @param offered - models the page offers; `null` while loading.
 * @throws AppCommandError when the list is not loaded or does not contain `id`.
 */
export function chooseModel(id: string, offered: readonly string[] | null): string {
  if (offered === null) throw new AppCommandError('Models are still loading. Try again in a moment.')
  if (!offered.includes(id)) throw new AppCommandError(`Unknown model "${id}".`)
  return id
}

/**
 * The effort named by `/effort <value>`.
 * @param allowed - choices the page offers (all when `undefined`).
 * @throws AppCommandError when `value` is not one of them.
 */
export function chooseEffort(value: string, allowed: readonly string[] | undefined): 'auto' | 'low' | 'medium' | 'high' {
  const key = value.toLowerCase()
  if (!['auto', 'low', 'medium', 'high'].includes(key) || (allowed && !allowed.includes(key))) {
    throw new AppCommandError(`Unknown effort "${value}". Use ${(allowed ?? ['auto', 'low', 'medium', 'high']).join(', ')}.`)
  }
  return key as 'auto' | 'low' | 'medium' | 'high'
}
