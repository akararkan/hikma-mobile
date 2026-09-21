/* =========================================================
   Disappearing messages.

   The timer applies a Cassandra TTL to messages sent AFTER the
   call; existing rows never expire. That single sentence is the
   whole reason this screen needs body copy — every user assumes
   the opposite, and finding out later is a privacy surprise
   rather than a feature.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { api, codeOf, errorText } from '@/api'
import { useChatActions, useConversation } from '@/context/ChatContext'
import { useAsync } from '@/hooks/useAsync'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  Callout, ConfirmSheet, GroupFooter, Header, Icon, ListRow, RowGroup, Screen,
  ScreenScroll, Sheet, SkeletonList, Spinner, Text, Button, Field, useSheetState,
} from '@/ui'
import { canChangeSettings } from '@/components/chat/permissions'
import { ChatErrorState } from '@/components/chat/states'

const PRESETS = [
  { label: 'Off', seconds: 0 },
  { label: '24 hours', seconds: 86400 },
  { label: '7 days', seconds: 604800 },
  { label: '90 days', seconds: 7776000 },
]

export default function DisappearingScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const convId = String(id)

  const { setDisappearing } = useChatActions()
  const convoQ = useAsync<any>(() => api.chat.conversations.get(convId), { deps: [convId] })
  /* The live inbox/archived row, subscribed per-key — a render-time getConvo()
     here would go permanently stale now that this screen no longer re-renders
     on inbox churn. */
  const liveRow = useConversation(convId)
  const convo = convoQ.data ?? liveRow

  const custom = useSheetState()
  const confirmOff = useSheetState()
  const [busy, setBusy] = React.useState<number | null>(null)
  const [denied, setDenied] = React.useState<string | null>(null)
  const [customValue, setCustomValue] = React.useState('7')

  const current = Number(convo?.disappearingSeconds) || 0
  /* In a DIRECT chat everyone may set the timer; in a group it is a settings
     change, so it follows the admin gate. */
  const editable = !!convo && (!convo.isGroup || canChangeSettings(convo)) && !denied

  const apply = React.useCallback(async (seconds: number) => {
    if (!editable) return
    setBusy(seconds)
    convoQ.setData((prev: any) => (prev ? { ...prev, disappearingSeconds: seconds } : prev))
    try {
      await setDisappearing(convId, seconds)
    } catch (e: any) {
      convoQ.setData((prev: any) => (prev ? { ...prev, disappearingSeconds: current } : prev))
      if (codeOf(e) === 'ADMINS_ONLY') setDenied(errorText(e, 'You cannot change this group’s settings.'))
    } finally {
      setBusy(null)
    }
  }, [editable, convId, setDisappearing, convoQ, current])

  if (convoQ.loading && !convo) {
    return (
      <Screen background="sunken">
        <Header back title="Disappearing messages" />
        <SkeletonList count={4} />
      </Screen>
    )
  }

  if (!convo) {
    return (
      <Screen background="sunken">
        <Header back title="Disappearing messages" />
        <ChatErrorState error={convoQ.error} title="Could not load this setting" onRetry={convoQ.reload} back={() => router.back()} />
      </Screen>
    )
  }

  const isPreset = PRESETS.some(p => p.seconds === current)

  return (
    <Screen background="sunken">
      <Header back title="Disappearing messages" />
      <ScreenScroll>
        <View style={styles.hero}>
          <View style={[styles.glyph, { backgroundColor: c.warningSoft }]}>
            <Icon name="hourglass" size={26} color={c.warningText} />
          </View>
          <Text variant="callout" tone="muted" align="center" style={styles.copy}>
            New messages in this chat will disappear after the selected time.
            Messages already sent are not affected.
          </Text>
        </View>

        {denied ? <View style={styles.pad}><Callout tone="danger">{denied}</Callout></View> : null}

        <RowGroup inset={16}>
          {PRESETS.map(p => (
            <ListRow
              key={p.seconds}
              title={p.label}
              disabled={!editable}
              accessory={
                busy === p.seconds
                  ? { kind: 'custom', node: <Spinner /> }
                  : { kind: 'check', checked: current === p.seconds }
              }
              onPress={() => {
                if (p.seconds === 0 && current > 0) confirmOff.open()
                else void apply(p.seconds)
              }}
            />
          ))}
          <ListRow
            title="Custom…"
            disabled={!editable}
            accessory={
              !isPreset && current > 0
                ? { kind: 'value', text: `${Math.round(current / 86400)} days` }
                : { kind: 'chevron' }
            }
            onPress={custom.open}
          />
        </RowGroup>

        <GroupFooter>
          Everyone in this chat can see the timer, and changing it is announced in the chat.
          Disappearing messages are never indexed for search, and their text never appears in
          notifications or the chat list preview.
        </GroupFooter>

        {convo.isGroup && !canChangeSettings(convo) ? (
          <GroupFooter>Only admins can change this.</GroupFooter>
        ) : null}
      </ScreenScroll>

      <Sheet visible={custom.visible} onClose={custom.close} title="Custom timer" maxHeightRatio={0.55}>
        <View style={styles.customBody}>
          <Field
            label="Days"
            value={customValue}
            onChangeText={setCustomValue}
            keyboardType="number-pad"
            hint="Between 1 and 365 days."
          />
          <Button
            label="Set timer"
            onPress={() => {
              const days = Math.max(1, Math.min(365, Math.round(Number(customValue) || 0)))
              custom.close()
              void apply(days * 86400)
            }}
            disabled={!Number(customValue)}
            size="lg"
            block
          />
        </View>
      </Sheet>

      <ConfirmSheet
        visible={confirmOff.visible}
        onClose={confirmOff.close}
        title="Turn off disappearing messages?"
        message="New messages will be kept."
        confirmLabel="Turn off"
        onConfirm={() => { confirmOff.close(); void apply(0) }}
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', paddingVertical: space.xxl, gap: space.md },
  glyph: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  copy: { maxWidth: 320, paddingHorizontal: space.lg },
  pad: { paddingHorizontal: space.lg, paddingBottom: space.sm },
  customBody: { padding: space.xl, paddingTop: space.md, gap: space.lg },
})
