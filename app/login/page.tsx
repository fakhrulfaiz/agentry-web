import { Button } from '@astryxdesign/core/Button'
import { Card } from '@astryxdesign/core/Card'
import { Center } from '@astryxdesign/core/Center'
import { Heading } from '@astryxdesign/core/Heading'
import { Text } from '@astryxdesign/core/Text'
import { VStack } from '@astryxdesign/core/VStack'
import { redirect } from 'next/navigation'
import { getConfig } from '@/config/env'
import { signIn } from '@/server/authjs'
import { getSession, publicIdentity } from '@/server/session'
import { ApiKeyForm } from '@/ui/auth/ApiKeyForm'

export const dynamic = 'force-dynamic'

async function signInWithKeycloak() {
  'use server'
  await signIn('keycloak', { redirectTo: '/' })
}

export default async function LoginPage() {
  if (publicIdentity(await getSession())) redirect('/')
  const { auth } = getConfig()

  return (
    <Center axis="both" padding={6} minHeight="100dvh">
      <VStack gap={4} hAlign="stretch" width="100%" maxWidth={400}>
        <VStack gap={1} hAlign="center">
          <Heading level={1}>Agentry</Heading>
          <Text type="supporting">Sign in to continue</Text>
        </VStack>
        <Card padding={6} width="100%">
          {auth === 'apikey' ? (
            <ApiKeyForm />
          ) : (
            <form action={signInWithKeycloak}>
              <Button type="submit" variant="primary" label="Sign in with Keycloak" width="100%" />
            </form>
          )}
        </Card>
      </VStack>
    </Center>
  )
}
