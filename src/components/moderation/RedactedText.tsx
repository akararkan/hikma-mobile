/* =========================================================
   RedactedText — the content-privacy boundary, drawn.

   Chat and live-chat bodies are withheld from staff BY POLICY.
   The case still carries its scores, labels, verdict and
   thresholds, so a moderator can decide without ever reading a
   private message — and this panel is what says so out loud
   instead of leaving a suspicious empty box.

   Recognition is STRUCTURAL (`isRedactedText`), never a string
   comparison here: the placeholder sentence is server-owned and
   a re-wording upstream must degrade to "render it as text",
   not to "render a private message as if it were content".

   Selection and the long-press context menu are off on the
   redacted branch. There is nothing there worth copying, and an
   affordance that implies otherwise is the wrong message on the
   one screen where the boundary has to be unambiguous.
   ========================================================= */
import React from 'react'
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import { MODERATION_REDACTED, isRedactedText } from '@/api'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { Icon, Text } from '@/ui'

export function RedactedText({
  text, style,
}: {
  text?: string | null
  style?: StyleProp<ViewStyle>
}) {
  const t = useTheme()
  const c = t.colors

  if (!isRedactedText(text)) {
    return (
      <View
        style={[
          styles.body,
          { backgroundColor: c.surfaceSunken, borderRadius: t.radius.sm },
          style,
        ]}
      >
        {/* align="auto": the case body may be Arabic or Kurdish inside an
            English console. */}
        <Text variant="body" align="auto" selectable>{text ?? ''}</Text>
      </View>
    )
  }

  return (
    <View
      style={[
        styles.panel,
        { backgroundColor: c.warningSoft, borderColor: c.warning, borderRadius: t.radius.sm },
        style,
      ]}
    >
      <Icon name="lock" size={20} color={c.warningText} />
      <Text
        variant="footnote"
        tone="muted"
        italic
        align="center"
        selectable={false}
        style={{ maxWidth: 320 }}
      >
        {MODERATION_REDACTED}
      </Text>
      <Text variant="caption" tone="faint" align="center" selectable={false}>
        Decide from the scores.
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  body: { padding: space.md },
  panel: {
    minHeight: 64,
    paddingVertical: space.md2,
    paddingHorizontal: space.lg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs2,
    borderWidth: StyleSheet.hairlineWidth,
  },
})
