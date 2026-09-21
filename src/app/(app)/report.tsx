/* =========================================================
   Report.

   Navigation arrives through reportHref() in
   src/components/system/Moderation.tsx — the one entry point
   every menu uses — so the params here are its contract:
   targetType/targetId plus the optional name/avatar/snippet
   context and authorId for the block affordance.

   The targetType is validated against REPORT_TARGET_TYPES and
   submitted VERBATIM, or not at all: a value the backend does
   not know disables submit rather than being coerced to a
   "close enough" type, because a report filed under the wrong
   type carries an id the backend cannot resolve and dies in
   triage looking handled.

   The reasons come from REPORT_REASONS in the api barrel — the
   backend's own enum and labels — so a new reason server-side
   shows up here without a client release, and a wrong spelling
   can never be typed by hand.

   Reports dedup server-side: an open report for the same
   (target, reason) is returned as-is rather than duplicated, so
   a double submit is harmless. The rate limit is the real
   guard (20/hour), and a 429 keeps the reason AND the details
   while the button counts down.
   ========================================================= */
import React from 'react'
import { StyleSheet, TextInput, View } from 'react-native'
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated'
import { REPORT_REASONS, REPORT_TARGET_TYPES, api, errorText, isRateLimited } from '@/api'
import { useCooldown } from '@/hooks/useCooldown'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  Avatar, Button, Callout, ConfirmSheet, Header, Icon, Screen, Text, Touchable, fireHaptic, toast,
} from '@/ui'

