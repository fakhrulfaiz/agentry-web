import { Token } from '@astryxdesign/core/Token'
import type { TrajectoryRecord } from './build-trajectory'
import { CHIP, chipKind } from './labels'

/** The coloured kind chip of a record. */
export function KindChip({ record }: { record: TrajectoryRecord }) {
  const kind = chipKind(record)
  const chip = CHIP[kind]
  return <Token size="sm" label={chip.label} color={chip.color} data-kind={kind} data-color={chip.color} data-testid="kind-chip" />
}
