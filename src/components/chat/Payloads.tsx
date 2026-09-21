/* =========================================================
   The four typed-payload renderers: FILE, LOCATION, CONTACT
   and POLL.

   PollCard carries the one non-obvious rule in the set. Every
   poll write broadcasts `poll.updated` with a VIEWER-NEUTRAL
   aggregate — no `myVotes` — so merging a frame wholesale over
   local state wipes the viewer's own selection. The card
   therefore takes counts from the frame and keeps its own
   `myVotes`, and quiz answers stay hidden until `revealed`.
   ========================================================= */
import React from 'react'
import { Linking, StyleSheet, View } from 'react-native'
import * as WebBrowser from 'expo-web-browser'
import { withAlpha } from '@/theme/colors'
import { useTheme } from '@/theme/ThemeProvider'
import { setback, shape, space } from '@/theme/tokens'
import { Icon, LiveTag, NumericText, Text, Touchable } from '@/ui'
import { extOf, extTone, fileSizeLabel } from './format'

/* ---------------------------------------------------------
   FILE
   --------------------------------------------------------- */

export function FileTile({
  media, fg, fgMuted, onPress, downloading,
}: { media: any; fg: string; fgMuted: string; onPress?: () => void; downloading?: boolean }) {
  const t = useTheme()
  const ext = extOf(media?.fileName)
  const toneKey = extTone(media?.fileName)
  const tint = t.colors[toneKey]

  return (
    <Touchable
      onPress={onPress}
      disabled={!onPress}
      feedback="dim"
      noAutoHitSlop
      accessibilityLabel={media?.fileName || 'File'}
      /* The sunken document tile (web .ch-file): a quiet self-ink wash, so
         it recedes into whichever bubble side it sits on — grey inside
         incoming, lighter navy inside own. */
      style={[styles.fileRow, { backgroundColor: withAlpha(fg, 0.1) }]}
    >
      <View style={[styles.fileTile, { backgroundColor: tint }]}>
        <Text variant="micro" color={t.colors.textOnAccent} align="center" numberOfLines={1}>{ext}</Text>
      </View>
      <View style={styles.flex}>
        <Text variant="subhead" color={fg} numberOfLines={1} ellipsizeMode="middle">
          {media?.fileName || 'File'}
        </Text>
        <Text variant="micro" color={fgMuted} align="ui" style={{ marginTop: space.xxs }}>
          {ext} · {fileSizeLabel(media?.bytes)}
        </Text>
      </View>
      <Icon name={downloading ? 'hourglass' : 'download'} size={18} color={fgMuted} />
    </Touchable>
  )
}

/* ---------------------------------------------------------
   LOCATION

   No map tile: a static-map render needs a keyed provider this
   app does not ship. The card states the place and hands the
   coordinates to the OS map, which is the action anyone
   actually wants from a shared pin.
   --------------------------------------------------------- */

export function LocationCard({ location, fg, fgMuted, width }: { location: any; fg: string; fgMuted: string; width: number }) {
  const t = useTheme()
  if (!location) return null

  const open = () => {
    const { latitude, longitude, name } = location
    const label = encodeURIComponent(name || 'Shared location')
    const url = `https://maps.google.com/?q=${latitude},${longitude}(${label})`
    Linking.openURL(url).catch(() => {})
  }

  return (
    <View style={{ width }}>
      <View style={[styles.mapPlate, { backgroundColor: t.colors.surfaceSunken, borderColor: t.colors.border }]}>
        <Icon name="location" size={30} color={t.colors.accent} filled />
        {/* The shared badge, so a live pin wears the same sanctioned pill as
            every other LIVE mark in the app. */}
        {location.live ? <LiveTag style={styles.liveTag} /> : null}
      </View>
      <Text variant="subhead" color={fg} align="auto" numberOfLines={1} style={{ marginTop: space.sm }}>
        {location.name || 'Shared location'}
      </Text>
      {location.address ? (
        <Text variant="micro" color={fgMuted} align="auto" numberOfLines={2} style={{ marginTop: space.xxs }}>
          {location.address}
        </Text>
      ) : null}
      <Touchable onPress={open} feedback="dim" noAutoHitSlop style={{ marginTop: space.xs2 }}>
        <Text variant="footnote" color={t.colors.accent} align="ui">Open in Maps</Text>
      </Touchable>
    </View>
  )
}

