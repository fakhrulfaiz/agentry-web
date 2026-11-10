/**
 * Mapping what the backend knows about a session's workspace files onto the
 * `Artifact` the Artifacts page shows: a display name, a MIME type from the
 * file name, the session's title, and the `/v1` API path of the bytes.
 */
import type { Artifact, OAIAgentSession, SessionArtifactEntry, SessionDeliverableList } from '@/api/types'
import { contentTypeForName } from './kind'
import { sessionTitle } from '@/ui/shell/group'

/** The `/v1` API path of one entry's bytes, for `Artifact.content_url`. */
export function artifactContentUrl(sessionId: string, path: string): string {
  return `/v1/agents/sessions/${encodeURIComponent(sessionId)}/artifacts/${path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')}`
}

/**
 * Cards for a deliverables listing. Files outside the workspace (absolute
 * paths) cannot be fetched through the artifacts content route and are dropped.
 */
export function deliverableEntries(list: SessionDeliverableList): SessionArtifactEntry[] {
  return list.data
    .filter((entry) => !entry.path.startsWith('/'))
    .map((entry) => ({
      path: entry.path,
      last_modified: new Date(entry.created_at * 1000).toISOString(),
      ...(entry.description ? { description: entry.description } : {}),
    }))
}

export function toArtifact(session: OAIAgentSession, entry: SessionArtifactEntry): Artifact {
  const name = entry.path.split('/').pop() ?? entry.path
  return {
    id: `${session.id}:${entry.path}`,
    name,
    path: entry.path,
    size: entry.size ?? 0,
    mime_type: contentTypeForName(name),
    session_id: session.id,
    session_title: sessionTitle(session) || undefined,
    updated_at: entry.last_modified ?? '',
    content_url: artifactContentUrl(session.id, entry.path),
    ...(entry.description ? { description: entry.description } : {}),
  }
}
