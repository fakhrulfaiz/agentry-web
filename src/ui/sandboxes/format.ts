import type { SandboxEnvironment, SandboxProvider, SandboxTemplate } from '@/api/types'

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