/* ---------------------------------------------------------
   CONTACT
   --------------------------------------------------------- */

export function ContactCard({
  contact, fg, fgMuted, onMessage, onSave,
}: { contact: any; fg: string; fgMuted: string; onMessage?: (userId: string) => void; onSave?: () => void }) {
  const t = useTheme()
  if (!contact) return null

  return (
    <View style={{ minWidth: 220 }}>
      <View style={styles.contactRow}>
        <View style={[styles.contactAvatar, { backgroundColor: t.colors.accentSoft }]}>
          <Icon name="person" size={20} color={t.colors.accent} filled />
        </View>
        <View style={styles.flex}>
          <Text variant="subhead" color={fg} numberOfLines={1}>{contact.fullName}</Text>
          {contact.phone ? (
            <Text variant="micro" color={fgMuted} align="ui" style={{ marginTop: space.xxs }}>{contact.phone}</Text>
          ) : null}
        </View>
      </View>
      {/* Buttons exist only when their handler does — an offer that cannot
          be accepted is noise (the poll card says the same about Retract). */}
      {(contact.userId && onMessage) || onSave ? (
        <View style={[styles.contactActions, { borderTopColor: fgMuted }]}>
          {contact.userId && onMessage ? (
            <Touchable onPress={() => onMessage(contact.userId)} feedback="dim" noAutoHitSlop style={styles.contactBtn}>
              <Text variant="footnote" color={t.colors.accent} align="center">Message</Text>
            </Touchable>
          ) : null}
          {onSave ? (
            <Touchable onPress={onSave} feedback="dim" noAutoHitSlop style={styles.contactBtn}>
              <Text variant="footnote" color={t.colors.accent} align="center">Save</Text>
            </Touchable>
          ) : null}
        </View>
      ) : null}
    </View>
  )
}

/* ---------------------------------------------------------
   POLL
   --------------------------------------------------------- */

export function PollCard({
  poll, fg, fgMuted, accent, width, busy, onVote, onRetract, onClose, canClose,
}: {
  poll: any
  fg: string
  fgMuted: string
  accent: string
  width: number
  busy?: boolean
  onVote: (indexes: number[]) => void
  onRetract: () => void
  onClose?: () => void
  canClose?: boolean
}) {
  const t = useTheme()
  const [staged, setStaged] = React.useState<number[]>([])
  if (!poll) return null

  const multi = !!poll.allowsMultipleAnswers
  const locked = !!poll.closed

  const toggle = (index: number) => {
    if (locked || busy) return
    if (!multi) { onVote([index]); return }
    setStaged(prev => (prev.includes(index) ? prev.filter(i => i !== index) : [...prev, index]))
  }

  return (
    <View style={{ width }}>
      <Text variant="bodyStrong" color={fg} align="auto">{poll.question}</Text>
      {poll.quiz ? (
        <Text variant="micro" color={fgMuted} align="ui" style={{ marginTop: space.xxs }}>Quiz · answers are final</Text>
      ) : null}

      <View style={{ marginTop: space.sm2, gap: space.sm }}>
        {poll.options.map((o: any) => {
          const chosen = o.mine || staged.includes(o.index)
          const correct = poll.revealed && poll.correctOptionIndex === o.index
          return (
            <Touchable
              key={o.index}
              onPress={() => toggle(o.index)}
              disabled={locked || !!busy}
              feedback="dim"
              noAutoHitSlop
              accessibilityState={{ selected: chosen }}
              style={styles.option}
            >
              <View style={styles.optionTop}>
                <View
                  style={[
                    styles.radio,
                    {
                      borderColor: chosen ? accent : fgMuted,
                      borderWidth: chosen ? 6 : 1.5,
                      borderRadius: multi ? 5 : 9,
                    },
                  ]}
                />
                <Text variant="footnote" color={fg} align="auto" style={styles.flex}>{o.text}</Text>
                {correct ? <Icon name="check" size={14} color={t.colors.success} /> : null}
                {poll.revealed ? (
                  <NumericText variant="micro" color={fgMuted}>{o.pct}%</NumericText>
                ) : null}
              </View>
              {poll.revealed ? (
                <View style={[styles.track, { backgroundColor: fgMuted }]}>
                  <View style={{ width: `${o.pct}%`, height: '100%', borderRadius: 3, backgroundColor: correct ? t.colors.success : accent }} />
                </View>
              ) : null}
            </Touchable>
          )
        })}
      </View>

      {multi && staged.length && !locked ? (
        <Touchable onPress={() => { onVote(staged); setStaged([]) }} feedback="dim" noAutoHitSlop style={{ marginTop: space.sm }}>
          <Text variant="footnote" color={accent} align="ui">Vote ({staged.length})</Text>
        </Touchable>
      ) : null}

      <Text variant="micro" color={fgMuted} align="ui" style={{ marginTop: space.sm }}>
        {poll.totalVoters} {poll.totalVoters === 1 ? 'voter' : 'voters'} · {locked ? 'Final results' : poll.anonymous ? 'Anonymous' : 'Public'}
      </Text>

      {poll.revealed && poll.explanation ? (
        <Text variant="micro" color={fgMuted} align="auto" style={{ marginTop: space.xs }}>{poll.explanation}</Text>
      ) : null}

      <View style={styles.pollActions}>
        {/* Retracting a quiz answer 400s by design, so the affordance is absent
            rather than disabled — an offer that cannot be accepted is noise. */}
        {poll.voted && !poll.quiz && !locked ? (
          <Touchable onPress={onRetract} feedback="dim" noAutoHitSlop>
            <Text variant="micro" color={accent} align="ui">Retract vote</Text>
          </Touchable>
        ) : null}
        {canClose && !locked && onClose ? (
          <Touchable onPress={onClose} feedback="dim" noAutoHitSlop>
            <Text variant="micro" color={accent} align="ui">Close poll</Text>
          </Touchable>
        ) : null}
      </View>
    </View>
  )
}

