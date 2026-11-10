'use client'

import { Banner } from '@astryxdesign/core/Banner'
import type { MessageView } from '@/chat/reducer'

type CommandView = Extract<MessageView, { kind: 'command' }>

/** The outcome of a backend slash command (`/compact`, `/goal`, ...): the command line as the title, its output below. Human-only: the model never sees it. */
export function CommandResult({ view }: { view: CommandView }) {
  return (
    <Banner
      status={view.ok ? 'info' : 'error'}
      title={`/${view.name}${view.args ? ` ${view.args}` : ''}`}
      description={view.text ?? (view.ok ? 'Done' : 'The command failed')}
    />
  )
}
