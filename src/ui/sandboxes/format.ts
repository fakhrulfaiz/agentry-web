import type { CreateTemplateParams, SandboxEnvironment, SandboxPlace, SandboxProvider, SandboxTemplate } from '@/api/types'

/** Status dot variant and the word shown beside it. */
export function statusLook(status: SandboxEnvironment['status']): { variant: 'success' | 'warning' | 'error' | 'neutral'; text: string } {
  switch (status) {
    case 'connected': return { variant: 'success', text: 'Ready' }
    case 'pending': return { variant: 'warning', text: 'Starting' }
    case 'failed': return { variant: 'error', text: 'Failed' }
    case 'expired': return { variant: 'neutral', text: 'Expired' }
    default: return { variant: 'neutral', text: 'Disconnected' }
  }
}

type Look = { variant: 'success' | 'warning' | 'error' | 'neutral'; text: string }

/** An environment's state: the sandbox's live state when it has one, else its status. */
export function environmentLook(env: SandboxEnvironment): Look {
  switch (env.sandbox?.state) {
    case undefined: return statusLook(env.status)
    case 'running': return { variant: 'success', text: 'Running' }
    case 'stopped': return { variant: 'neutral', text: 'Stopped' }
    case 'provisioning': return { variant: 'warning', text: 'Setting up' }
    case 'deleting': return { variant: 'warning', text: 'Deleting' }
    case 'failed': return { variant: 'error', text: 'Failed' }
    case 'gone': return { variant: 'error', text: 'Gone' }
    case 'unknown': return { variant: 'warning', text: 'Unreachable' }
  }
}

/** The name people see: the given name, else "Unnamed environment". */
export const environmentName = (env: Pick<SandboxEnvironment, 'id' | 'name'>): string => env.name || 'Unnamed environment'

/** A short form of an id for secondary text: `env_6784…3a`. */
export const shortId = (id: string): string => (id.length > 14 ? `${id.slice(0, 8)}…${id.slice(-3)}` : id)

/** Whether a chat can be started in this environment (a stopped sandbox starts on send). */
export function canChatIn(env: SandboxEnvironment): boolean {
  if (env.sandbox) return env.sandbox.state === 'running' || env.sandbox.state === 'stopped'
  return env.status === 'connected'
}

/** The composer's environment menu entry: name, provider and state, e.g. "Data box · sandbox · Stopped". */
export function environmentMenuLabel(env: SandboxEnvironment): string {
  return `${environmentName(env)} (${providerTitle(env.provider)}, ${environmentLook(env).text.toLowerCase()})`
}

/** A provider in the words people use. */
export function providerTitle(name: string): string {
  return name === 'local' ? 'This server' : name === 'sandbox' ? 'Isolated sandbox' : name
}

/** A place's kind in plain words. */
export function placeKindTitle(kind: string): string {
  if (kind === 'docker') return 'Docker on this server'
  if (kind === 'docker-ssh') return 'Docker over SSH'
  if (kind === 'e2b') return 'E2B (hosted)'
  return kind === 'ssh-machine' ? 'Machine over SSH (no isolation)' : kind
}

/** "2 GPUs", "1 GPU", or null for a place without any. */
export function gpuLabel(count: number | undefined): string | null {
  return count ? `${count} ${count === 1 ? 'GPU' : 'GPUs'}` : null
}

/** The place a dialog starts on: the default one when available, else the first available. */
export function initialPlace(places: SandboxPlace[] | undefined): string {
  const usable = (places ?? []).filter((p) => p.available)
  return (usable.find((p) => p.default) ?? usable[0])?.id ?? ''
}

/** One line on what running there means. */
export function providerBlurb(name: string): string {
  if (name === 'local') return 'A folder on the Agentry server. Fast to start, uses the software the server already has.'
  if (name === 'sandbox') return 'Its own Linux container with the software you choose. Reaches the internet, never your network.'
  return 'A registered sandbox provider.'
}

const FIELD_WORDS: Record<string, string> = {
  image: 'image', packages: 'packages', setup_commands: 'setup commands', env: 'environment variables',
  network: 'internet access', files: 'starter files', resources: 'CPU and memory', plugins: 'plugins', skills: 'skills',
  capability_directories: 'capability folders',
}
/** Template fields in plain words, as one sentence fragment: "image, packages and starter files". */
export function fieldWords(fields: string[]): string {
  const words = fields.map((f) => FIELD_WORDS[f] ?? f)
  return words.length <= 1 ? (words[0] ?? 'nothing') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`
}

/** "Used 3 min ago", "Used Nov 2", or null when never used. */
export function lastUsed(seconds: number | null | undefined, now = Date.now()): string | null {
  if (!seconds) return null
  const minutes = Math.floor((now - seconds * 1000) / 60_000)
  if (minutes < 1) return 'Used just now'
  if (minutes < 60) return `Used ${minutes} min ago`
  if (minutes < 24 * 60) return `Used ${Math.floor(minutes / 60)} h ago`
  return `Used ${shortDate(seconds)}`
}

/** `1.2 KB`, `340 B`, `4 MB`. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value >= 10 ? Math.round(value) : Math.round(value * 10) / 10} ${units[unit]}`
}

/** `a, b ,, c` to `['a', 'b', 'c']`. */
export function splitList(text: string): string[] {
  return text.split(/[\n,]/u).map((item) => item.trim()).filter(Boolean)
}

