/* =========================================================
   Handle resolver.

   Notification deep links spell `/u/{userId}` — a UUID in the
   handle slot — so this route has to recognise one and route
   straight through, because `getByUsername(uuid)` is a
   guaranteed 404 and a wasted round trip on the way to a
   not-found screen for an account that exists.

   `replace`, never `push`: back must never return here.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router'
import { api, errorText, isNotFound } from '@/api'
import { useAsync } from '@/hooks/useAsync'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { Button, Icon, Screen, Spinner, Text } from '@/ui'

const UUID_HEAD = /^[0-9a-f]{8}-[0-9a-f]{4}-/i

export default function HandleResolver() {
  const t = useTheme()
  const router = useRouter()
  const { handle } = useLocalSearchParams<{ handle: string }>()
  const raw = String(handle || '').replace(/^@/, '')

  const looksLikeId = UUID_HEAD.test(raw)

  const person = useAsync<any>(
    () => api.users.getByUsername(raw),
    { enabled: !!raw && !looksLikeId, deps: [raw] },
  )

  if (looksLikeId) return <Redirect href={{ pathname: '/user/[id]', params: { id: raw } }} />
  if (person.data?.id) return <Redirect href={{ pathname: '/user/[id]', params: { id: String(person.data.id) } }} />

  if (person.loading || !raw) {
    return (
      <Screen>
        <View style={styles.center}>
          {/* The drawn arc, not the platform indicator (src/ui/State.tsx) —
              it is the only one that honours Reduce Motion. */}
          <Spinner size="large" />
        </View>
      </Screen>
    )
  }

  const missing = isNotFound(person.error)

  return (
    <Screen>
      <View style={styles.center}>
        <View style={[styles.glyph, { backgroundColor: t.colors.surfaceSunken }]}>
          <Icon name="link" size={30} color={t.colors.textFaint} />
        </View>
        <Text variant="title3" align="center" style={{ marginTop: space.lg }}>
          {missing ? `We could not find @${raw}` : 'We could not open that link'}
        </Text>
        <Text variant="callout" tone="muted" align="center" style={{ marginTop: space.xs2, maxWidth: 320 }}>
          {missing ? 'The account may have been renamed or deleted.' : errorText(person.error)}
        </Text>

        <View style={{ gap: space.sm2, marginTop: space.xxl, alignSelf: 'stretch', maxWidth: 320, alignItems: 'stretch' }}>
          {missing ? null : (
            <Button label="Try again" onPress={person.reload} variant="primary" size="lg" block icon="refresh" />
          )}
          <Button
            label="Search for people"
            onPress={() => router.replace({ pathname: '/search/people', params: { q: raw } })}
            variant="secondary"
            size="lg"
            block
          />
          <Button label="Go back" onPress={() => router.back()} variant="ghost" size="lg" block />
        </View>
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xxxl },
  /* Icon-only round plate — one of the sanctioned circles (DESIGN.md §8.1).
     It carries a glyph, never a label, so it is not one of the pills the
     language forbids. */
  glyph: { width: 62, height: 62, borderRadius: 31, alignItems: 'center', justifyContent: 'center' },
})
