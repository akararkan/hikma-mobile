/* =========================================================
   Report a question or an answer.

   The server dedupes an open report for the same
   (target, reason) and returns it unchanged, so a repeat
   submission is a SUCCESS — telling the user "already
   reported" would be both wrong and a confirmation oracle.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { api, errorText, REPORT_REASONS } from '@/api'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { Button, Field, ListRow, Sheet, Text, toast } from '@/ui'

export function ReportSheet({
  visible, onClose, targetType, targetId,
}: {
  visible: boolean
  onClose: () => void
  targetType: 'QUESTION' | 'ANSWER'
  targetId: string | null
}) {
  const t = useTheme()
  const [reason, setReason] = React.useState<string | null>(null)
  const [details, setDetails] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<any>(null)

  React.useEffect(() => {
    if (!visible) return
    setReason(null); setDetails(''); setBusy(false); setError(null)
  }, [visible])

  const submit = async () => {
    if (!reason || !targetId) return
    setBusy(true)
    setError(null)
    try {
      /* targetRef is the MESSAGE-target escape hatch (Snowflake ids); QUESTION
         and ANSWER ids are UUIDs and always travel in targetId. */
      await api.settings.safety.report({ targetType, targetId, targetRef: undefined, reason, details: details.trim() || undefined })
      setBusy(false)
      onClose()
      toast.ok('Thanks — we’ll take a look.')
    } catch (e: any) {
      setBusy(false)
      setError(e)
    }
  }

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={targetType === 'ANSWER' ? 'Report this answer' : 'Report this question'}
      subtitle="Reports are anonymous to the author."
      footer={
        <View style={styles.row}>
          <Button label="Cancel" variant="secondary" size="lg" onPress={onClose} style={styles.flex} />
          <Button label="Submit" size="lg" disabled={!reason} loading={busy} onPress={submit} style={styles.flex} />
        </View>
      }
    >
      {(REPORT_REASONS as [string, string][]).map(([code, label]) => (
        <ListRow
          key={code}
          title={label}
          accessory={{ kind: 'radio', checked: reason === code }}
          onPress={() => setReason(code)}
        />
      ))}
      <View style={{ padding: t.layout.screenPadding, paddingTop: space.sm }}>
        <Field
          label="Anything else? (optional)"
          value={details}
          onChangeText={setDetails}
          placeholder="Add context that would help a reviewer."
          multiline
          maxLength={1000}
          minHeight={88}
          editable={!busy}
        />
        {error ? (
          <Text variant="footnote" tone="danger" align="ui" style={{ marginTop: space.sm }}>{errorText(error)}</Text>
        ) : null}
      </View>
    </Sheet>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.sm2 },
  flex: { flex: 1 },
})
