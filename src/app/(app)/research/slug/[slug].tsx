/* =========================================================
   Resolve an SEO slug.

   `router.replace`, never push: the back button must not return
   to a resolving splash.

   The copy names the real reason a slug goes stale — a title
   change regenerates it — because that is the single most
   common cause, and it must stay neutral otherwise: a block
   edge answers 404 exactly like a deletion does.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import Animated, { FadeIn } from 'react-native-reanimated'
import { adapters, api, isNetworkError, isTransient } from '@/api'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { Button, Icon, Screen, Spinner, Text, Touchable } from '@/ui'
import { to } from '@/components/research/nav'
import type { ResearchDetail } from '@/components/research/types'

export default function SlugLandingScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>()
  const decoded = decodeURIComponent(String(slug || ''))
  return (
    <ResolveSplash
      resolve={async () => adapters.researchDetailFrom(await api.research.bySlug(decoded)) as ResearchDetail}
      enabled={!!decoded}
      title="This paper could not be found."
      body="The link may be out of date — titles change and regenerate the link."
    />
  )
}

/* Shared by both deep-link landings. Kept here rather than in components/
   because the two screens are the only callers and the shape is the screen. */
export function ResolveSplash({
  resolve, enabled, title, body,
}: {
  resolve: () => Promise<ResearchDetail>
  enabled: boolean
  title: string
  body: string
}) {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const [failed, setFailed] = React.useState<'none' | 'gone' | 'offline'>('none')
  const [attempt, setAttempt] = React.useState(0)
  const retried = React.useRef(false)

  React.useEffect(() => {
    if (!enabled) { setFailed('gone'); return }
    let alive = true
    /* Never leave the splash spinning: ten seconds and it becomes an answer. */
    const timeout = setTimeout(() => { if (alive) setFailed('offline') }, 10_000)

    void (async () => {
      try {
        const detail = await resolve()
        if (!alive) return
        /* Archived and retracted papers resolve by design — the detail screen
           renders their banners. */
        router.replace(to(`/research/${detail.id}`))
      } catch (e: any) {
        if (!alive) return
        if (isTransient(e) && !retried.current) {
          retried.current = true
          setTimeout(() => setAttempt(a => a + 1), 2000)
          return
        }
        setFailed(isNetworkError(e) ? 'offline' : 'gone')
      } finally {
        clearTimeout(timeout)
      }
    })()

    return () => { alive = false; clearTimeout(timeout) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, attempt])

  if (failed === 'none') {
    return (
      <Screen>
        <View style={styles.center}>
          <View style={[styles.monogram, { backgroundColor: c.accent }]}>
            <Text variant="title2" color={c.textOnAccent} align="center" style={styles.wordmark}>IRC</Text>
          </View>
          <Text variant="headline" tone="muted" align="center" style={{ marginTop: space.xl }}>Opening paper…</Text>
          <Spinner style={{ marginTop: space.sm2 }} />
        </View>
      </Screen>
    )
  }

  return (
    <Screen>
      <Animated.View entering={t.prefs.reducedMotion ? undefined : FadeIn} style={styles.center}>
        <View style={[styles.card, { backgroundColor: c.surfaceSunken }]}>
          <Icon name="link" size={40} color={c.textFaint} />
          <Text variant="headline" align="center" style={{ marginTop: space.md }}>
            {failed === 'offline' ? 'Could not reach the server' : title}
          </Text>
          <Text variant="footnote" tone="muted" align="center" style={{ marginTop: space.xs2 }}>
            {failed === 'offline' ? 'Check your connection and try again.' : body}
          </Text>
          <Button
            label="Browse research"
            block
            onPress={() => router.replace(to('/research'))}
            style={{ marginTop: space.lg2 }}
          />
          <Touchable
            onPress={() => { retried.current = false; setFailed('none'); setAttempt(a => a + 1) }}
            feedback="dim"
            style={styles.retry}
          >
            <Text variant="subhead" tone="accent" align="center">Try again</Text>
          </Touchable>
        </View>
      </Animated.View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xxl },
  monogram: { width: 72, height: 72, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  wordmark: { letterSpacing: 1.5 },
  card: { width: 280, borderRadius: 20, padding: 22, alignItems: 'center' },
  retry: { paddingVertical: space.md },
})
