/* =========================================================
   Form fields — OXFORD inputs (DESIGN.md §6).

   A field is a boxed white input: white fill, a 1px stone
   border on a friendly 10pt radius. Focus turns the border
   link blue; errors turn it danger. Placeholders wear the
   decorative `placeholder` grey and never carry required
   information.

   The error contract matters more than the styling: every
   write in this app can come back with `fieldErrorMap(err)`
   from the API's error module, so `Field` takes an `error`
   string and owns the whole presentation of it — the danger
   border, the message, and the assertive announcement. A
   screen never draws its own error text.

   THE ONE SANCTIONED fontFamily CALL SITE (§10 DON'T #7).
   RN does not inherit fonts, and `TextInput` is not `Text`:
   left alone it renders what the user types in the OS system
   face while the label above it and the error below it wear
   IBM Plex. `inputFace()` from ./Text closes that gap here so
   no screen ever has to reach for `fontFamily` itself.

   The face is picked from the INTERFACE, wholesale — never
   from the string being typed. A TextInput carries one family
   for the whole field and cannot switch it per run, so an
   ar/ckb interface takes Vazirmatn for everything in it,
   including a Latin password, and an English interface keeps
   Plex even while Arabic is being typed into it. Do not
   "improve" this by sniffing `value`: the family would swap
   under the cursor mid-word.
   ========================================================= */
import React from 'react'
import {
  StyleSheet, TextInput, View,
  type TextInputProps, type StyleProp, type TextStyle, type ViewStyle,
} from 'react-native'
import { useTheme } from '@/theme/ThemeProvider'
import { setback, space } from '@/theme/tokens'
import { Text, inputFace } from './Text'
import { Icon, type IconName } from './Icon'
import { Touchable } from './Touchable'

export interface FieldProps extends Omit<TextInputProps, 'style' | 'onChange'> {
  label?: string
  hint?: string
  error?: string | null
  icon?: IconName
  /** Trailing affordance — the eye on a password, the clear × on a search. */
  action?: { icon: IconName; onPress: () => void; label: string } | null
  /** Character budget; shows a live counter once past 80%. */
  maxLength?: number
  multiline?: boolean
  minHeight?: number
  containerStyle?: StyleProp<ViewStyle>
  /** Render the label inside the field's top edge — denser forms. */
  floating?: boolean
  required?: boolean
}

export const Field = React.forwardRef<TextInput, FieldProps>(function Field({
  label, hint, error, icon, action, maxLength, multiline, minHeight,
  containerStyle, floating = false, required, value, onFocus, onBlur, ...rest
}, ref) {
  const t = useTheme()
  const c = t.colors
  const [focused, setFocused] = React.useState(false)
  const len = String(value ?? '').length
  const showCount = !!maxLength && len >= maxLength * 0.8

  /* The border tells the state: stone at rest, link blue on focus, danger
     on error. Width is constant so state changes never shift the layout. */
  const borderColor = error ? c.danger : focused ? c.link : c.border

  /* See the header for WHICH face and why. The weight steps with the phone's
     Bold Text exactly as the `Text` ramp does — the typed value is otherwise
     the one string in the app that ignores that setting. `isRTL` IS the
     Arabic-script test here: the locales are EN / AR / KU and nothing else. */
  const faceWeight = t.a11y.boldText ? 600 : 400
  const face = inputFace(faceWeight, t.isRTL)

  return (
    <View style={containerStyle}>
      {label && !floating ? (
        <View style={styles.labelRow}>
          <Text variant="subhead" tone="secondary" weight="600" align="ui">{label}</Text>
          {required ? <Text variant="subhead" tone="danger"> *</Text> : null}
        </View>
      ) : null}

      <View
        style={[
          styles.box,
          setback(t.shape.field),
          {
            backgroundColor: c.surface,
            borderWidth: t.rule.course,
            borderColor,
            borderCurve: 'continuous',
            minHeight: minHeight ?? (multiline ? 96 : 44),
            alignItems: multiline ? 'flex-start' : 'center',
            paddingVertical: multiline ? 10 : 0,
          },
        ]}
      >
        {icon ? (
          <Icon name={icon} size={18} color={error ? c.danger : focused ? c.link : c.textFaint} style={{ marginTop: multiline ? 3 : 0 }} />
        ) : null}

        <View style={styles.flex}>
          {floating && label ? (
            <Text variant="caption" tone="muted" align="ui" style={{ marginBottom: space.xxs }}>{label}</Text>
          ) : null}
          <TextInput
            ref={ref}
            value={value}
            maxLength={maxLength}
            multiline={multiline}
            placeholderTextColor={c.placeholder}
            selectionColor={c.accent}
            cursorColor={c.accent}
            onFocus={e => { setFocused(true); onFocus?.(e) }}
            onBlur={e => { setFocused(false); onBlur?.(e) }}
            /* RN does not associate the visible label with the input — the
               label is a sibling Text in another View — so a screen reader
               lands on a filled field and announces the VALUE with no idea
               which field it is in. Named here rather than at 139 call sites.
               Both sit BEFORE the spread so a call site can still override. */
            accessibilityLabel={label ? (required ? `${label}, required` : label) : undefined}
            accessibilityHint={error ?? hint}
            style={[
              styles.input,
              {
                color: c.text,
                fontSize: t.type.body.fontSize,
                /* A resolved face carries its own weight; the fallback branch
                   is the only place a numeric weight belongs (same rule as
                   Text: a static face + a numeric weight invites faux-bold). */
                ...(face
                  ? { fontFamily: face }
                  : { fontWeight: String(faceWeight) as TextStyle['fontWeight'] }),
                lineHeight: multiline ? t.type.body.lineHeight : undefined,
                textAlign: t.isRTL ? 'right' : 'left',
                writingDirection: t.isRTL ? 'rtl' : 'ltr',
                textAlignVertical: multiline ? 'top' : 'center',
                minHeight: multiline ? 72 : undefined,
              },
            ]}
            {...rest}
          />
        </View>

        {action ? (
          <Touchable onPress={action.onPress} feedback="dim" accessibilityLabel={action.label} style={{ padding: space.xs }}>
            <Icon name={action.icon} size={18} color={c.textMuted} />
          </Touchable>
        ) : null}

      </View>

      {error ? (
        <View style={styles.footRow} accessibilityLiveRegion="assertive">
          <Icon name="error" size={13} color={c.danger} />
          <Text variant="footnote" tone="danger" align="ui" style={styles.flex}>{error}</Text>
        </View>
      ) : hint ? (
        <View style={styles.footRow}>
          <Text variant="footnote" tone="muted" align="ui" style={styles.flex}>{hint}</Text>
          {showCount ? <Text variant="footnote" tone={len >= (maxLength ?? 0) ? 'danger' : 'muted'}>{len}/{maxLength}</Text> : null}
        </View>
      ) : showCount ? (
        <View style={styles.footRow}>
          <View style={styles.flex} />
          <Text variant="footnote" tone={len >= (maxLength ?? 0) ? 'danger' : 'muted'}>{len}/{maxLength}</Text>
        </View>
      ) : null}
    </View>
  )
})

