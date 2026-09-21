/* =========================================================
   The shared body input.

   `maxLength` is a prop and not a constant because the two
   caps genuinely differ: 10000 when creating an answer, 5000
   on the edit endpoint. Hardcoding either one produces a
   composer that either truncates good text or lets the user
   write 8000 characters the save will refuse.
   ========================================================= */
import React from 'react'
import { StyleSheet, TextInput, View, type NativeSyntheticEvent, type TextInputSelectionChangeEventData } from 'react-native'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { Text } from '@/ui'
import { activeMentionQuery, applyMention } from './MentionAutocomplete'

export interface AnswerBodyEditorProps {
  value: string
  onChangeText: (v: string) => void
  maxLength: number
  placeholder: string
  autoFocus?: boolean
  editable?: boolean
  minHeight?: number
  fontSize?: number
  lineHeight?: number
  error?: string | null
  /** Threshold at which the counter appears. Defaults to 90% of the cap. */
  counterFrom?: number
  onMentionQueryChange?: (q: string | null) => void
}

export interface AnswerBodyEditorHandle {
  focus: () => void
  pickMention: (handle: string) => void
}

export const AnswerBodyEditor = React.forwardRef<AnswerBodyEditorHandle, AnswerBodyEditorProps>(
  function AnswerBodyEditor({
    value, onChangeText, maxLength, placeholder, autoFocus, editable = true,
    minHeight = 200, fontSize, lineHeight, error, counterFrom, onMentionQueryChange,
  }, ref) {
    const t = useTheme()
    const c = t.colors
    const input = React.useRef<TextInput>(null)
    const caret = React.useRef<number | null>(null)

    const threshold = counterFrom ?? Math.round(maxLength * 0.9)
    const len = value.length

    const emitQuery = React.useCallback((text: string, end: number | null) => {
      onMentionQueryChange?.(activeMentionQuery(text, end ?? undefined))
    }, [onMentionQueryChange])

    React.useImperativeHandle(ref, () => ({
      focus: () => input.current?.focus(),
      pickMention: (handle: string) => {
        const next = applyMention(value, handle, caret.current ?? undefined)
        onChangeText(next)
        onMentionQueryChange?.(null)
      },
    }), [value, onChangeText, onMentionQueryChange])

    const onSelectionChange = (e: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => {
      const { start, end } = e.nativeEvent.selection
      caret.current = start === end ? end : null
      emitQuery(value, caret.current)
    }

    return (
      <View>
        <TextInput
          ref={input}
          value={value}
          onChangeText={v => { onChangeText(v); emitQuery(v, caret.current) }}
          onSelectionChange={onSelectionChange}
          /* The keyboard dismissing must close the list too, or it floats
             over the toolbar with nothing to dock against. */
          onBlur={() => onMentionQueryChange?.(null)}
          placeholder={placeholder}
          placeholderTextColor={c.textFaint}
          selectionColor={c.accent}
          cursorColor={c.accent}
          multiline
          autoFocus={autoFocus}
          editable={editable}
          maxLength={maxLength}
          scrollEnabled={false}
          textAlignVertical="top"
          style={[
            styles.input,
            {
              minHeight,
              color: c.text,
              fontSize: fontSize ?? 16 * t.fontScale,
              lineHeight: lineHeight ?? 24 * t.fontScale,
              textAlign: t.isRTL ? 'right' : 'left',
              writingDirection: t.isRTL ? 'rtl' : 'ltr',
              opacity: editable ? 1 : 0.6,
            },
          ]}
        />
        {error ? (
          <Text variant="footnote" tone="danger" align="ui" style={{ marginTop: space.xs }}>{error}</Text>
        ) : null}
        {len >= threshold ? (
          <Text
            variant="footnote"
            weight="500"
            tone={len >= maxLength ? 'danger' : 'muted'}
            align={t.isRTL ? 'left' : 'right'}
            style={{ marginTop: space.xs }}
          >
            {len}/{maxLength}
          </Text>
        ) : null}
      </View>
    )
  },
)

const styles = StyleSheet.create({
  input: { padding: 0, margin: 0 },
})
