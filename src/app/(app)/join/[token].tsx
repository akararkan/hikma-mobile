/* =========================================================
   Redeem an invite link.

   The redeem is guarded by a ref, not by state. A maxUses:1 link
   is spent the moment the request lands, so a re-render — React
   StrictMode's double effect, a navigation param settling — that
   fires it twice burns the invite and the second call answers
   INVITE_INVALID for a link that just worked.

   `PENDING_APPROVAL` is a SUCCESS: the use is consumed and a
   join request is filed, and `conversation` is null in that arm.
   Callers branch on `status`, never on the body.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import { api, errorText, isNetworkError } from '@/api'
import { useTheme } from '@/theme/ThemeProvider'
import { setback, shape, space } from '@/theme/tokens'
import { Avatar, Button, Icon, Screen, Spinner, Text } from '@/ui'
import { chRoute } from '@/components/channels/routes'

type Phase = 'redeeming' | 'joined' | 'pending' | 'failed'

export default function JoinScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const { token } = useLocalSearchParams<{ token: string }>()

  const [phase, setPhase] = React.useState<Phase>('redeeming')
  const [conversation, setConversation] = React.useState<any>(null)
  const [channel, setChannel] = React.useState<any>(null)
  const [error, setError] = React.useState<any>(null)

  const fired = React.useRef(false)
  const touched = React.useRef(false)
  const autoTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const redeem = React.useCallback(async () => {
    if (!token || fired.current) return
    fired.current = true
    setPhase('redeeming')
    setError(null)
    try {
      const res: any = await api.channels.invites.redeem(token)
      if (res.status === 'PENDING_APPROVAL' || res.pending) { setPhase('pending'); return }

      const convo = res.conversation
      setConversation(convo)
      if (convo?.isChannel) {
        /* Fetch the channel-shaped record before navigating: the destination
           screen expects a channel, not a bare conversation row. */
        try { setChannel(await api.channels.get(convo.id)) } catch { /* the id alone is enough */ }
      }
      setPhase('joined')

      autoTimer.current = setTimeout(() => {
        if (touched.current || !convo?.id) return
        router.replace(convo.isChannel ? chRoute.channel(convo.id) : chRoute.chat(convo.id))
      }, 900)
    } catch (e: any) {
      setError(e)
      setPhase('failed')
    }
  }, [token, router])

  React.useEffect(() => {
    void redeem()
    return () => { if (autoTimer.current) clearTimeout(autoTimer.current) }
  }, [redeem])

  const stopAuto = () => {
    touched.current = true
    if (autoTimer.current) { clearTimeout(autoTimer.current); autoTimer.current = null }
  }

  const open = () => {
    stopAuto()
    if (!conversation?.id) return
    router.replace(conversation.isChannel ? chRoute.channel(conversation.id) : chRoute.chat(conversation.id))
  }

  /* A dead token never becomes live, so only a transport failure retries. */
  const retryable = isNetworkError(error)

  return (
    <>
      <Stack.Screen options={{ presentation: 'transparentModal', animation: 'fade', headerShown: false }} />
      <Screen background="transparent" style={[styles.backdrop, { backgroundColor: c.scrim }]}>
        {/* A raised surface over the scrim: setback corners and a 1px
            borderStrong course carry the depth — never a shadow. */}
        <View style={[styles.card, { backgroundColor: c.bgElevated, borderColor: c.borderStrong }]}>
          {phase === 'redeeming' ? (
            <View style={styles.center}>
              <Spinner size="large" />
              <Text variant="callout" tone="muted" align="center" style={{ marginTop: space.md }}>Checking your invite…</Text>
            </View>
          ) : null}

          {phase === 'joined' ? (
            <View style={styles.center}>
              <Avatar
                uri={conversation?.avatarUrl || channel?.avatarUrl}
                name={conversation?.displayTitle || channel?.title}
                seed={conversation?.id}
                size={64}
                square
              />
              <Text variant="headline" align="center" style={{ marginTop: space.md }}>You joined</Text>
              <Text variant="callout" tone="muted" align="center" numberOfLines={2}>
                {channel?.title || conversation?.displayTitle}
              </Text>
              {conversation && !conversation.isChannel ? (
                <Text variant="caption" tone="muted" align="center" style={{ marginTop: space.xs2 }}>
                  This invite was for a group chat, not a channel.
                </Text>
              ) : null}
              <Button
                label={conversation?.isChannel ? 'Open channel' : 'Open chat'}
                onPress={open}
                size="lg"
                block
                style={{ marginTop: space.lg2 }}
              />
              <Button label="Not now" variant="ghost" onPress={() => { stopAuto(); router.replace(chRoute.index()) }} style={{ marginTop: space.xs }} />
            </View>
          ) : null}

          {phase === 'pending' ? (
            <View style={styles.center}>
              <Icon name="hourglass" size={56} color={c.warning} />
              <Text variant="headline" align="center" style={{ marginTop: space.md }}>Request sent</Text>
              <Text variant="callout" tone="muted" align="center" style={{ marginTop: space.xs }}>
                An admin will review your request. You’ll get a notification when it’s approved.
              </Text>
              <Button label="Done" onPress={() => router.replace(chRoute.index())} size="lg" block style={{ marginTop: space.lg2 }} />
            </View>
          ) : null}

          {phase === 'failed' ? (
            <View style={styles.center}>
              <Icon name="link" size={56} color={c.danger} />
              <Text variant="headline" align="center" style={{ marginTop: space.md }}>This invite can’t be used</Text>
              <Text variant="callout" tone="muted" align="center" style={{ marginTop: space.xs }}>{errorText(error)}</Text>
              {retryable ? (
                <Button
                  label="Try again"
                  variant="tinted"
                  size="lg"
                  block
                  style={{ marginTop: space.lg2 }}
                  onPress={() => { fired.current = false; void redeem() }}
                />
              ) : null}
              <Button
                label="Browse channels"
                variant={retryable ? 'ghost' : 'primary'}
                size="lg"
                block
                style={{ marginTop: retryable ? 4 : 18 }}
                onPress={() => router.replace(chRoute.index())}
              />
              <Button label="Close" variant="ghost" onPress={() => router.back()} style={{ marginTop: space.xxs }} />
            </View>
          ) : null}
        </View>
      </Screen>
    </>
  )
}

const styles = StyleSheet.create({
  backdrop: { alignItems: 'center', justifyContent: 'center', padding: space.xxl },
  card: {
    width: 320,
    maxWidth: '100%',
    padding: space.xxl,
    borderWidth: 1,
    ...setback(shape.sheet),
    borderCurve: 'continuous',
  },
  center: { alignItems: 'center' },
})