/** What a provider can do, in the words a person would use. */
export function providerAbilities(provider: SandboxProvider): string[] {
  const out: string[] = []
  if (provider.capabilities.exec) out.push('Runs agent tools')
  if (provider.capabilities.files) out.push('Files')
  return out
}

/** One line describing what a template sets up. */
export function templateSummary(template: SandboxTemplate): string {
  const parts: string[] = []
  const packages = template.packages.npm.length + template.packages.python.length + template.packages.system.length
  if (template.image) parts.push(template.image)
  if (template.files.length > 0) parts.push(`${template.files.length} ${template.files.length === 1 ? 'file' : 'files'}`)
  if (packages > 0) parts.push(`${packages} ${packages === 1 ? 'package' : 'packages'}`)
  if (template.network.access !== 'enabled') parts.push(`network ${template.network.access}`)
  return parts.length > 0 ? parts.join(', ') : 'Empty workspace'
}

/** Seconds since epoch as a short local date. */
export function shortDate(seconds: number): string {
  return new Date(seconds * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

/** Base64 of a file's bytes, in chunks so a large file does not overflow the call stack. */
export async function toBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

/** The template editor's fields as typed. */
export interface TemplateForm {
  name: string
  provider: string
  image: string
  system: string
  python: string
  npm: string
  setup: string
  env: string
  network: boolean
  /** CPU cores; empty uses the service default. */
  cpus: string
  /** Memory in GB; empty uses the service default. */
  memoryGb: string
  /** Agentry Sandbox place id; empty for providers without places. */
  place?: string
  /** GPU count as typed, or `all`; empty for none. */
  gpus?: string
}

/** `KEY=value` lines to an object; returns the first bad line instead when one has no valid name. */
export function parseEnvLines(text: string): Record<string, string> | { bad: string } {
  const out: Record<string, string> = {}
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const at = line.indexOf('=')
    const key = at < 0 ? '' : line.slice(0, at).trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key)) return { bad: line }
    out[key] = line.slice(at + 1).trim()
  }
  return out
}

/**
 * The create-template body for the fields the provider applies (others are left out, so a
 * template never carries a field its provider would refuse). Errors name the field to fix.
 */
export function templateBody(form: TemplateForm, fields: string[]): { body: Omit<CreateTemplateParams, 'files'> } | { error: string } {
  const has = (f: string) => fields.includes(f)
  const body: Omit<CreateTemplateParams, 'files'> = { name: form.name.trim(), ...(form.provider ? { provider: form.provider } : {}) }
  if (!body.name) return { error: 'Give the template a name.' }
  if (has('image') && form.image.trim()) {
    if (/\s/u.test(form.image.trim())) return { error: 'The image is one name, such as python:3.13.' }
    body.image = form.image.trim()
  }
  if (has('packages')) {
    const packages = { system: splitList(form.system), python: splitList(form.python), npm: splitList(form.npm) }
    if (packages.system.length + packages.python.length + packages.npm.length > 0) body.packages = packages
  }
  if (has('setup_commands')) {
    const commands = form.setup.split('\n').map((c) => c.trim()).filter(Boolean)
    if (commands.length > 0) body.setup_commands = commands.map((command) => ({ command }))
  }
  if (has('env')) {
    const env = parseEnvLines(form.env)
    if ('bad' in env) return { error: `Environment variables are NAME=value lines; fix "${env.bad}".` }
    if (Object.keys(env).length > 0) body.env = env as Record<string, string>
  }
  if (has('network') && !form.network) body.network = { access: 'disabled' }
  if (has('resources')) {
    const cpus = form.cpus.trim() === '' ? undefined : Number(form.cpus)
    const gb = form.memoryGb.trim() === '' ? undefined : Number(form.memoryGb)
    if (cpus !== undefined && !(cpus >= 0.1 && cpus <= 64)) return { error: 'CPU cores go from 0.1 to 64.' }
    if (gb !== undefined && !(gb >= 0.125 && gb <= 256)) return { error: 'Memory goes from 0.125 to 256 GB.' }
    if (cpus !== undefined || gb !== undefined) body.resources = { ...(cpus !== undefined ? { cpus } : {}), ...(gb !== undefined ? { memory_mb: Math.round(gb * 1024) } : {}) }
  }
  if (form.place) body.place = form.place
  if (has('gpus') && form.place) {
    const raw = (form.gpus ?? '').trim().toLowerCase()
    if (raw === 'all') body.gpus = 'all'
    else if (raw !== '' && raw !== '0') body.gpus = Number(raw)
  }
  return { body }
}

/** Environment-menu values that ask for a fresh sandbox for the chat: `new:` (empty) or `new:<template id>`. */
export const NEW_SANDBOX = 'new:'

/**
 * The session's `environment` for an environment-menu choice: nothing (the default workspace), an
 * existing environment, or a fresh sandbox (from a template, or empty) that belongs to the chat.
 */
export function sessionEnvironment(choice: string): Record<string, string> | undefined {
  if (!choice) return undefined
  if (choice === NEW_SANDBOX) return { type: 'openai_hosted', provider: 'sandbox' }
  if (choice.startsWith(NEW_SANDBOX)) return { type: 'sandbox', template_id: choice.slice(NEW_SANDBOX.length) }
  return { type: 'sandbox', environment_id: choice }
}
