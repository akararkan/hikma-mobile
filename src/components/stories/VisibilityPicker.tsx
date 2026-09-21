/* =========================================================
   VisibilityPicker — who gets to see this.

   The CLOSE_FRIENDS row is the only one that needs a number,
   and it reads that number from the ONE list the backend
   actually enforces (api.closeCircle). The profile-rich
   /users/me/close-friends list grants nothing and must never
   be what this row counts.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useRouter } from 'expo-router'
import { Icon, Sheet, Text, Touchable } from '@/ui'
import { useTheme } from '@/theme/ThemeProvider'
import { setback, shape, space } from '@/theme/tokens'
import { CLOSE_GREEN, ink, withAlpha } from './night'
import { VISIBILITIES, VISIBILITY_GLYPH, VISIBILITY_HINT, VISIBILITY_LABEL } from './visibility'
import type { StoryVisibility } from './storyVisual'

export { VISIBILITY_GLYPH, VISIBILITY_LABEL, VISIBILITY_HINT } from './visibility'

export interface VisibilityPickerProps {
  value: StoryVisibility
  onChange: (v: StoryVisibility) => void
  /** null while unknown — never render a guessed 0. */
  closeFriendCount?: number | null
  onEditCloseFriends?: () => void
}

/** The plate that opens the sheet. Dark-surface styling: it lives on the
 *  composer's bottom bar, over the frame. Named `VisibilityPill` from before
 *  QELAT; it wears the button setback now — the two sanctioned pills are
 *  unread counters and LIVE badges. */
export function VisibilityPill({ value, onPress }: { value: StoryVisibility; onPress: () => void }) {
  return (
    <Touchable
      onPress={onPress}
      feedback="scale"
      noAutoHitSlop
      accessibilityLabel={`Audience: ${VISIBILITY_LABEL[value]}`}
      style={[styles.pill, { backgroundColor: ink.fillStrong }]}
    >
      <Icon
        name={VISIBILITY_GLYPH[value]}
        size={16}
        color={value === 'CLOSE_FRIENDS' ? CLOSE_GREEN : ink.full}
        filled={value === 'CLOSE_FRIENDS'}
      />
      <Text variant="callout" weight="600" color={ink.full}>{VISIBILITY_LABEL[value]}</Text>
      <Icon name="down" size={13} color={ink.muted} />
    </Touchable>
  )
}

export function VisibilitySheet({
  visible, onClose, value, onChange, closeFriendCount, onEditCloseFriends,
}: VisibilityPickerProps & { visible: boolean; onClose: () => void }) {
  const t = useTheme()
  const router = useRouter()

  return (
    <Sheet visible={visible} onClose={onClose} title="Who can see this?">
      <View style={{ paddingBottom: space.xs2 }}>
        {VISIBILITIES.map(v => {
          const active = v === value
          return (
            <View key={v}>
              <Touchable
                onPress={() => { onChange(v); onClose() }}
                feedback="tint"
                noAutoHitSlop
                accessibilityState={{ selected: active }}
                style={styles.row}
              >
                <View style={[styles.glyph, { backgroundColor: v === 'CLOSE_FRIENDS' ? withAlpha(CLOSE_GREEN, 0.14) : t.colors.surfaceSunken }]}>
                  <Icon
                    name={VISIBILITY_GLYPH[v]}
                    size={19}
                    color={v === 'CLOSE_FRIENDS' ? CLOSE_GREEN : t.colors.textSecondary}
                    filled={v === 'CLOSE_FRIENDS'}
                  />
                </View>
                <View style={{ flex: 1, gap: space.xxs }}>
                  <Text variant="bodyStrong" align="ui">{VISIBILITY_LABEL[v]}</Text>
                  <Text variant="footnote" tone="muted" align="ui">{VISIBILITY_HINT[v]}</Text>
                </View>
                <View
                  style={[
                    styles.radio,
                    { borderColor: active ? t.colors.accent : t.colors.borderStrong, backgroundColor: active ? t.colors.accent : 'transparent' },
                  ]}
                >
                  {active ? <Icon name="check" size={13} color={t.colors.textOnAccent} /> : null}
                </View>
              </Touchable>

              {v === 'CLOSE_FRIENDS' ? (
                <Touchable
                  onPress={() => { onClose(); (onEditCloseFriends ?? (() => router.push('/close-friends' as any)))() }}
                  feedback="dim"
                  noAutoHitSlop
                  style={styles.subRow}
                >
                  <Text variant="footnote" tone="muted" align="ui">
                    {closeFriendCount == null
                      ? 'Manage your list'
                      : `${closeFriendCount} ${closeFriendCount === 1 ? 'person' : 'people'}`}
                  </Text>
                  <Text variant="footnote" tone="accent" align="ui"> · Edit</Text>
                </Touchable>
              ) : null}
            </View>
          )
        })}
      </View>
    </Sheet>
  )
}

/** Trigger + sheet, for callers that do not want to own the open state. */
export function VisibilityPicker(props: VisibilityPickerProps) {
  const [open, setOpen] = React.useState(false)
  return (
    <>
      <VisibilityPill value={props.value} onPress={() => setOpen(true)} />
      <VisibilitySheet {...props} visible={open} onClose={() => setOpen(false)} />
    </>
  )
}

const styles = StyleSheet.create({
  pill: {
    height: 38,
    ...setback(shape.buttonMd),
    borderCurve: 'continuous',
    paddingHorizontal: space.md2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md2, paddingHorizontal: space.xl, height: 64 },
  subRow: { flexDirection: 'row', alignItems: 'center', paddingStart: 74, paddingBottom: space.md, marginTop: -space.sm },
  glyph: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
})
