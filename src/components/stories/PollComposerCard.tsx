/* =========================================================
   PollComposerCard — the poll editor. Compose-time only: a poll
   is set while the story is being made, never attached after.

   Not built on <Field>: this is a card that floats on top of a
   photograph, so it is white in both schemes and its inputs
   are centred display type rather than labelled form rows.
   ========================================================= */
import React from 'react'
import { StyleSheet, TextInput, View, type StyleProp, type ViewStyle } from 'react-native'
import { Icon, Text, Touchable } from '@/ui'
import { setback, shape, space } from '@/theme/tokens'
import { day, withAlpha } from './night'

export interface PollDraft { question: string; optionA: string; optionB: string }

export const EMPTY_POLL: PollDraft = { question: '', optionA: 'Yes', optionB: 'No' }

/** All three fields are required strings server-side. */
export function isPollValid(v: PollDraft): boolean {
  return !!v.question.trim() && !!v.optionA.trim() && !!v.optionB.trim()
}

export interface PollComposerCardProps {
  value: PollDraft
  onChange: (next: PollDraft) => void
  onRemove?: () => void
  editable?: boolean
  autoFocus?: boolean
  style?: StyleProp<ViewStyle>
}

export function PollComposerCard({
  value, onChange, onRemove, editable = true, autoFocus = false, style,
}: PollComposerCardProps) {
  const set = (patch: Partial<PollDraft>) => onChange({ ...value, ...patch })

  return (
    <View style={[styles.card, { backgroundColor: withAlpha(day.bg, 0.95) }, style]}>
      {onRemove ? (
        <Touchable
          onPress={onRemove}
          feedback="scale"
          style={[styles.remove, { backgroundColor: withAlpha(day.text, 0.08) }]}
          accessibilityLabel="Remove poll"
        >
          <Icon name="close" size={13} color={day.textSecondary} />
        </Touchable>
      ) : null}

      <TextInput
        value={value.question}
        onChangeText={q => set({ question: q })}
        placeholder="Ask a question…"
        placeholderTextColor={withAlpha(day.text, 0.35)}
        style={[styles.question, { color: day.text }]}
        multiline
        maxLength={120}
        autoFocus={autoFocus}
        editable={editable}
        selectionColor={day.accent}
        textAlign="center"
      />

      <View style={[styles.rule, { backgroundColor: withAlpha(day.text, 0.1) }]} />

      <View style={{ gap: space.sm }}>
        {(['optionA', 'optionB'] as const).map(key => (
          <View key={key} style={[styles.option, { backgroundColor: withAlpha(day.text, 0.05) }]}>
            <TextInput
              value={value[key]}
              onChangeText={v => set({ [key]: v } as Partial<PollDraft>)}
              placeholder={key === 'optionA' ? 'Yes' : 'No'}
              placeholderTextColor={withAlpha(day.text, 0.35)}
              style={[styles.optionInput, { color: day.text }]}
              maxLength={40}
              editable={editable}
              selectionColor={day.accent}
              textAlign="center"
            />
            {value[key].length > 34 ? (
              <Text variant="micro" color={day.textMuted} style={styles.counter}>{40 - value[key].length}</Text>
            ) : null}
          </View>
        ))}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  card: { ...setback(shape.card), borderCurve: 'continuous', padding: space.lg2 },
  question: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '700',
    minHeight: 52,
    paddingHorizontal: space.xs,
    paddingTop: space.xs,
  },
  rule: { height: StyleSheet.hairlineWidth, marginVertical: space.md2 },
  option: { height: 52, ...setback(shape.buttonLg), borderCurve: 'continuous', justifyContent: 'center' },
  optionInput: { fontSize: 16, fontWeight: '600', paddingHorizontal: 30 },
  counter: { position: 'absolute', end: 10 },
  remove: {
    position: 'absolute',
    top: 8,
    end: 8,
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
})
