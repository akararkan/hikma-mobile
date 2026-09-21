/* =========================================================
   Trouble signing in.

   This is deliberately NOT a forgot-password screen. auth.md
   says it outright: there is no reset-token flow, and the only
   way to rotate a password is POST /change-password, which
   needs a session you already have. An email box here would
   promise a message that never arrives, so the screen explains
   the three routes that actually exist instead.

   Everything on it is static copy, which is the point — it has
   to work on a dead network, because "I cannot sign in" and
   "I have no connection" arrive together more often than not.
   ========================================================= */
import React from 'react'
import { Linking, StyleSheet, View } from 'react-native'
import Constants from 'expo-constants'
import * as Clipboard from 'expo-clipboard'
import { useRouter } from 'expo-router'
import { api, errorText } from '@/api'
import { useAsync } from '@/hooks/useAsync'
import { CLIENT_BUILD, CLIENT_VERSION } from '@/lib/version'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  Button, Card, Divider, Header, Icon, Screen, ScreenScroll, Sheet, Spinner,
  Text, Touchable, toast, useSheetState, type IconName,
} from '@/ui'

const SUPPORT_EMAIL = String((Constants.expoConfig?.extra as any)?.supportEmail || '')

export default function SignInHelpScreen() {
  const t = useTheme()
  const router = useRouter()
  const policy = useSheetState<'privacy' | 'terms'>()

  /* Best-effort and permitAll, so it works signed out. A failure is silent:
     the version footer degrades to a dash and nothing else on this screen
     depends on it. */
  const config = useAsync<any>(() => api.settings.app.config(), {})

  const contactSupport = async () => {
    if (!SUPPORT_EMAIL) return
    const url = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Hikmah Web sign-in help')}`
    const opened = await Linking.openURL(url).then(() => true).catch(() => false)
    if (!opened) {
      await Clipboard.setStringAsync(SUPPORT_EMAIL)
      toast.info(`No mail app found — ${SUPPORT_EMAIL} copied instead`)
    }
  }

  return (
    <Screen background="sunken">
      <Header back title="Trouble signing in" />

      <ScreenScroll contentContainerStyle={{ padding: t.layout.screenPadding, gap: space.lg, paddingBottom: 48 }}>
        <HelpCard
          icon="key"
          title="I forgot my password"
          body="Passwords can only be changed from inside a signed-in session — Hikmah Web has no reset-by-email flow, so nobody can send you a reset link. If you cannot get in at all, an administrator has to reset it for you."
          action={SUPPORT_EMAIL ? { label: 'Contact support', onPress: contactSupport } : null}
          note={SUPPORT_EMAIL ? null : 'This build has no support address configured. Copy the diagnostics below and send them through whichever channel your organisation uses.'}
        />

        <HelpCard
          icon="shield"
          title="I lost my authenticator"
          body="Three routes, in the order worth trying:"
          bullets={[
            'Use one of the ten recovery codes you saved — they go in the same box as the 6-digit code.',
            'Turn two-factor off from a device that is still signed in: Settings → Security.',
            'Ask an administrator to reset the second factor. That also signs you out everywhere.',
          ]}
          action={{ label: 'Back to sign in', onPress: () => router.back() }}
        />

        <HelpCard
          icon="lock"
          title="My account says it is disabled"
          body="A disabled account usually means the email address has not been verified yet, or an administrator disabled it. It is also what a pending account deletion looks like from the outside — if you asked to delete your account in the last 30 days, that is this."
          action={SUPPORT_EMAIL ? { label: 'Contact support', onPress: contactSupport } : null}
        />

        <HelpCard
          icon="at"
          title="Wrong username or email?"
          body="Your handle and your email address are independent, and the sign-in field takes either one. If one is not working, try the other before assuming the password is wrong."
        />

        <View style={{ gap: space.sm, marginTop: space.xs, alignItems: 'center' }}>
          <Text variant="footnote" tone="faint" align="center">
            Hikmah Web {CLIENT_VERSION}{CLIENT_BUILD ? ` (${CLIENT_BUILD})` : ''}
            {config.data?.minSupportedVersion ? ` · minimum supported ${config.data.minSupportedVersion}` : ''}
          </Text>

          <Button
            label="Copy diagnostics"
            variant="ghost"
            size="sm"
            icon="copy"
            onPress={async () => {
              await Clipboard.setStringAsync(
                [
                  `app: Hikmah Web ${CLIENT_VERSION}${CLIENT_BUILD ? ` (${CLIENT_BUILD})` : ''}`,
                  `minSupported: ${config.data?.minSupportedVersion ?? 'unknown'}`,
                  `latest: ${config.data?.latestVersion ?? 'unknown'}`,
                  `configRead: ${config.error ? errorText(config.error) : 'ok'}`,
                ].join('\n'),
              )
              toast.ok('Diagnostics copied')
            }}
          />

          <View style={styles.legalRow}>
            <Touchable onPress={() => policy.open('privacy')} feedback="dim">
              <Text variant="footnote" tone="accent">Privacy Policy</Text>
            </Touchable>
            <Text variant="footnote" tone="faint">·</Text>
            <Touchable onPress={() => policy.open('terms')} feedback="dim">
              <Text variant="footnote" tone="accent">Terms of Service</Text>
            </Touchable>
          </View>
        </View>
      </ScreenScroll>

      <PolicySheet visible={policy.visible} onClose={policy.close} policyKey={policy.payload} />
    </Screen>
  )
}

