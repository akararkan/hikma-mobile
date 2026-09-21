/* =========================================================
   The unmatched route.

   Reachable two ways: a deep link to something that no longer
   exists, and a link the app itself built wrong. Both deserve
   a way out rather than a dead end, so this offers Home
   explicitly instead of relying on a back gesture that may
   have nothing behind it.
   ========================================================= */
import React from 'react'
import { useRouter } from 'expo-router'
import { EmptyState, Header, Screen } from '@/ui'

export default function NotFound() {
  const router = useRouter()
  return (
    <Screen>
      <Header back={router.canGoBack()} title="Not found" />
      <EmptyState
        icon="search"
        title="This page doesn't exist"
        message="The link may be broken, or the content may have been removed."
        actionLabel="Go home"
        onAction={() => router.replace('/(app)/(tabs)')}
      />
    </Screen>
  )
}
