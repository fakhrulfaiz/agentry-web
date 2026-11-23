/** How the agent will look in the Agents list and the new-chat agent menu, updated as the form changes. */
import { Card } from '@astryxdesign/core/Card'
import { HStack } from '@astryxdesign/core/HStack'
import { Text } from '@astryxdesign/core/Text'
import { VStack } from '@astryxdesign/core/VStack'
import type { AgentForm } from '@/agents/form'
import { AgentAvatar } from './AgentAvatar'

/** One-line summaries of what the agent can use. */
export function capabilityFacts(form: AgentForm): string[] {
  const apps = Object.keys(form.apps ?? {})
  return [
    form.allTools ? 'All tools' : `${String(form.tools.length)} ${form.tools.length === 1 ? 'tool' : 'tools'}`,
    form.skills === null ? 'Built-in skills' : `${String(form.skills.builtin.length + form.skills.library.length)} skills`,
    form.apps === null ? 'Any connected app' : apps.length === 0 ? 'No apps' : apps.join(', '),
    ...(form.subagents ? [`Up to ${String(form.maxSubagents)} subagents`] : []),
  ]
}

export function AgentPreview({ form }: { form: AgentForm }) {
  const firstLine = form.instructions.split('\n').find((l) => l.trim())?.trim()
  return (
    <VStack gap={2}>
      <Text type="supporting" color="secondary">Preview</Text>
      <Card padding={4} elevation="low">
        <VStack gap={3}>
          <HStack gap={3} vAlign="center">
            <AgentAvatar avatar={{ icon: form.icon, color: form.color }} size="md" />
            <VStack gap={0}>
              <Text weight="medium" maxLines={1}>{form.name.trim() || 'Untitled agent'}</Text>
              <Text type="supporting" color="secondary" maxLines={1}>{form.model || 'No model'}</Text>
            </VStack>
          </HStack>
          <Text type="supporting" color="secondary" maxLines={3}>{firstLine ?? 'Instructions you write show here.'}</Text>
          <VStack gap={1}>
            {capabilityFacts(form).map((fact) => (
              <Text key={fact} type="supporting" maxLines={1}>{fact}</Text>
            ))}
          </VStack>
        </VStack>
      </Card>
    </VStack>
  )
}
