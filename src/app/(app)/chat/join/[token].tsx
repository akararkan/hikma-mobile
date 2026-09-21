/* =========================================================
   Join by invite link.

   The one thing this screen must get right: `PENDING_APPROVAL`
   is a SUCCESS. The join consumed a use and filed a request,
   and `conversation` comes back null — branching on the body
   instead of on `pending` turns a successful request into an
   error message.

   Nothing is ever auto-joined. The token is in the URL, so a
   screen that redeemed it on mount would let a link in a group
   chat add someone by being tapped once.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { api, codeOf, errorText, isNetworkError } from '@/api'
import { useChatActions } from '@/context/ChatContext'
import { chatError } from '@/lib/chatErrors'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { Avatar, Button, Callout, Header, Icon, Screen, Text } from '@/ui'

type Phase =
  | { kind: 'idle' }
  | { kind: 'joining' }
  | { kind: 'pending' }
  | { kind: 'joined'; convo: any }
  | { kind: 'dead'; message: string }

export default function JoinByTokenScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const { token } = useLocalSearchParams<{ token: string }>()
  const { refreshInbox } = useChatActions()

  const [phase, setPhase] = React.useState<Phase>({ kind: 'idle' })

  const [notice, setNotice] = React.useState<string | null>(null)

  const join = async () => {
    if (!token || phase.kind === 'joining') return
    setPhase({ kind: 'joining' })
    setNotice(null)
    try {
      const res: any = await api.chat.members.join(token)
      if (res.pending) { setPhase({ kind: 'pending' }); return }
      const convo = res.conversation
      if (!convo) { setPhase({ kind: 'pending' }); return }
      void refreshInbox()
      setPhase({ kind: 'joined', convo })
      router.replace(`/chat/${convo.id}`)
    } catch (e: any) {
      const code = codeOf(e)
      /* A transport failure is RETRYABLE — the link is not spent by a request
         that never arrived. Back to the Join button with the offline copy,
         never the terminal state. */
      if (isNetworkError(e)) {
        setNotice(errorText(e))
        setPhase({ kind: 'idle' })
        return
      }
      if (code === 'INVITE_INVALID' || e?.status === 400) {
        /* Neither of these can be retried: the link is spent or malformed. */
        setPhase({ kind: 'dead', message: errorText(e, 'This invite link is invalid or has expired.') })
        return
      }
      setPhase({ kind: 'dead', message: chatError(e, 'Could not use this invite link') })
    }
  }

  return (
    <Screen>
      <Header back title="" />

      <View style={styles.body}>
        {phase.kind === 'joined' ? (
          <>
            <Avatar uri={phase.convo.avatarUrl} name={phase.convo.displayTitle} seed={phase.convo.id} size={72} square />
            <Text variant="title3" align="center" style={styles.title}>{phase.convo.displayTitle}</Text>
            <Text variant="callout" tone="muted" align="center">{phase.convo.memberCount} members</Text>
            <Button
              label="Open chat"
              onPress={() => router.replace(`/chat/${phase.convo.id}`)}
              size="lg"
              block
              style={styles.action}
            />
          </>
        ) : phase.kind === 'pending' ? (
          <>
            <View style={[styles.glyph, { backgroundColor: c.warningSoft }]}>
              <Icon name="hourglass" size={30} color={c.warningText} />
            </View>
            <Text variant="title3" align="center" style={styles.title}>Request sent</Text>
            <Text variant="callout" tone="muted" align="center" style={styles.copy}>
              An admin has to approve your request. You’ll get a message when they do.
            </Text>
            <Button label="Done" onPress={() => router.back()} size="lg" block style={styles.action} />
          </>
        ) : phase.kind === 'dead' ? (
          <>
            <View style={[styles.glyph, { backgroundColor: c.dangerSoft }]}>
              <Icon name="link" size={30} color={c.danger} />
            </View>
            <Text variant="title3" align="center" style={styles.title}>Can’t use this link</Text>
            <Callout tone="danger" style={styles.callout}>{phase.message}</Callout>
            <Button label="Close" onPress={() => router.back()} variant="secondary" size="lg" block style={styles.action} />
          </>
        ) : (
          <>
            <View style={[styles.glyph, { backgroundColor: c.surfaceSunken }]}>
              <Icon name="link" size={30} color={c.textSecondary} />
            </View>
            <Text variant="title3" align="center" style={styles.title}>Join this group?</Text>
            <Text variant="callout" tone="muted" align="center">You were invited with a link.</Text>
            <Text variant="caption" tone="faint" align="center" style={styles.token}>
              …{String(token || '').slice(-6)}
            </Text>
            {notice ? <Callout tone="warning" style={styles.callout}>{notice}</Callout> : null}
            <Button
              label="Join"
              onPress={join}
              loading={phase.kind === 'joining'}
              disabled={!token || phase.kind === 'joining'}
              size="lg"
              block
              style={styles.action}
            />
            <Button label="Cancel" onPress={() => router.back()} variant="ghost" size="md" />
          </>
        )}
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xxxl, gap: space.xs },
  /* Icon-only medallion — a sanctioned circle, not a text-bearing lozenge. */
  glyph: { width: 72, height: 72, borderRadius: 999, alignItems: 'center', justifyContent: 'center', marginBottom: space.md2 },
  title: { marginTop: space.xs },
  copy: { maxWidth: 320, marginTop: space.xs },
  token: { marginTop: space.sm, letterSpacing: 1.5 },
  callout: { marginTop: space.md, alignSelf: 'stretch' },
  action: { marginTop: 22 },
})
