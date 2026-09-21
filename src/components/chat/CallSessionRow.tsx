/* =========================================================
   CallSessionRow — an ended call, in the timeline, at the
   minute it happened.

   The server writes no message for a call and keeps no history
   endpoint, so without this card the most significant thing two
   people did all day leaves no trace in the conversation. The
   record is the device-local call log (callStore.ts), which is
   why the card is deliberately quieter than a message: it is
   chrome that DESCRIBES the thread, not something anyone said
   in it. Tapping it calls back — the only action a call record
   has ever needed. Ported from the web's CallCard/describeCall
   (components/chat/MessageList.jsx + callLog.js), including the
   rule that the same terminal state reads differently at the
   two ends: the caller's cancelled call is the callee's missed
   one, so direction is part of the description, never inferred.
   That grammar lives in `callSummary.ts` — the inbox rail says
   the same sentence about the same call, and the two must not
   drift apart over an event the server keeps no record of.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { Icon, Text, Touchable } from '@/ui'
import { describeCallEntry } from '@/components/call/callSummary'
import type { CallLogEntry } from '@/components/call/callStore'

const TIME_FMT = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })

export const CallSessionRow = React.memo(function CallSessionRow({
  entry, count = 1, spanStartMs, onCallBack,
}: {
  entry: CallLogEntry
  /** A collapsed run of same-outcome calls — "(3)" on the title and a
   *  time RANGE instead of one stamp. */
  count?: number
  spanStartMs?: number
  onCallBack: (video: boolean) => void
}) {
  const t = useTheme()
  const c = t.colors
  const d = describeCallEntry(entry)
  const atMs = Date.parse(entry.endedAt || entry.startedAt || '')
  const last = Number.isFinite(atMs) ? TIME_FMT.format(atMs) : ''
  const first = count > 1 && spanStartMs ? TIME_FMT.format(spanStartMs) : ''
  const time = first && first !== last ? `${first}–${last}` : last
  const title = count > 1 ? `${d.title} (${count})` : d.title
  const video = entry.type === 'VIDEO'

  const plate = d.tone === 'warn' ? c.dangerSoft : d.tone === 'ok' ? c.accentSoft : c.surfaceSunken
  const ink = d.tone === 'warn' ? c.danger : d.tone === 'ok' ? c.accentText : c.textMuted

  return (
    <View style={styles.lane}>
      <Touchable
        onPress={() => onCallBack(video)}
        feedback="tint"
        noAutoHitSlop
        accessibilityLabel={`${title}${d.detail ? `, ${d.detail}` : ''}. Tap to call back.`}
        /* A raised chrome card fenced by a stone course — never a shadow in a
           list row (DESIGN.md). */
        style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}
      >
        <View style={[styles.plate, { backgroundColor: plate }]}>
          <Icon name={d.icon} size={16} color={ink} />
        </View>
        <View style={styles.body}>
          <Text variant="footnote" weight="600" align="ui" numberOfLines={1}>{title}</Text>
          <Text variant="caption" tone="muted" align="ui" numberOfLines={1}>
            {time}{d.detail ? ` · ${d.detail}` : ''}
          </Text>
        </View>
        <Icon name={video ? 'videoCall' : 'call'} size={16} color={c.textFaint} />
      </Touchable>
    </View>
  )
})

const styles = StyleSheet.create({
  lane: { alignItems: 'center', paddingVertical: space.xs2 },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm2,
    minWidth: 220, maxWidth: '78%',
    paddingHorizontal: space.md, paddingVertical: space.sm,
    borderRadius: 14, borderCurve: 'continuous', borderWidth: StyleSheet.hairlineWidth,
  },
  plate: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, gap: space.xxs },
})
