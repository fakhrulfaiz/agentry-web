import type { SandboxEnvironment, SandboxPlace, SandboxTemplate } from '@/api/types'
import { environmentLook, placeKindTitle, setupProgressText } from './format'

export type StatusVariant = 'success' | 'warning' | 'error' | 'neutral'

/** "5 min", "2 h", "3 days" for a span of seconds. */
export function span(seconds: number): string {
  const minutes = Math.max(0, Math.floor(seconds / 60))
  if (minutes < 1) return 'under a minute'
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} h`
  const days = Math.floor(hours / 24)
  return `${days} ${days === 1 ? 'day' : 'days'}`
}

/** "just now", "5 min ago", "2 h ago", "3 days ago" for a time in seconds since the epoch. */
export function ago(seconds: number, now = Date.now()): string {
  const s = Math.floor(now / 1000) - seconds
  return s < 60 ? 'just now' : `${span(s)} ago`
}

/** The machine's name on a card: unnamed local ones are the server's own workspace. */
export const cardName = (env: Pick<SandboxEnvironment, 'name' | 'provider'>): string =>
  env.name || (env.provider === 'local' ? 'Server workspace' : 'Untitled sandbox')

export const isLocal = (env: SandboxEnvironment): boolean => env.provider === 'local'

/** Running, setting up or being deleted. */
export const isLive = (env: SandboxEnvironment): boolean => {
  const state = env.sandbox?.state
  if (state === undefined) return env.status === 'connected' || env.status === 'pending'
  return state === 'running' || state === 'provisioning' || state === 'deleting'
}

/** The sections of the list, in order; empty ones are left out by the caller. */
export function groupEnvironments(envs: SandboxEnvironment[]): { running: SandboxEnvironment[]; stopped: SandboxEnvironment[]; server: SandboxEnvironment[] } {
  const out = { running: [] as SandboxEnvironment[], stopped: [] as SandboxEnvironment[], server: [] as SandboxEnvironment[] }
  for (const env of envs) {
    if (isLocal(env)) out.server.push(env)
    else if (isLive(env)) out.running.push(env)
    else out.stopped.push(env)
  }
  return out
}

/** "3 running, 1 stopped, 1 on this server"; only the non-zero parts. */
export function summarize(envs: SandboxEnvironment[]): string {
  const g = groupEnvironments(envs)
  return [
    g.running.length > 0 ? `${g.running.length} running` : '',
    g.stopped.length > 0 ? `${g.stopped.length} stopped` : '',
    g.server.length > 0 ? `${g.server.length} on this server` : '',
  ].filter(Boolean).join(', ')
}

/** Where an environment runs, in words: the place's name, else the provider. */
export function whereText(env: SandboxEnvironment, places: SandboxPlace[]): string | null {
  if (isLocal(env)) return 'this server'
  const place = places.find((p) => p.id === env.sandbox?.place)
  return place?.name ?? env.sandbox?.place ?? null
}

/** The status line: "Running for 2 h, on Docker", "Stopped, last used 3 h ago", "Failed: reason". */
export function statusLine(env: SandboxEnvironment, places: SandboxPlace[], now = Date.now(), withWhere = true): { variant: StatusVariant; text: string; busy: boolean } {
  const look = environmentLook(env)
  const sb = env.sandbox
  const state = sb?.state
  const at = withWhere && !isLocal(env) ? whereText(env, places) : null
  const where = at ? `, on ${at}` : ''
  if (state === 'provisioning' || (state === undefined && env.status === 'pending')) {
    const detail = sb?.progress ? `: ${setupProgressText(sb.progress).replace(/…$/u, '')}` : ''
    return { variant: look.variant, text: `Setting up${detail}${where}`, busy: true }
  }
  if (state === 'failed' || (state === undefined && env.status === 'failed')) {
    return { variant: 'error', text: env.error ? `Failed: ${env.error}` : 'Failed', busy: false }
  }
  if (state === 'running') {
    const since = sb?.started_at ? ` for ${span(Math.floor(now / 1000) - sb.started_at)}` : ''
    return { variant: 'success', text: `Running${since}${where}`, busy: false }
  }
  if (state === 'stopped') {
    const used = sb?.last_used_at ? `, last used ${ago(sb.last_used_at, now)}` : ''
    return { variant: 'neutral', text: `Stopped${used}${where}`, busy: false }
  }
  return { variant: look.variant, text: `${look.text}${where}`, busy: state === 'deleting' }
}

/** The last path segment of an image: `ghcr.io/x/agentry-sandbox:1` becomes `agentry-sandbox:1`. */
export const imageShort = (image: string): string => image.split('/').pop() || image

export const memoryText = (memoryMb: number): string => (memoryMb >= 1024 ? `${Math.round((memoryMb / 1024) * 10) / 10} GB` : `${memoryMb} MB`)

export const internetText = (access: SandboxTemplate['network']['access'] | undefined): string | null =>
  access === 'enabled' ? 'Internet on' : access === 'disabled' ? 'Internet off' : access === 'restricted' ? 'Some sites' : null

/** The facts of a card or the About list that come from the template. */
export function templateFacts(t: SandboxTemplate | undefined): { cpu: string | null; memory: string | null; internet: string | null } {
  return {
    cpu: t?.resources?.cpus ? `${t.resources.cpus} CPU` : null,
    memory: t?.resources?.memory_mb ? memoryText(t.resources.memory_mb) : null,
    internet: internetText(t?.network.access),
  }
}

export const placeKindText = (place: SandboxPlace | undefined): string | null => (place ? placeKindTitle(place.kind) : null)
