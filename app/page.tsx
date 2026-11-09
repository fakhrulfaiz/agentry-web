import { Button } from '@astryxdesign/core/Button'
import { Center } from '@astryxdesign/core/Center'
import { Heading } from '@astryxdesign/core/Heading'
import { VStack } from '@astryxdesign/core/VStack'
import * as stylex from '@stylexjs/stylex'

// Placeholder home page; Task 7 moves it into the app shell and Task 8 replaces it.
const styles = stylex.create({
  page: { minBlockSize: '100dvh' },
})

export default function Home() {
  return (
    <Center xstyle={styles.page}>
      <VStack gap={4} align="center">
        <Heading level={1}>Agentry</Heading>
        <Button label="New chat" variant="primary" />
      </VStack>
    </Center>
  )
}
