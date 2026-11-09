import type { RecordStatus, TrajectoryRecord } from './build-trajectory'

/**
 * The kind chip of a record: its own colour per kind, so rows are told apart
 * at a glance (ledger, inspector header, and the overview lanes). An
 * Assistant step that only thought (no text) is a Thinking chip.
 */
export type ChipKind = 'user' | 'assistant' | 'thinking' | 'tool' | 'subtool' | 'system'
export type ChipColor = 'blue' | 'teal' | 'purple' | 'orange' | 'pink' | 'gray'

export const CHIP: Record<ChipKind, { label: string; color: ChipColor }> = {
  user: { label: 'USER', color: 'blue' },
  assistant: { label: 'ASSISTANT', color: 'teal' },
  thinking: { label: 'THINKING', color: 'purple' },
  tool: { label: 'TOOL', color: 'orange' },
  subtool: { label: 'SUBTOOL', color: 'pink' },
  system: { label: 'SYSTEM', color: 'gray' },
}

export function chipKind(r: TrajectoryRecord): ChipKind {
  if (r.kind === 'subtool') return 'subtool'
  if (r.kind === 'assistant') return typeof r.output === 'string' && r.output.trim() ? 'assistant' : r.thinking ? 'thinking' : 'assistant'
  return r.kind
}

export const SUB_LABEL: Record<'user' | 'assistant' | 'tool', string> = { user: 'User', assistant: 'Assistant', tool: 'Tool' }

export const STATUS: Record<RecordStatus, { label: string; color: 'green' | 'red' | 'gray' }> = {
  pending: { label: 'Pending', color: 'gray' },
  completed: { label: 'Completed', color: 'green' },
  failed: { label: 'Failed', color: 'red' },
}

/** The record's name: the tool name, `Step N`, or the kind. */
export function recordName(r: TrajectoryRecord): string {
  if (r.name) return r.name
  if (r.step !== undefined) return `Step ${r.step}`
  return r.subKind ? SUB_LABEL[r.subKind] : 'User'
}
