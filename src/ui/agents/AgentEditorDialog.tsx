'use client'

/** The agent editor in a wide dialog; closes on Escape, the close button or Cancel. */
import { Dialog } from '@astryxdesign/core/Dialog'
import { AgentForm } from './AgentForm'

export type EditorTarget = { kind: 'new'; starterId?: string } | { kind: 'edit'; agentId: string }

export function AgentEditorDialog({ target, onClose, onSaved }: {
  target: EditorTarget | null
  onClose(): void
  onSaved(change: 'created' | 'updated' | 'deleted'): void
}) {
  return (
    <Dialog isOpen={target !== null} onOpenChange={(open) => !open && onClose()} width="min(1180px, 96vw)" maxHeight="94dvh" padding={0} purpose="form" aria-label="Agent editor">
      {target && (
        <AgentForm
          key={target.kind === 'edit' ? target.agentId : `new-${target.starterId ?? ''}`}
          agentId={target.kind === 'edit' ? target.agentId : undefined}
          starterId={target.kind === 'new' ? target.starterId : undefined}
          onClose={onClose}
          onSaved={onSaved}
        />
      )}
    </Dialog>
  )
}

/** The editor the Agents page URL asks for: `?new=1`, `?starter=<id>` or `?agent=<id>`. */
export function editorTargetOf(params: URLSearchParams): EditorTarget | null {
  const agent = params.get('agent')
  if (agent) return { kind: 'edit', agentId: agent }
  const starter = params.get('starter')
  if (starter) return { kind: 'new', starterId: starter }
  return params.has('new') ? { kind: 'new' } : null
}