/* ---------------------------------------------------------
   LINK row — the gallery's Links tab.
   --------------------------------------------------------- */

export function LinkRow({ url, body, time, onPress }: { url: string; body?: string; time?: string; onPress?: () => void }) {
  const t = useTheme()
  const host = (() => {
    const m = /^https?:\/\/([^/?#]+)/i.exec(url)
    return m ? m[1].replace(/^www\./, '') : url
  })()

  return (
    <Touchable
      onPress={onPress ?? (() => { void WebBrowser.openBrowserAsync(url) })}
      feedback="tint"
      noAutoHitSlop
      style={[styles.linkRow, { borderBottomColor: t.colors.separator }]}
    >
      <View style={styles.flex}>
        <Text variant="subhead" weight="600" numberOfLines={1} align="ui">{host}</Text>
        {body ? (
          <Text variant="footnote" tone="muted" numberOfLines={2} align="auto" style={{ marginTop: space.xxs }}>{body}</Text>
        ) : null}
      </View>
      {time ? <Text variant="caption" tone="faint" align="ui">{time}</Text> : null}
    </Touchable>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  /* Web .ch-file: a 12pt padded plate, borderless. */
  fileRow: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm2, minWidth: 210,
    paddingHorizontal: space.sm2, paddingVertical: space.sm,
    ...setback(shape.buttonLg), borderCurve: 'continuous',
  },
  /* The extension label makes this a text-bearing plate — chip setback.
     Portrait, like a little document (web .ch-file-ico 40×48). */
  fileTile: {
    width: 40, height: 48, alignItems: 'center', justifyContent: 'center',
    ...setback(shape.chip), borderCurve: 'continuous',
  },
  mapPlate: {
    height: 120, borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center', justifyContent: 'center',
    ...setback(shape.card), borderCurve: 'continuous',
  },
  liveTag: { position: 'absolute', top: 8, end: 8 },
  contactRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm2 },
  /* Icon-only avatar stand-in — a sanctioned circle. */
  contactAvatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  contactActions: { flexDirection: 'row', gap: space.xs, marginTop: space.sm, paddingTop: space.xs2, borderTopWidth: StyleSheet.hairlineWidth },
  contactBtn: { flex: 1, paddingVertical: space.xs },
  option: { gap: space.xs2 },
  optionTop: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  radio: { width: 18, height: 18 },
  track: { height: 4, borderRadius: 3, marginStart: 26, overflow: 'hidden' },
  pollActions: { flexDirection: 'row', gap: space.lg, marginTop: space.xs2 },
  linkRow: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    paddingHorizontal: space.lg, paddingVertical: space.md2, borderBottomWidth: StyleSheet.hairlineWidth,
  },
})