export default function ReportScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { targetType, targetId, name, avatar, snippet, authorId } = useLocalSearchParams<{
    targetType?: string
    targetId?: string
    name?: string
    avatar?: string
    snippet?: string
    authorId?: string
  }>()

  /* Verbatim or nothing — see the header note. */
  const kind = (REPORT_TARGET_TYPES as string[]).includes(String(targetType)) ? String(targetType) : null
  const [reason, setReason] = React.useState<string | null>(null)
  const [details, setDetails] = React.useState('')
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState<any>(null)
  const [cooldown, startCooldown] = useCooldown() as [number, (e: any) => boolean]
  const [confirmBlock, setConfirmBlock] = React.useState(false)
  const [blocking, setBlocking] = React.useState(false)

  const reasons = REPORT_REASONS as [string, string][]
  const canSubmit = !!kind && !!targetId && !!reason && !submitting && cooldown === 0
  /* A USER report's target IS the account, so the block link works without a
     separate authorId. */
  const blockId = authorId ? String(authorId) : kind === 'USER' && targetId ? String(targetId) : null

  const submit = async () => {
    if (!canSubmit) return
    setSubmitting(true)
    setError(null)
    try {
      await api.settings.safety.report({
        targetType: kind!,
        targetId: String(targetId),
        /* MESSAGE ids are routed into targetRef by the api layer; every other
           kind sends it absent. Explicit because TS infers the JS module's
           destructured params as required. */
        targetRef: undefined,
        reason: reason!,
        details: details.trim() || undefined,
      })
      fireHaptic('success')
      toast.ok('Thanks — we’ll take a look.')
      router.back()
    } catch (e) {
      fireHaptic('error')
      if (isRateLimited(e)) startCooldown(e)
      setError(e)
    } finally {
      setSubmitting(false)
    }
  }

  const block = async () => {
    if (!blockId) return
    setBlocking(true)
    try {
      await api.users.block(blockId)
      /* A block also strips that author from every future feed page and from
         the live rail, server-side — nothing to clean up locally. */
      toast.ok('Blocked')
      setConfirmBlock(false)
      router.back()
    } catch (e) {
      toast.error(errorText(e))
    } finally {
      setBlocking(false)
    }
  }

  return (
    <Screen background="elevated">
      {/* Not dismissible while the write is in flight — a swipe-away mid-POST
          leaves the user unsure whether the report landed. */}
      <Header closeButton={!submitting} title="Report" />

      {/* Keyboard-aware (the app-wide keyboard-controller convention): tapping
          a reason low in the list reveals the details field UNDER the open
          keyboard otherwise — the input has to ride up with it. */}
      <KeyboardAwareScrollView
        keyboardShouldPersistTaps="handled"
        bottomOffset={24}
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        showsVerticalScrollIndicator={false}
      >
        <Text variant="footnote" tone="muted" align="ui" style={styles.intro}>
          Your report is anonymous. We’ll review it against the community guidelines.
        </Text>

        {name ? (
          <View style={styles.targetRow}>
            <Avatar uri={avatar ? String(avatar) : null} name={String(name)} seed={String(targetId ?? '')} size={30} />
            <Text variant="subhead" weight="600" numberOfLines={1} style={styles.flex}>{String(name)}</Text>
          </View>
        ) : null}
        {snippet ? (
          <Text variant="footnote" tone="muted" numberOfLines={2} style={styles.snippet}>
            “{String(snippet)}”
          </Text>
        ) : null}

        {!kind || !targetId ? (
          <Callout tone="warning" style={styles.banner}>
            Something went wrong opening this report. Go back and use the Report option on the content itself.
          </Callout>
        ) : null}

        <View style={styles.list}>
          {reasons.map(([value, label]) => {
            const selected = reason === value
            return (
              <Touchable
                key={value}
                onPress={() => setReason(value)}
                feedback="tint"
                noAutoHitSlop
                accessibilityState={{ selected }}
                style={styles.reasonRow}
              >
                <Text variant="body" weight="500" style={styles.flex}>{label}</Text>
                <View
                  style={[
                    styles.radio,
                    { borderColor: selected ? c.accent : c.borderStrong, backgroundColor: selected ? c.accent : 'transparent' },
                  ]}
                >
                  {selected ? <Icon name="check" size={13} color={c.textOnAccent} /> : null}
                </View>
              </Touchable>
            )
          })}
        </View>

        {reason ? (
          <Animated.View
            entering={t.prefs.reducedMotion ? undefined : FadeIn.duration(180)}
            exiting={t.prefs.reducedMotion ? undefined : FadeOut.duration(120)}
            style={styles.detailsWrap}
          >
            <TextInput
              value={details}
              onChangeText={setDetails}
              placeholder="Add details (optional)"
              placeholderTextColor={c.textFaint}
              multiline
              allowFontScaling={false}
              editable={!submitting}
              style={[
                styles.details,
                {
                  color: c.text,
                  backgroundColor: c.surfaceSunken,
                  borderRadius: t.radius.sm,
                  fontSize: t.type.callout.fontSize,
                  lineHeight: t.type.callout.lineHeight,
                },
              ]}
            />
          </Animated.View>
        ) : null}

        {error ? (
          <Callout tone="danger" style={styles.banner}>{errorText(error)}</Callout>
        ) : null}

        <Button
          label={cooldown > 0 ? `Wait ${cooldown}s` : 'Submit report'}
          onPress={() => { void submit() }}
          disabled={!canSubmit}
          loading={submitting}
          variant="danger"
          size="lg"
          block
          style={styles.submit}
        />

        {blockId ? (
          <Touchable
            onPress={() => setConfirmBlock(true)}
            disabled={submitting}
            feedback="dim"
            style={styles.blockLink}
          >
            <Text variant="subhead" tone="accent" align="center">Block this account instead</Text>
          </Touchable>
        ) : null}
      </KeyboardAwareScrollView>

      <ConfirmSheet
        visible={confirmBlock}
        onClose={() => setConfirmBlock(false)}
        title={`Block ${name || 'this account'}?`}
        message="They won’t be able to follow you or see your posts, and their content disappears from your feed."
        confirmLabel="Block"
        destructive
        loading={blocking}
        onConfirm={() => { void block() }}
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  intro: { paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.sm2 },
  targetRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm2, paddingHorizontal: space.lg, paddingBottom: space.xs2 },
  snippet: { paddingHorizontal: space.lg, paddingBottom: space.sm2 },
  list: { paddingHorizontal: space.xs },
  reasonRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.md, height: 52 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  detailsWrap: { paddingHorizontal: space.lg, paddingTop: space.sm2 },
  details: { height: 96, padding: space.md, textAlignVertical: 'top' },
  banner: { marginHorizontal: space.lg, marginTop: space.md },
  submit: { marginHorizontal: space.lg, marginTop: space.lg2, height: 48, borderRadius: 12 },
  blockLink: { paddingVertical: space.lg, alignSelf: 'center' },
})
