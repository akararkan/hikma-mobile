/* =========================================================
   Automatic content checks.

   Every moderation refusal, every "Removed" badge and all three
   moderation notifications end up here. It is the ONE place the
   client is allowed to explain the system, because the backend
   never sends this copy — and it is the one place that has to
   be honest about the gap:

   THERE IS NO ENDPOINT TO APPEAL A MODERATION DECISION AGAINST
   YOUR OWN CONTENT. `api.settings.safety.appeal(id)` appeals a
   report YOU FILED. The server's own refusal copy promises "you
   can appeal from your account settings", so this screen owes
   the user a real path — a support contact and the guidelines —
   rather than a button that 404s.

   The timing table is built from HOLD_CEILING_MS rather than
   typed out, so the numbers cannot drift away from the schedule
   `useHeldWatch` actually polls on.

   One rule holds even here: the copy never says what tripped a
   check. The vagueness is deliberate anti-oracle design, and an
   explainer screen is exactly where someone would be tempted to
   soften it.
   ========================================================= */
import React from 'react'
import { Linking, StyleSheet, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated'
import * as Clipboard from 'expo-clipboard'
import Constants from 'expo-constants'
import { api, isNetworkError } from '@/api'
import { ENTITY_LABEL, HOLD_CEILING_MS } from '@/lib/moderation.js'
import { entityTypeName } from '@/api'
import { useAsync } from '@/hooks/useAsync'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { fmtMs } from '@/components/moderation'
import {
  Button, Divider, Header, Icon, Screen, ScreenScroll, Text, Touchable, toast,
} from '@/ui'

/* ONE support address for the whole app — the same `extra.supportEmail` key
   sign-in-help reads, rather than a second, unrelated env var that was never
   defined anywhere (which is why this button had been dead since it shipped).
   Unset still hides the button, but the copy beside it now changes too: this
   is the screen whose whole job is not lying about the appeal path, so it must
   not say "send us the details" with no way to send them. */
const SUPPORT_EMAIL = String((Constants.expoConfig?.extra as any)?.supportEmail || '')

/* Rows of the timing table. The label is ENTITY_LABEL's noun except where two
   entity types share one sentence in the user guide; the number always comes
   from HOLD_CEILING_MS. */
const TIMING_ROWS: { key: string; label?: string }[] = [
  { key: 'POST' },
  { key: 'POST_COMMENT', label: 'Comment or reply' },
  { key: 'STORY' },
  { key: 'RESEARCH' },
  { key: 'QNA_QUESTION', label: 'Question or answer' },
  { key: 'CHAT_MESSAGE' },
  { key: 'CHANNEL' },
  { key: 'STREAM_META' },
  { key: 'LIVE_CHAT' },
]

const OUTCOMES = [
  {
    tone: 'success' as const,
    title: 'It just works',
    body: 'Checked in a fraction of a second and published immediately. This is what happens almost every time.',
  },
  {
    tone: 'warning' as const,
    title: "It's held for a closer look",
    body: 'Your content is saved. It’s temporarily visible only to you, with a Checking… or Under review badge, '
      + 'until the automatic system finishes or a moderator looks. You’ll get a notification either way.',
  },
  {
    tone: 'danger' as const,
    title: "It's refused",
    body: 'Nothing is saved. You get an error and your draft stays in the text box so you can edit and try again.',
  },
]

const ALWAYS_TRUE = [
  'You always see your own content.',
  'A refusal never deletes your draft.',
  'Editing re-checks your content.',
  'We never tell you exactly what tripped the check — telling people that would let bad actors tune their way around it.',
  'Stories publish anyway if the check can’t decide in 15 seconds, then get looked at with priority.',
]

const SPECIAL_CASES = [
  {
    title: 'Chat and direct messages',
    body: 'A held message shows the people you sent it to the same placeholder a deleted message uses. '
      + 'You still see yours normally — there is no third state to look for.',
  },
  {
    title: 'Channel and group names',
    body: 'A refused or held rename simply doesn’t apply: the previous approved name keeps serving. '
      + 'Members never see a “checking” state, on purpose.',
  },
  {
    title: 'Live stream chat',
    body: 'There is no held state at all. A risky line is silently not shown — no error, no notification, nothing to wait for.',
  },
]

export default function ModerationExplainerScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const { trace, entity } = useLocalSearchParams<{ trace?: string; entity?: string }>()

  /* mailto with the reference already filled in — settings/about tells people
     to quote it by hand, and this screen already has it. Falls back to copying
     the address when the device has no mail app, exactly as sign-in-help does,
     so the button can never be a dead end. */
  const contactSupport = async () => {
    if (!SUPPORT_EMAIL) return
    const subject = encodeURIComponent('Hikmah Web moderation appeal')
    const body = encodeURIComponent(trace ? `Reference: ${trace}\n\n` : '')
    const opened = await Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`)
      .then(() => true)
      .catch(() => false)
    if (!opened) {
      await Clipboard.setStringAsync(SUPPORT_EMAIL)
      toast.info(`No mail app found — ${SUPPORT_EMAIL} copied instead`)
    }
  }

  /* Prefetch so the guidelines row opens instantly. Failure is silent — the
     row still navigates and /policies/[key] owns its own error state. */
  const guidelines = useAsync<any>(() => api.settings.app.policy('guidelines'), { deps: [] })

  const [open, setOpen] = React.useState<number | null>(null)

  const highlight = entityTypeName(entity)
  const noun = highlight ? (ENTITY_LABEL as Record<string, string>)[highlight] : null

  return (
    <Screen background="sunken">
      <Header back title="Automatic content checks" />
      <ScreenScroll>
        <View style={styles.hero}>
          <View style={[styles.heroGlyph, { backgroundColor: c.accentSoft }]}>
            <Icon name="shield" size={30} color={c.accent} />
          </View>
          <Text variant="body" tone="secondary" align="ui" style={{ marginTop: space.lg }}>
            {noun
              ? `Every ${noun} you post is checked automatically before anyone else can see it. `
                + 'Almost always this happens instantly and you’ll never notice.'
              : 'Every piece of text you post is checked automatically before anyone else can see it. '
                + 'Almost always this happens instantly and you’ll never notice.'}
          </Text>
        </View>

        {/* ---- the three outcomes ---- */}
        <Section title="What can happen" />
        {OUTCOMES.map(o => (
          <View
            key={o.title}
            style={[
              styles.outcome,
              {
                backgroundColor: c.surface,
                borderStartColor: o.tone === 'success' ? c.success : o.tone === 'warning' ? c.warning : c.danger,
                borderRadius: t.radius.md,
              },
            ]}
          >
            <Text variant="bodyStrong" align="ui">{o.title}</Text>
            <Text variant="callout" tone="secondary" align="ui" style={{ marginTop: space.xs }}>{o.body}</Text>
          </View>
        ))}

        {/* ---- how long ---- */}
        <Section title="How long it can take" />
        <View style={[styles.table, { backgroundColor: c.surface, borderRadius: t.radius.md, borderColor: c.borderFaint }]}>
          {TIMING_ROWS.map((row, i) => {
            const ceiling = (HOLD_CEILING_MS as Record<string, number>)[row.key]
            const label = row.label ?? capitalise((ENTITY_LABEL as Record<string, string>)[row.key] ?? row.key)
            const on = highlight === row.key
            return (
              <View key={row.key}>
                {i > 0 ? <Divider inset={14} /> : null}
                <View style={[styles.tableRow, on ? { backgroundColor: c.accentSofter } : null]}>
                  <Text variant="callout" align="ui" style={styles.flex} numberOfLines={1}>{label}</Text>
                  <Text variant="callout" tone={row.key === 'LIVE_CHAT' ? 'muted' : 'secondary'} align="ui">
                    {row.key === 'LIVE_CHAT' ? 'never held' : fmtMs(ceiling)}
                  </Text>
                </View>
              </View>
            )
          })}
        </View>
        <Text variant="footnote" tone="muted" align="ui" style={styles.caption}>
          These are safety ceilings, not what you should expect. Most content clears in under a second.
        </Text>

        {/* ---- always true ---- */}
        <Section title="Things that are always true" />
        <View style={[styles.table, { backgroundColor: c.surface, borderRadius: t.radius.md, borderColor: c.borderFaint, padding: space.md2, gap: space.sm2 }]}>
          {ALWAYS_TRUE.map(line => (
            <View key={line} style={styles.bullet}>
              <View style={[styles.dot, { backgroundColor: c.accent }]} />
              <Text variant="callout" tone="secondary" align="ui" style={styles.flex}>{line}</Text>
            </View>
          ))}
        </View>

        {/* ---- special cases ---- */}
        <Section title="Special cases" />
        <View style={[styles.table, { backgroundColor: c.surface, borderRadius: t.radius.md, borderColor: c.borderFaint }]}>
          {SPECIAL_CASES.map((s, i) => (
            <View key={s.title}>
              {i > 0 ? <Divider inset={14} /> : null}
              <Touchable
                onPress={() => setOpen(open === i ? null : i)}
                feedback="tint"
                noAutoHitSlop
                accessibilityState={{ expanded: open === i }}
                style={styles.discloseRow}
              >
                <Text variant="callout" align="ui" style={styles.flex}>{s.title}</Text>
                <Icon name={open === i ? 'up' : 'down'} size={16} color={c.textFaint} />
              </Touchable>
              {open === i ? (
                <Animated.View
                  entering={t.prefs.reducedMotion ? undefined : FadeIn.duration(t.ms(160))}
                  exiting={t.prefs.reducedMotion ? undefined : FadeOut.duration(t.ms(120))}
                  style={styles.discloseBody}
                >
                  <Text variant="footnote" tone="muted" align="ui">{s.body}</Text>
                </Animated.View>
              ) : null}
            </View>
          ))}
        </View>

        {/* ---- appeals ---- */}
        <Section title="If you think a decision was wrong" />
        <View style={[styles.table, { backgroundColor: c.surface, borderRadius: t.radius.md, borderColor: c.borderFaint, padding: space.md2 }]}>
          <Text variant="callout" tone="secondary" align="ui">
            {SUPPORT_EMAIL
              ? 'Every appeal is reviewed by a person. There is no in-app appeal button for an automatic decision yet — send us the details and we’ll pick it up.'
              : 'Every appeal is reviewed by a person. This build has no support address configured, so send the details through whichever channel your organisation uses.'}
          </Text>

          <View style={{ marginTop: space.md, gap: space.sm }}>
            {SUPPORT_EMAIL ? (
              <Button
                label="Contact support"
                icon="mail"
                variant="tinted"
                size="md"
                block
                onPress={() => { void contactSupport() }}
              />
            ) : null}
            <Button
              label="Read the Community Guidelines"
              icon="book"
              variant="secondary"
              size="md"
              block
              onPress={() => router.push({ pathname: '/policies/[key]', params: { key: 'guidelines' } })}
            />
            {isNetworkError(guidelines.error) ? (
              <Text variant="caption" tone="faint" align="ui">Unavailable offline</Text>
            ) : null}
          </View>

          {trace ? (
            <Touchable
              onPress={async () => {
                await Clipboard.setStringAsync(String(trace))
                toast.ok('Reference copied')
              }}
              feedback="dim"
              style={{ marginTop: space.md }}
            >
              <Text variant="footnote" tone="muted" align="ui">
                Reference: {String(trace)} — tap to copy
              </Text>
            </Touchable>
          ) : null}
        </View>

        <Text variant="footnote" tone="faint" align="ui" style={[styles.caption, { marginBottom: space.sm }]}>
          The automatic checker understands English best. In other languages the word-level filter still applies.
        </Text>
      </ScreenScroll>
    </Screen>
  )
}

function Section({ title }: { title: string }) {
  /* No manual transform: `caption` uppercases LATIN ONLY inside the Text
     primitive, which is what keeps Arabic and Kurdish section labels intact. */
  return (
    <Text variant="caption" tone="muted" align="ui" style={styles.section}>
      {title}
    </Text>
  )
}

const capitalise = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)

const styles = StyleSheet.create({
  flex: { flex: 1 },
  hero: { paddingHorizontal: space.lg, paddingTop: space.xl, alignItems: 'center' },
  heroGlyph: { width: 56, height: 56, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  section: { paddingHorizontal: space.lg, paddingTop: space.xxl, paddingBottom: space.sm },
  outcome: { marginHorizontal: space.lg, marginBottom: space.sm, padding: space.md2, borderStartWidth: 4 },
  table: { marginHorizontal: space.lg, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  tableRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.md2, paddingVertical: space.md },
  caption: { paddingHorizontal: space.lg, paddingTop: space.sm },
  bullet: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm2 },
  dot: { width: 5, height: 5, borderRadius: 3, marginTop: space.sm },
  discloseRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.md2, paddingVertical: space.md2 },
  discloseBody: { paddingHorizontal: space.md2, paddingBottom: space.md2, marginTop: -space.xxs },
})
