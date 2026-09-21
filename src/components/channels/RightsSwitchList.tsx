/* =========================================================
   The nine rights, in the order the API declares them.

   RIGHT_KEYS is the order and RIGHT_LABELS is the copy — both
   verbatim, because the wire contract and the explanation the
   user reads have to be the same list. Inventing a tenth toggle,
   or reordering, produces an editor that disagrees with the
   server about what it just saved.

   The whole set is emitted on every change so the caller can
   hand it straight to `admins.set`, which runs `rightsTo` and
   sends all nine flags explicitly: on the REQUEST side null
   means TRUE, so an unchecked box that vanishes from the body
   is transmitted as "grant", not "revoke".
   ========================================================= */
import React from 'react'
import { View } from 'react-native'
import { RIGHT_KEYS, RIGHT_LABELS } from '@/api'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { Field, GroupFooter, GroupLabel, ListRow, RowGroup, Text, Touchable, type IconName } from '@/ui'

/** One glyph per right, in RIGHT_KEYS order. */
const RIGHT_ICONS: Record<string, IconName> = {
  canPostMessages: 'send',
  canEditMessages: 'edit',
  canDeleteMessages: 'trash',
  canPinMessages: 'pin',
  canInviteUsers: 'personAdd',
  canApproveJoinRequests: 'checkCircle',
  canChangeInfo: 'settings',
  canAddAdmins: 'shield',
  canManageLive: 'broadcast',
}

export interface RightsSwitchListProps {
  flags: Record<string, any>
  onChange: (next: Record<string, any>) => void
  disabled?: boolean
  readOnly?: boolean
  /** Hides the custom-title card — the promote flow has no name to set yet. */
  showCustomTitle?: boolean
}

export function RightsSwitchList({
  flags, onChange, disabled, readOnly, showCustomTitle = true,
}: RightsSwitchListProps) {
  const t = useTheme()
  const allOn = RIGHT_KEYS.every((k: string) => flags[k] !== false)

  const setAll = (value: boolean) => {
    const next: Record<string, any> = { ...flags }
    for (const k of RIGHT_KEYS as string[]) next[k] = value
    onChange(next)
  }

  return (
    <View>
      {showCustomTitle ? (
        <>
          <GroupLabel>Custom title</GroupLabel>
          <View style={{ paddingHorizontal: t.layout.screenPadding }}>
            <Field
              value={String(flags.customTitle || '')}
              onChangeText={v => onChange({ ...flags, customTitle: v })}
              placeholder="Admin"
              maxLength={32}
              editable={!readOnly && !disabled}
            />
          </View>
          <GroupFooter>Shown instead of “admin” next to their name.</GroupFooter>
        </>
      ) : null}

      <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
        <View style={{ flex: 1 }}><GroupLabel>Rights</GroupLabel></View>
        {!readOnly ? (
          <Touchable
            onPress={() => setAll(!allOn)}
            feedback="dim"
            disabled={disabled}
            style={{ paddingHorizontal: t.layout.screenPadding, paddingBottom: space.sm }}
          >
            <Text variant="subhead" tone="accent" align="ui">{allOn ? 'None' : 'All'}</Text>
          </Touchable>
        ) : null}
      </View>

      <RowGroup>
        {(RIGHT_KEYS as string[]).map(key => {
          const [label, hint] = (RIGHT_LABELS as unknown as Record<string, [string, string]>)[key]
          return (
            <ListRow
              key={key}
              title={label}
              subtitle={hint}
              icon={RIGHT_ICONS[key]}
              iconTone="plain"
              disabled={disabled || readOnly}
              accessory={{
                kind: 'switch',
                value: flags[key] !== false,
                disabled: disabled || readOnly,
                onValueChange: v => onChange({ ...flags, [key]: v }),
              }}
            />
          )
        })}
      </RowGroup>
      <GroupFooter>
        Every right is sent explicitly — an off switch is stored as off, not as a default.
      </GroupFooter>
    </View>
  )
}
