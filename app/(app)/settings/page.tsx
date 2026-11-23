import { VStack } from '@astryxdesign/core/VStack'
import { cookies } from 'next/headers'
import { requirePageSession } from '@/server/require-auth'
import { MODEL_COOKIE } from '@/ui/chat/model-cookie'
import { SettingsNav } from '@/ui/settings/SettingsNav'
import { SettingsForm } from '@/ui/settings/SettingsForm'
import { TopBar } from '@/ui/shell/TopBar'
import { parseThemeMode, THEME_COOKIE } from '@/ui/theme/theme-cookie'

export const dynamic = 'force-dynamic'

function decodeCookie(value: string | undefined): string | null {
  if (!value) return null
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export default async function SettingsPage() {
  const { identity } = await requirePageSession()
  const jar = await cookies()
  return (
    <VStack>
      <TopBar title="Settings" />
      <SettingsNav />
      <SettingsForm
        identity={identity}
        theme={parseThemeMode(jar.get(THEME_COOKIE)?.value)}
        model={decodeCookie(jar.get(MODEL_COOKIE)?.value)}
      />
    </VStack>
  )
}
