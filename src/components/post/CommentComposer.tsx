/* =========================================================
   CommentComposer — the keyboard-pinned input.

   The whole point of the component is what it does when the
   send FAILS. Three server answers, three different UIs, and
   all three keep the draft verbatim:

     CONTENT_REJECTED   the server's own sentence, no retry
                        button (resubmitting identical text can
                        only fail identically), never a hint
                        about which word tripped.
     429 RATE_LIMITED   'Wait {n}s' on the button, ticking.
     anything else      errorText(e) with the button live.
   ========================================================= */
import React from 'react'
import { StyleSheet, TextInput, View } from 'react-native'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { Avatar, Icon, Text, Touchable } from '@/ui'

export interface CommentComposerProps {
  value: string
  onChange: (v: string) => void
  onSubmit: () => void
  /** The signed-in user, for the leading avatar. */
  me?: { id?: string; full?: string; profileImage?: string | null; avatarUrl?: string | null } | null
  replyingTo?: { handle?: string | null; id?: string } | null
  onCancelReply?: () => void
  busy?: boolean
  /** Seconds left on a 429. > 0 disables send and relabels it. */
  cooldown?: number
  /** Rendered verbatim under the input — moderation copy comes through here. */
  error?: string | null
  disabled?: boolean
  disabledNote?: string | null
  autoFocus?: boolean
  placeholder?: string
  inputRef?: React.RefObject<TextInput | null>
}

export function CommentComposer({
  value, onChange, onSubmit, me, replyingTo, onCancelReply,
  busy, cooldown = 0, error, disabled, disabledNote, autoFocus,
  placeholder = 'Add a comment…', inputRef,
}: CommentComposerProps) {
  const t = useTheme()
  const c = t.colors
  const canSend = value.trim().length > 0 && !busy && cooldown === 0 && !disabled

  return (
    <View style={[styles.wrap, { borderTopColor: c.separator, backgroundColor: c.bg }]}>
      {replyingTo ? (
        <View style={styles.replyStrip}>
          <Icon name="reply" size={13} color={c.textMuted} />
          <Text variant="footnote" tone="muted" numberOfLines={1} style={styles.flex}>
            Replying to @{replyingTo.handle || 'member'}
          </Text>
          {onCancelReply ? (
            <Touchable onPress={onCancelReply} feedback="dim" accessibilityLabel="Cancel reply" hitSlop={10}>
              <Icon name="close" size={14} color={c.textMuted} />
            </Touchable>
          ) : null}
        </View>
      ) : null}

      <View style={styles.row}>
        <Avatar uri={me?.profileImage ?? me?.avatarUrl} name={me?.full} seed={me?.id} size={32} />

        <TextInput
          ref={inputRef}
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={c.textFaint}
          multiline
          autoFocus={autoFocus}
          editable={!disabled}
          allowFontScaling={false}
          style={[
            styles.input,
            {
              color: c.text,
              backgroundColor: c.surfaceSunken,
              borderRadius: 18,
              fontSize: t.type.callout.fontSize,
              lineHeight: t.type.callout.lineHeight,
              writingDirection: t.isRTL ? 'rtl' : 'ltr',
            },
          ]}
        />

        <Touchable
          onPress={onSubmit}
          disabled={!canSend}
          feedback="scale"
          haptic="light"
          accessibilityLabel="Send comment"
          style={[
            styles.send,
            { backgroundColor: canSend ? c.accent : c.surfaceSunken, borderRadius: 16 },
            cooldown > 0 ? styles.sendWide : null,
          ]}
        >
          {cooldown > 0 ? (
            <Text variant="caption" tone="muted">Wait {cooldown}s</Text>
          ) : (
            <Icon name="send" size={16} color={canSend ? c.textOnAccent : c.textFaint} filled />
          )}
        </Touchable>
      </View>

      {error ? (
        <Text variant="footnote" tone="danger" align="ui" style={styles.note}>{error}</Text>
      ) : disabledNote ? (
        <Text variant="footnote" tone="muted" align="ui" style={styles.note}>{disabledNote}</Text>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: space.md, paddingTop: space.sm },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm },
  flex: { flex: 1 },
  replyStrip: { flexDirection: 'row', alignItems: 'center', gap: space.xs2, height: 28 },
  input: {
    flex: 1,
    minHeight: 36,
    maxHeight: 120,
    paddingHorizontal: space.md,
    paddingTop: space.sm,
    paddingBottom: space.sm,
  },
  send: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', marginBottom: space.xxs },
  sendWide: { width: 64 },
  note: { paddingTop: space.xs2, paddingStart: 42 },
})
