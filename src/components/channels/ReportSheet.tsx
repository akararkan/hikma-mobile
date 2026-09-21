/* =========================================================
   The report reason picker.

   `POST /safety/reports` dedupes an open report for the same
   (target, reason) server-side and answers with the existing
   row, so a double submit is safe and never needs a client
   guard beyond the button's own pending state.
   ========================================================= */
import React from 'react'
import { View } from 'react-native'
import { REPORT_REASONS, api, errorText } from '@/api'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { Button, Field, ListRow, RowGroup, Sheet, Text, toast } from '@/ui'
import { args } from './apiArgs'

export function ReportSheet({
  visible, onClose, targetType, targetId, subject,
}: {
  visible: boolean
  onClose: () => void
  targetType: 'CHANNEL' | 'MESSAGE' | 'USER'
  targetId?: string | null
  subject?: string
}) {
  const t = useTheme()
  const [reason, setReason] = React.useState<string | null>(null)
  const [details, setDetails] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    if (!visible) { setReason(null); setDetails('') }
  }, [visible])

  const submit = async () => {
    if (!reason || !targetId) return
    setBusy(true)
    try {
      /* MESSAGE targets carry a Snowflake — the api module routes it into
         `targetRef` itself; `args()` is only the usual inference seam. */
      await api.settings.safety.report(args({ targetType, targetId, reason, details: details.trim() || undefined }))
      onClose()
      toast.ok('Thanks — we’ll take a look.')
    } catch (e: any) {
      toast.error(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Report"
      subtitle={subject}
      maxHeightRatio={0.86}
      footer={
        <Button
          label="Submit report"
          onPress={submit}
          disabled={!reason}
          loading={busy}
          variant="danger"
          size="lg"
          block
        />
      }
    >
      <View style={{ paddingTop: space.sm2, gap: space.md }}>
        <RowGroup inset={t.layout.screenPadding}>
          {(REPORT_REASONS as [string, string][]).map(([key, label]) => (
            <ListRow
              key={key}
              title={label}
              accessory={{ kind: 'radio', checked: reason === key }}
              onPress={() => setReason(key)}
            />
          ))}
        </RowGroup>
        <View style={{ paddingHorizontal: t.layout.screenPadding, gap: space.xs2 }}>
          <Field
            label="Anything else? (optional)"
            value={details}
            onChangeText={setDetails}
            multiline
            maxLength={240}
            placeholder="Add context that helps a reviewer"
          />
          <Text variant="footnote" tone="muted" align="ui">
            Reports are confidential. The account you report is never told who filed it.
          </Text>
        </View>
      </View>
    </Sheet>
  )
}
