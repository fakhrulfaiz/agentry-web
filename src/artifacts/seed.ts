/**
 * The "Make something new" tiles on the Artifacts page. Each opens a new chat
 * (`/?seed=<id>`) whose composer starts with the tile's slash command.
 */
export type ArtifactSeedId = 'docs' | 'slides' | 'data'

export const ARTIFACT_SEEDS: Record<ArtifactSeedId, string> = {
  docs: '/office-docx ',
  slides: '/office-pptx ',
  data: '/office-xlsx ',
}

/** The composer prefill for a `seed` query value, or `null` when it names no seed. */
export function seedText(seed: string | null | undefined): string | null {
  return seed && Object.hasOwn(ARTIFACT_SEEDS, seed) ? ARTIFACT_SEEDS[seed as ArtifactSeedId] : null
}

/** New-chat URL carrying a seed. */
export const seedHref = (id: ArtifactSeedId): string => `/?seed=${id}`