/* ---------------------------------------------------------
   SearchField — the ledger well at the top of every discovery
   surface: same sunken well as Field but uniform 10pt radii,
   a start-side magnifier in textMuted, and no baseline rule
   (search commits on submit; there is no ledger entry to
   underline). Debouncing belongs to the caller; this owns the
   clear button and the submit behaviour.
   --------------------------------------------------------- */

export interface SearchFieldProps {
  value: string
  onChangeText: (v: string) => void
  placeholder?: string
  onSubmit?: () => void
  onFocus?: () => void
  autoFocus?: boolean
  /** A cancel affordance beside the field — the full-screen search mode. */
  onCancel?: () => void
  /** Announced state for assistive tech — `{ busy: true }` while a request is
   *  in flight, since the visual signal (the progress hairline) is decorative. */
  accessibilityState?: TextInputProps['accessibilityState']
  style?: StyleProp<ViewStyle>
}

export function SearchField({
  value, onChangeText, placeholder = 'Search', onSubmit, onFocus, autoFocus, onCancel, accessibilityState, style,
}: SearchFieldProps) {
  const t = useTheme()
  const c = t.colors
  /* Same sanctioned face as Field — a query typed into the well should not
     be the only Plex-less string on a discovery screen. */
  const faceWeight = t.a11y.boldText ? 600 : 400
  const face = inputFace(faceWeight, t.isRTL)
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', gap: space.sm2 }, style]}>
      <View
        style={[
          styles.box,
          {
            flex: 1,
            backgroundColor: c.bgSunken,
            borderRadius: t.radius.field,
            borderCurve: 'continuous',
            height: 40,
            alignItems: 'center',
          },
        ]}
      >
        <Icon name="search" size={17} color={c.textMuted} />
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={c.placeholder}
          selectionColor={c.accent}
          returnKeyType="search"
          autoFocus={autoFocus}
          autoCorrect={false}
          autoCapitalize="none"
          onFocus={onFocus}
          onSubmitEditing={onSubmit}
          /* The state belongs on the INPUT: it used to sit on the wrapping
             View, which has `accessible` unset and is therefore never an
             accessibility element — `{ busy: true }` was drawn nowhere and
             announced nowhere, so a slow query and an empty result sounded
             identical. The placeholder is the well's only visible name. */
          accessibilityState={accessibilityState}
          accessibilityLabel={placeholder}
          style={[
            styles.input,
            {
              color: c.text,
              fontSize: t.type.callout.fontSize,
              ...(face
                ? { fontFamily: face }
                : { fontWeight: String(faceWeight) as TextStyle['fontWeight'] }),
              textAlign: t.isRTL ? 'right' : 'left',
              flex: 1,
            },
          ]}
        />
        {value ? (
          <Touchable onPress={() => onChangeText('')} feedback="dim" accessibilityLabel="Clear search" style={{ padding: space.xs }}>
            <Icon name="close" size={15} color={c.textMuted} />
          </Touchable>
        ) : null}
      </View>
      {onCancel ? (
        <Touchable onPress={onCancel} feedback="dim">
          <Text variant="callout" tone="accent">Cancel</Text>
        </Touchable>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  labelRow: { flexDirection: 'row', alignItems: 'center', marginBottom: space.xs2 },
  box: { flexDirection: 'row', gap: space.sm2, paddingHorizontal: space.md2 },
  input: { flex: 1, padding: 0, margin: 0 },
  flex: { flex: 1 },
  footRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs2, marginTop: space.xs2, paddingHorizontal: space.xxs },
})
