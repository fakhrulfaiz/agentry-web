'use client'

/**
 * A skill opened from its card: SKILL.md rendered, every file listed, and any
 * file (scripts included) shown with syntax highlighting.
 */
import { Banner } from '@astryxdesign/core/Banner'
import { CodeBlock } from '@astryxdesign/core/CodeBlock'
import { Drawer } from '@astryxdesign/core/Drawer'
import { HStack } from '@astryxdesign/core/HStack'
import { List, ListItem } from '@astryxdesign/core/List'
import { Skeleton } from '@astryxdesign/core/Skeleton'
import { Text } from '@astryxdesign/core/Text'
import { Token } from '@astryxdesign/core/Token'
import { VStack } from '@astryxdesign/core/VStack'
import { useEffect, useState } from 'react'
import { api } from '@/api/client'
import type { SkillView } from '@/api/types'
import { Markdown } from '@/ui/chat/Markdown'
import { IconTile } from '@/ui/shared/IconTile'
import { formatSize } from './SkillDialogs'
import { languageOf, skillVisual } from './skill-visual'

const bodyOf = (text: string): string => text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/u, '')
const KIND_LABEL = { builtin: 'Built-in', library: 'Library', private: 'This agent only' } as const

export function SkillDetail({ name, description, onClose }: { name: string | null; description?: string; onClose(): void }) {
  const [view, setView] = useState<SkillView | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  const [file, setFile] = useState<{ path: string; content?: string; error?: string } | null>(null)

  useEffect(() => {
    setView(null)
    setUnavailable(false)
    setFile(null)
    if (!name) return
    let alive = true
    api.viewSkill(name).then((v) => alive && setView(v), () => alive && setUnavailable(true))
    return () => { alive = false }
  }, [name])

  const open = (path: string) => {
    if (!name) return
    if (path === 'SKILL.md') return setFile(null)
    setFile({ path })
    api.readSkillFile(name, path).then(
      (f) => setFile({ path, content: f.content }),
      (e: unknown) => setFile({ path, error: e instanceof Error ? e.message : 'This file cannot be shown.' }),
    )
  }

  const visual = skillVisual({ name: name ?? '', kind: view?.kind ?? 'builtin' })
  return (
    <Drawer isOpen={name !== null} onOpenChange={(o) => !o && onClose()} label={name ? `Skill ${name}` : 'Skill'} width={720} padding={5}>
      {name && (
        <VStack gap={4}>
          <HStack gap={3} vAlign="center">
            <IconTile icon={visual.icon} hue={visual.hue} size="lg" />
            <VStack gap={0}>
              <Text weight="medium" size="lg">/{name}</Text>
              {view && <HStack><Token label={KIND_LABEL[view.kind]} size="sm" /></HStack>}
            </VStack>
          </HStack>
          <Text color="secondary">{view?.description ?? description}</Text>
          {unavailable ? (
            <Banner status="info" title="This skill comes with Agentry's runtime; its files are not shown here." />
          ) : !view ? (
            <Skeleton height={240} />
          ) : (
            <>
              <List density="compact" hasDividers header={<Text weight="medium">Files</Text>}>
                {view.files.map((f) => (
                  <ListItem
                    key={f.path}
                    label={f.path}
                    isSelected={(file?.path ?? 'SKILL.md') === f.path}
                    onClick={() => open(f.path)}
                    endContent={<Text type="supporting" color="secondary">{formatSize(f.bytes)}</Text>}
                  />
                ))}
              </List>
              {file === null ? (
                <VStack gap={2}>
                  <Text weight="medium">SKILL.md</Text>
                  <Markdown text={bodyOf(view.skill_md)} />
                </VStack>
              ) : file.error ? (
                <Banner status="warning" title={file.error} />
              ) : file.content === undefined ? (
                <Skeleton height={160} />
              ) : (
                <CodeBlock code={file.content} language={languageOf(file.path)} title={file.path} hasLineNumbers />
              )}
            </>
          )}
        </VStack>
      )}
    </Drawer>
  )
}
