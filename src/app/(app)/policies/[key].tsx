/* =========================================================
   A policy document.

   In the moderation domain this is where every "Community
   Guidelines" link lands: the refusal notice, the safety
   explainer, the report sheet's self-harm card. It reads
   permitAll, so it works signed out — only the acceptance
   footer needs a session.

   The body is rendered as PLAIN TEXT split on blank lines.
   src/lib/richtext is for user-generated content with a
   declared format; a policy document arrives with none, and
   guessing HTML on a legal text is how a stray `<` eats a
   paragraph.

   `accepted()` is matched on policyKey AND version: accepting
   v3 says nothing about v4, and a footer that stays hidden
   after a policy update is a compliance bug, not a cosmetic one.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import Animated, { FadeIn } from 'react-native-reanimated'
import * as Clipboard from 'expo-clipboard'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { api, POLICY_KEYS, isNetworkError } from '@/api'
import { useAction, useAsync } from '@/hooks/useAsync'
import { useAuth } from '@/context/AuthContext'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { ErrorStrip, fmtDate } from '@/components/moderation'
import {
  Button, Chip, ErrorState, Header, Icon, Screen, ScreenScroll, Skeleton, Text, toast,
} from '@/ui'

const KEY_LABELS: Record<string, string> = Object.fromEntries(POLICY_KEYS as [string, string][])

export default function PolicyScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { key } = useLocalSearchParams<{ key: string }>()
  const { signedIn } = useAuth()

  const valid = !!key && key in KEY_LABELS
  const placeholder = valid ? KEY_LABELS[key] : 'Policy'

  const doc = useAsync<any>(() => api.settings.app.policy(String(key)), {
    enabled: valid,
    deps: [key],
  })
  const accepted = useAsync<any[]>(async () => (await api.settings.app.accepted()) || [], {
    enabled: valid && signedIn,
    deps: [key, signedIn],
  })

  const [justAccepted, setJustAccepted] = React.useState(false)

  const accept = useAction(
    async () => api.settings.app.acceptPolicy(String(key)),
    {
      onSuccess: () => {
        setJustAccepted(true)
        void accepted.reload()
        toast.ok('Accepted')
      },
    },
  )

  const paragraphs = React.useMemo(
    () => String(doc.data?.body ?? '').split(/\n\s*\n/).map(p => p.trim()).filter(Boolean),
    [doc.data?.body],
  )

  /* An unknown key never reaches the network — a typo in a deep link is a
     stale-link problem, not a request to make. Above every hook, so a params
     change on a reused screen cannot alter this render's hook count. */
  if (!valid) {
    return (
      <Screen background="sunken">
        <Header back title="Policy" />
        <View style={styles.center}>
          <Icon name="search" size={32} color={c.textFaint} />
          <Text variant="title3" align="center" style={{ marginTop: space.md }}>This document doesn&apos;t exist</Text>
          <Text variant="callout" tone="muted" align="center" style={{ marginTop: space.xs }}>
            The link may be old, or the policy was renamed.
          </Text>
          <Button label="Go back" onPress={() => router.back()} variant="tinted" style={{ marginTop: space.lg }} />
        </View>
      </Screen>
    )
  }

  const version = doc.data?.version
  const isAccepted = justAccepted || (accepted.data || []).some(
    (a: any) => a?.policyKey === key && String(a?.version) === String(version),
  )
  const copySummary = async () => {
    if (!doc.data) return
    await Clipboard.setStringAsync(
      `${doc.data.title} — version ${doc.data.version} (effective ${fmtDate(doc.data.effectiveDate)})`,
    )
    toast.ok('Copied')
  }

  if (doc.loading && !doc.data) {
    return (
      <Screen background="sunken">
        <Header back title={placeholder} />
        <View style={{ padding: space.xl, gap: space.md }}>
          <Skeleton width="72%" height={26} />
          <Skeleton width="44%" height={12} />
          <View style={{ height: 12 }} />
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} width={i % 3 === 2 ? '62%' : '100%'} height={13} />
          ))}
        </View>
      </Screen>
    )
  }

  if (doc.error && !doc.data) {
    return (
      <Screen background="sunken">
        <Header back title={placeholder} />
        <ErrorState error={doc.error} onRetry={doc.reload} />
      </Screen>
    )
  }

  const showFooter = signedIn && !isAccepted && !!doc.data

  return (
    <Screen background="sunken">
      <Header
        back
        title={doc.data?.title || placeholder}
        actions={[{ icon: 'copy', onPress: copySummary, label: 'Copy version and date' }]}
      />

      {/* A stale body is still the truth as of the last load; saying so beats
          replacing a readable document with an error. */}
      {doc.error && doc.data ? (
        <View style={[styles.staleBar, { backgroundColor: c.surfaceSunken, borderBottomColor: c.separator }]}>
          <Icon name={isNetworkError(doc.error) ? 'offline' : 'warning'} size={13} color={c.textMuted} />
          <Text variant="caption" tone="muted" align="ui">Showing the last version you loaded</Text>
        </View>
      ) : null}

      <ScreenScroll
        refreshing={doc.refreshing}
        onRefresh={doc.refresh}
        contentContainerStyle={{ paddingHorizontal: space.xl, paddingBottom: showFooter ? 120 : insets.bottom + 40 }}
      >
        <Text variant="title1" align="auto" style={{ marginTop: space.lg2 }}>{doc.data?.title}</Text>
        <View style={styles.metaRow}>
          <Text variant="footnote" tone="muted" align="ui" style={styles.flex}>
            Version {doc.data?.version} · Effective {fmtDate(doc.data?.effectiveDate)}
          </Text>
          {isAccepted ? (
            <Animated.View entering={t.prefs.reducedMotion ? undefined : FadeIn.duration(t.ms(220))}>
              <Chip label="Accepted" icon="check" tone="success" size="sm" />
            </Animated.View>
          ) : null}
        </View>

        {!paragraphs.length ? (
          <Text variant="callout" tone="muted" align="ui" style={{ marginTop: space.xxl }}>
            This document is not available yet.
          </Text>
        ) : paragraphs.map((p, i) => (
          <Text key={i} variant="body" reading align="auto" selectable style={{ marginTop: i === 0 ? 20 : 14 }}>
            {p}
          </Text>
        ))}
      </ScreenScroll>

      {showFooter ? (
        <View
          style={[
            styles.footer,
            { backgroundColor: c.bg, borderTopColor: c.separator, paddingBottom: Math.max(insets.bottom, 12) },
          ]}
        >
          {accept.error ? <ErrorStrip error={accept.error} style={{ marginBottom: space.sm2 }} /> : null}
          <Text variant="footnote" tone="muted" align="ui" style={{ marginBottom: space.sm2 }}>
            I have read and accept
          </Text>
          <Button
            label="Accept"
            onPress={() => { void accept.run() }}
            variant="primary"
            size="lg"
            block
            loading={accept.pending}
          />
        </View>
      ) : null}
    </Screen>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xxxl },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm2, marginTop: space.sm },
  staleBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs2,
    paddingHorizontal: space.xl,
    paddingVertical: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  footer: {
    position: 'absolute',
    start: 0,
    end: 0,
    bottom: 0,
    paddingHorizontal: space.xl,
    paddingTop: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
})
