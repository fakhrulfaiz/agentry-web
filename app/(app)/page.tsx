import { Center } from '@astryxdesign/core/Center'
import { VStack } from '@astryxdesign/core/VStack'
import { Wordmark } from '@/ui/brand/Wordmark'
import { TopBar } from '@/ui/shell/TopBar'

// Placeholder inside the shell; Task 8 replaces it with the new-chat empty state.
export default function Home() {
  return (
    <VStack height="100%">
      <TopBar title="New chat" />
      <Center axis="both" padding={6} minHeight="60dvh">
        <Wordmark size="lg" />
      </Center>
    </VStack>
  )
}