function HelpCard({
  icon, title, body, bullets, action, note,
}: {
  icon: IconName
  title: string
  body: string
  bullets?: string[]
  action?: { label: string; onPress: () => void } | null
  note?: string | null
}) {
  const t = useTheme()
  return (
    <Card variant="outlined">
      <View style={{ padding: space.lg, gap: space.sm }}>
        <View style={styles.titleRow}>
          <View style={[styles.glyph, { backgroundColor: t.colors.accentSoft }]}>
            <Icon name={icon} size={18} color={t.colors.accent} />
          </View>
          <Text variant="title3" align="ui" style={{ flex: 1 }}>{title}</Text>
        </View>

        <Text variant="callout" tone="secondary" align="ui">{body}</Text>

        {bullets?.length ? (
          <View style={{ gap: space.xs2, marginTop: space.xxs }}>
            {bullets.map((b, i) => (
              <View key={i} style={styles.bullet}>
                <View style={[styles.dot, { backgroundColor: t.colors.accent }]} />
                <Text variant="callout" tone="secondary" align="ui" style={{ flex: 1 }}>{b}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {note ? (
          <Text variant="footnote" tone="muted" align="ui" style={{ marginTop: space.xxs }}>{note}</Text>
        ) : null}
      </View>

      {action ? (
        <>
          <Divider />
          <Touchable onPress={action.onPress} feedback="tint" noAutoHitSlop style={styles.actionRow}>
            <Text variant="body" tone="accent" align="ui" style={{ flex: 1 }}>{action.label}</Text>
            <Icon name="forward" size={16} color={t.colors.accentText} />
          </Touchable>
        </>
      ) : null}
    </Card>
  )
}

/* The policy reader lives in this sheet rather than a route: the policy
   endpoint is public and the document is one blob of text, so a pushed screen
   would be a whole navigation for a body with no interactions in it. */
function PolicySheet({
  visible, onClose, policyKey,
}: { visible: boolean; onClose: () => void; policyKey: 'privacy' | 'terms' | null }) {
  const t = useTheme()
  const doc = useAsync<any>(
    () => api.settings.app.policy(policyKey),
    { enabled: visible && !!policyKey, deps: [visible, policyKey] },
  )

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={doc.data?.title || (policyKey === 'terms' ? 'Terms of Service' : 'Privacy Policy')}
      subtitle={doc.data?.version ? `Version ${doc.data.version}` : undefined}
      maxHeightRatio={0.88}
    >
      <View style={{ padding: t.layout.screenPadding }}>
        {doc.loading ? (
          <Spinner label="Loading…" />
        ) : doc.error ? (
          <Text variant="callout" tone="muted" align="ui">{errorText(doc.error)}</Text>
        ) : (
          <Text variant="body" align="auto" reading>{doc.data?.body || 'This document is not available.'}</Text>
        )}
      </View>
    </Sheet>
  )
}

const styles = StyleSheet.create({
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm2 },
  glyph: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  bullet: { flexDirection: 'row', gap: space.sm2, alignItems: 'flex-start' },
  dot: { width: 5, height: 5, borderRadius: 3, marginTop: space.sm },
  actionRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.lg, paddingVertical: space.md2 },
  legalRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.xxs },
})
