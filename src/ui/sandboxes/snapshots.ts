/** Plain words for snapshot levels and states (the Snapshots tab and its dialogs). */
import type { EnvironmentSnapshot, SnapshotLevel } from '@/api/types'

export const LEVEL_ORDER: readonly SnapshotLevel[] = ['workspace', 'disk', 'memory']

/** The level as a short label in a list row. */
export const levelShort: Record<SnapshotLevel, string> = {
  workspace: 'Files only',
  disk: 'Whole sandbox',
  memory: 'Running state',
}

/** The level as a choice in the save dialog. */
export const levelChoice: Record<SnapshotLevel, { label: string; description: string }> = {
  workspace: { label: 'Files only', description: 'The files in the workspace. Software comes from the template.' },
  disk: { label: 'Whole sandbox, including installed software', description: 'Everything on the sandbox disk.' },
  memory: { label: 'Running state', description: 'The disk and the programs that are running now.' },
}

/** What restoring replaces, for the confirmation. */
export const restoreWarning = (level: SnapshotLevel): string =>
  level === 'workspace'
    ? 'Replaces the files in this sandbox with the snapshot. Changes made since are lost.'
    : 'Rebuilds this sandbox from the snapshot. Programs running now stop.'

/** True while any snapshot is still being written (the list polls). */
export const anySaving = (snaps: readonly EnvironmentSnapshot[]): boolean => snaps.some((s) => s.state === 'saving')
