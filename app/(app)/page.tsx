import { Suspense } from 'react'
import { NewChat } from '@/ui/chat/NewChat'

export default function Home() {
  return (
    <Suspense>
      <NewChat />
    </Suspense>
  )
}
