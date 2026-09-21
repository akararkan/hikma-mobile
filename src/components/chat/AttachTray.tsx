/* =========================================================
   The attach tray and the poll composer.

   Each pick sets the matching typing ACTIVITY for the duration
   of the pick and the upload — "sending a photo…" is a far
   better answer to twelve seconds of silence than "typing…",
   and the server already carries the verb.

   Location shares ONE fix, never a subscription. The permission
   string in app.json promises the position is read only when
   you choose to attach it, so the pick asks for foreground
   permission at the tap and takes a single reading — the
   `live` pin a watch would produce is a different feature with
   a different promise attached to it.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { ActionSheet, Button, Field, Icon, Sheet, Text, Touchable } from '@/ui'

export type AttachKind = 'photos' | 'camera' | 'document' | 'contact' | 'location' | 'poll' | 'schedule'

export function AttachTray({
  visible, onClose, onPick, allowSchedule = true,
}: {
  visible: boolean
  onClose: () => void
  onPick: (kind: AttachKind) => void
  allowSchedule?: boolean
}) {
  return (
    <ActionSheet
      visible={visible}
      onClose={onClose}
      title="Attach"
      actions={[
        { label: 'Photo or video', icon: 'gallery', onPress: () => onPick('photos') },
        { label: 'Camera', icon: 'camera', onPress: () => onPick('camera') },
        { label: 'Document', icon: 'file', onPress: () => onPick('document') },
        { label: 'Contact', icon: 'contacts', onPress: () => onPick('contact') },
        { label: 'Location', icon: 'location', subtitle: 'Sends where you are now', onPress: () => onPick('location') },
        { label: 'Poll', icon: 'poll', onPress: () => onPick('poll') },
        { label: 'Schedule a message', icon: 'calendar', onPress: () => onPick('schedule'), hidden: !allowSchedule },
      ]}
    />
  )
}

/* ---------------------------------------------------------
   Poll composer.

   The typed payload must MATCH `type` — a POLL send with no
   poll is a 400 — so the sheet refuses to emit until there is
   a question and two real options.
   --------------------------------------------------------- */

export interface DraftPoll {
  question: string
  options: { text: string }[]
  allowsMultipleAnswers: boolean
  anonymous: boolean
}

const MAX_OPTIONS = 10

export function PollComposer({
  visible, onClose, onSubmit,
}: { visible: boolean; onClose: () => void; onSubmit: (poll: DraftPoll) => void }) {
  const t = useTheme()
  const [question, setQuestion] = React.useState('')
  const [options, setOptions] = React.useState<string[]>(['', ''])
  const [multi, setMulti] = React.useState(false)
  const [anonymous, setAnonymous] = React.useState(true)

  const reset = () => { setQuestion(''); setOptions(['', '']); setMulti(false); setAnonymous(true) }

  const filled = options.map(o => o.trim()).filter(Boolean)
  const valid = question.trim().length > 0 && filled.length >= 2

  return (
    <Sheet visible={visible} onClose={onClose} title="New poll" maxHeightRatio={0.85}>
      <View style={styles.body}>
        <Field
          label="Question"
          value={question}
          onChangeText={setQuestion}
          placeholder="Ask something"
          maxLength={300}
        />

        {options.map((o, i) => (
          <Field
            key={i}
            label={i < 2 ? `Option ${i + 1}` : undefined}
            value={o}
            onChangeText={v => setOptions(prev => prev.map((x, j) => (j === i ? v : x)))}
            placeholder={`Option ${i + 1}`}
            maxLength={120}
            action={i >= 2 ? {
              icon: 'close',
              label: 'Remove option',
              onPress: () => setOptions(prev => prev.filter((_, j) => j !== i)),
            } : null}
          />
        ))}

        {options.length < MAX_OPTIONS ? (
          <Touchable onPress={() => setOptions(prev => [...prev, ''])} feedback="dim" noAutoHitSlop style={styles.addRow}>
            <Icon name="add" size={18} color={t.colors.accent} />
            <Text variant="footnote" tone="accent" align="ui">Add option</Text>
          </Touchable>
        ) : null}

        <View style={styles.toggles}>
          <Toggle label="Multiple answers" value={multi} onPress={() => setMulti(v => !v)} />
          <Toggle label="Anonymous" value={anonymous} onPress={() => setAnonymous(v => !v)} />
        </View>

        <Button
          label="Create poll"
          onPress={() => {
            onSubmit({
              question: question.trim(),
              options: filled.map(text => ({ text })),
              allowsMultipleAnswers: multi,
              anonymous,
            })
            reset()
            onClose()
          }}
          disabled={!valid}
          size="lg"
          block
          style={{ marginTop: space.xs2 }}
        />
      </View>
    </Sheet>
  )
}

function Toggle({ label, value, onPress }: { label: string; value: boolean; onPress: () => void }) {
  const t = useTheme()
  return (
    <Touchable
      onPress={onPress}
      feedback="dim"
      haptic="select"
      noAutoHitSlop
      /* The glyph swap is the only visible state — announce it, or both poll
         options read as an identical bare "button" (ListRow's rule). */
      accessibilityRole="checkbox"
      accessibilityState={{ checked: value }}
      style={styles.toggle}
    >
      <Icon
        name={value ? 'checkCircle' : 'addCircle'}
        size={20}
        color={value ? t.colors.accent : t.colors.textFaint}
        filled={value}
      />
      <Text variant="footnote" align="ui">{label}</Text>
    </Touchable>
  )
}

const styles = StyleSheet.create({
  body: { padding: space.xl, paddingTop: space.md, gap: space.md },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs2, paddingVertical: space.xs2 },
  toggles: { gap: space.sm2, paddingTop: space.xs },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
})
