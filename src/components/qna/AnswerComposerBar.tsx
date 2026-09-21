/* =========================================================
   The docked bar at the bottom of the detail and thread pages.

   When the gate is shut it becomes a lock strip rather than a
   disabled input: an input you can focus and type into and
   then cannot submit is worse than no input at all.

   The dock is a solid plate with a drawn DOUBLE RULE at its top
   edge — QELAT has no blur and no frosted chrome (DESIGN.md
   §5.9, §8.7).
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '@/theme/ThemeProvider'
import { setback, shape, space } from '@/theme/tokens'
import { Avatar, DoubleRule, Icon, IconButton, Text, Touchable } from '@/ui'
import type { GateResult } from './gate'

export interface AnswerComposerBarProps {
  avatarUri?: string | null
  avatarName?: string | null
  avatarSeed?: string | null
  placeholder: string
  gate: GateResult
  onPress: () => void
  onAttachMedia: () => void
  onAttachVoice: () => void
  onSignIn?: () => void
}

export function AnswerComposerBar({
  avatarUri, avatarName, avatarSeed, placeholder, gate,
  onPress, onAttachMedia, onAttachVoice, onSignIn,
}: AnswerComposerBarProps) {
  const t = useTheme()
  const c = t.colors
  const insets = useSafeAreaInsets()
  const pad = Math.max(insets.bottom, 8)

  let body: React.ReactNode

  if (!gate.open && gate.reason === 'ROLE') {
    body = (
      <View style={[styles.roleStrip, { minHeight: 44 }]}>
        <Text variant="footnote" tone="muted" align="center">{gate.copy}</Text>
      </View>
    )
  } else if (!gate.open && gate.reason === 'SIGNED_OUT') {
    body = (
      <Touchable onPress={onSignIn} feedback="dim" style={[styles.roleStrip, { minHeight: 44 }]}>
        <Text variant="subhead" tone="accent" align="center">Sign in to answer</Text>
      </Touchable>
    )
  } else if (!gate.open) {
    body = (
      <View style={[styles.lockStrip, { minHeight: 44 }]}>
        <Icon name="lock" size={16} color={c.textMuted} />
        <Text variant="footnote" tone="muted" align="ui" style={styles.flex}>{gate.copy}</Text>
      </View>
    )
  } else {
    body = (
      <View style={styles.row}>
        <Avatar uri={avatarUri} name={avatarName} seed={avatarSeed} size={28} />
        <Touchable
          onPress={onPress}
          feedback="dim"
          noAutoHitSlop
          style={[styles.stub, { backgroundColor: c.surfaceSunken, borderColor: c.borderFaint }]}
          accessibilityLabel={placeholder}
        >
          <Text variant="body" tone="faint" align="ui" numberOfLines={1}>{placeholder}</Text>
        </Touchable>
        <IconButton name="attachment" onPress={onAttachMedia} size={21} color={c.textMuted} accessibilityLabel="Attach a photo or video" />
        <IconButton name="mic" onPress={onAttachVoice} size={21} color={c.textMuted} accessibilityLabel="Record a voice answer" />
      </View>
    )
  }

  return (
    <View style={[styles.frame, { paddingBottom: pad, backgroundColor: c.bg }]}>
      <DoubleRule style={styles.edge} />
      {body}
    </View>
  )
}

const styles = StyleSheet.create({
  frame: {
    position: 'absolute', start: 0, end: 0, bottom: 0,
    paddingHorizontal: space.md, paddingTop: space.sm,
  },
  /* The double rule sits ON the plate's top edge, so the frame draws no
     border of its own — one course would fight the ornament's two. */
  edge: { position: 'absolute', top: 0, start: 0, end: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 44 },
  /* An input stub, so it takes the FIELD setback — the same shape the real
     composer well uses. It is not a pill. */
  stub: {
    flex: 1, height: 36, justifyContent: 'center',
    paddingHorizontal: space.md2, borderWidth: StyleSheet.hairlineWidth,
    ...setback(shape.field), borderCurve: 'continuous',
  },
  lockStrip: { flexDirection: 'row', alignItems: 'center', gap: space.sm2, paddingHorizontal: space.xs2 },
  roleStrip: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.xs2 },
  flex: { flex: 1 },
})
