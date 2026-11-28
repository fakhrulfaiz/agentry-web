'use client'

/** Composer button that opens the side panel's Tasks tab in Flow view; shown once the chat has a helper (subagent), with a dot (green running, amber needs you) and the running count. */
import { Icon } from '@astryxdesign/core/Icon'
import { IconButton } from '@astryxdesign/core/IconButton'
import { StatusDot } from '@astryxdesign/core/StatusDot'
import { Text } from '@astryxdesign/core/Text'
import { spacingVars } from '@astryxdesign/core/theme/tokens.stylex'
import * as stylex from '@stylexjs/stylex'
import { usePanelConversation } from '@/chat/panel-data'
import { setTasksView } from '@/chat/tasks-view'
import { usePreviewPanel } from '@/preview/store'
import { WorkflowIcon } from '@/ui/icons/WorkflowIcon'

const styles = stylex.create({
  wrap: { position: 'relative', display: 'inline-flex', alignItems: 'center', gap: spacingVars['--spacing-1'] },
  dot: { position: 'absolute', insetBlockStart: spacingVars['--spacing-1'], insetInlineStart: spacingVars['--spacing-5'], pointerEvents: 'none' },
})

export function HelpersButton() {
  const { tasks } = usePanelConversation()
  const { actions } = usePreviewPanel()
  if (tasks.length === 0) return null
  const running = tasks.filter((t) => t.status === 'running').length
  const needs = tasks.filter((t) => t.waiting > 0).length
  const label = needs > 0 ? `Helpers: ${needs} need${needs === 1 ? 's' : ''} you` : running > 0 ? `Helpers: ${running} running` : 'Helpers'
  return (
    <span {...stylex.props(styles.wrap)}>
      <IconButton
        label={label}
        tooltip="Helpers"
        variant="ghost"
        size="sm"
        icon={<Icon icon={WorkflowIcon} size="sm" />}
        onClick={() => {
          setTasksView('flow')
          actions.openView('tasks', 'Tasks')
        }}
      />
      {(needs > 0 || running > 0) && (
        <span data-testid="helpers-dot" data-state={needs > 0 ? 'needs' : 'running'} {...stylex.props(styles.dot)}>
          <StatusDot variant={needs > 0 ? 'warning' : 'success'} label={needs > 0 ? 'Needs you' : 'Running'} isPulsing={needs === 0} />
        </span>
      )}
      {running > 0 && <Text type="supporting" color="secondary" hasTabularNumbers aria-hidden="true">{running}</Text>}
    </span>
  )
}
