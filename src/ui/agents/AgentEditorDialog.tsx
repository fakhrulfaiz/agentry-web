'use client'

/** The agent editor in a wide dialog; closes on Escape, the close button or Cancel. */
import { Dialog } from '@astryxdesign/core/Dialog'
import { AgentForm } from './AgentForm'

/** `draft`: the new agent starts from the held draft (`src/agents/draft.ts`). */
export type EditorTarget = { kind: 'new'; draft?: boolean } | { kind: 'edit'; agentId: string }

export function AgentEditorDialog({ target, onClose, onSaved }: {
  target: EditorTarget | null
  onClose(): void
  onSaved(change: 'created' | 'updated' | 'deleted'): void
}) {
  return (
    <Dialog isOpen={target !== null} onOpenChange={(open) => !open && onClose()} width="min(1180px, 96vw)" maxHeight="94dvh" padding={0} purpose="form" aria-label="Agent editor">
      {target && (
        <AgentForm
          key={target.kind === 'edit' ? target.agentId : `new${target.draft ? '-draft' : ''}`}
          agentId={target.kind === 'edit' ? target.agentId : undefined}
          fromDraft={target.kind === 'new' && target.draft === true}
          onClose={onClose}
          onSaved={onSaved}
        />
      )}
    </Dialog>
  )
}

/** The editor the Agents page URL asks for: `?new=1` (plus `&draft=1` for the held draft) or `?agent=<id>`. */
export function editorTargetOf(params: URLSearchParams): EditorTarget | null {
  const agent = params.get('agent')
  if (agent) return { kind: 'edit', agentId: agent }
  if (!params.has('new')) return null
  return params.has('draft') ? { kind: 'new', draft: true } : { kind: 'new' }
}
