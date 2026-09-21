/* =========================================================
   ReportSheet.

   The reasons come from REPORT_REASONS so the enum and the
   labels can never drift apart, and a duplicate open report is
   DEDUPED server-side and returned as-is — that is a success,
   not a 409, so it gets the "already reviewing this" line
   rather than an error.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { api, errorText, REPORT_REASONS } from '@/api'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  Button, Callout, Field, Icon, Sheet, Text, Touchable, fireHaptic, toast,
} from '@/ui'

export interface ReportSheetProps {
  visible: boolean
  onClose: () => void
  targetType: 'USER' | 'POST' | 'COMMENT' | 'RESEARCH' | 'QUESTION' | 'ANSWER' | 'MESSAGE' | 'CHANNEL' | 'STORY'
  targetId: string
  /** Named in the sheet's subtitle so the user knows what they are reporting. */
  subject?: string
  onDone?: () => void
}

export function ReportSheet({ visible, onClose, targetType, targetId, subject, onDone }: ReportSheetProps) {
  const t = useTheme()
  const [reason, setReason] = React.useState<string | null>(null)
  const [details, setDetails] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<any>(null)

  React.useEffect(() => {
    if (!visible) return
    setReason(null); setDetails(''); setError(null); setBusy(false)
  }, [visible])

  const submit = async () => {
    if (!reason || busy) return
    setBusy(true)
    setError(null)
    try {
      await api.settings.safety.report({ targetType, targetId, reason, details: details.trim() })
      fireHaptic('success')
      onClose()
      toast.ok('Thanks — our team will take a look.')
      onDone?.()
    } catch (e: any) {
      setBusy(false)
      setError(e)
    }
  }

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Report"
      subtitle={subject ? `Reporting ${subject}` : undefined}
      maxHeightRatio={0.9}
      footer={
        <Button
          label={busy ? 'Sending…' : 'Submit report'}
          onPress={submit}
          variant="danger"
          size="lg"
          block
          loading={busy}
          disabled={!reason || busy}
        />
      }
    >
      <View style={{ padding: t.layout.screenPadding, gap: space.sm2 }}>
        <Text variant="footnote" tone="muted" align="ui">
          Pick the closest reason. Reports are reviewed by people, and the account is
          never told who reported it.
        </Text>

        {error ? <Callout tone="danger">{errorText(error)}</Callout> : null}

        <View style={{ gap: space.xs2, marginTop: space.xxs }}>
          {(REPORT_REASONS as [string, string][]).map(([value, label]) => {
            const selected = reason === value
            return (
              <Touchable
                key={value}
                onPress={() => { setReason(value); setError(null) }}
                feedback="tint"
                haptic="select"
                noAutoHitSlop
                accessibilityState={{ selected }}
                style={[
                  styles.reason,
                  {
                    borderRadius: t.radius.md,
                    borderColor: selected ? t.colors.accent : t.colors.border,
                    borderWidth: selected ? 1.5 : StyleSheet.hairlineWidth,
                    backgroundColor: selected ? t.colors.accentSofter : 'transparent',
                  },
                ]}
              >
                <Text variant="body" align="ui" style={{ flex: 1 }}>{label}</Text>
                {selected ? <Icon name="checkCircle" size={20} color={t.colors.accent} filled /> : null}
              </Touchable>
            )
          })}
        </View>

        <Field
          label="Anything else? (optional)"
          value={details}
          onChangeText={setDetails}
          placeholder="Add context that would help a reviewer."
          multiline
          minHeight={90}
          maxLength={1000}
          editable={!busy}
          containerStyle={{ marginTop: space.xs2 }}
        />
      </View>
    </Sheet>
  )
}

const styles = StyleSheet.create({
  reason: { flexDirection: 'row', alignItems: 'center', gap: space.sm2, paddingHorizontal: space.md2, paddingVertical: space.md2 },
})
