/* =========================================================
   Group permissions.

   The `settings` blob is replaced WHOLE by the PATCH — sending
   a partial object silently resets every knob it omits — so
   every control writes the complete block with one field
   changed.

   No Save button: each control writes immediately with an
   optimistic flip and a rollback, because a permissions screen
   with a Save button is a screen where half the users leave
   without pressing it.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { api, codeOf, errorText } from '@/api'
import { chatError } from '@/lib/chatErrors'
import { useAsync } from '@/hooks/useAsync'
import {
  Callout, ConfirmSheet, GroupFooter, Header, ListRow, RowGroup,
  Screen, ScreenScroll, SegmentedControl, SkeletonList, Spinner, Text, toast, useSheetState,
} from '@/ui'
import { isAdmin } from '@/components/chat/permissions'
import { ChatErrorState } from '@/components/chat/states'
import { space } from '@/theme/tokens'

type Scope = 'ALL_MEMBERS' | 'ADMINS_ONLY'

const SCOPES: { value: Scope; label: string }[] = [
  { value: 'ALL_MEMBERS', label: 'Everyone' },
  { value: 'ADMINS_ONLY', label: 'Admins' },
]

const ROWS: { key: string; title: string; hint: string }[] = [
  { key: 'sendMode', title: 'Send messages', hint: 'Who can post in this group' },
  { key: 'whoCanAddMembers', title: 'Add members', hint: 'Who can bring other people in' },
  { key: 'whoCanEditInfo', title: 'Edit group info', hint: 'Name, description and photo' },
  { key: 'whoCanPin', title: 'Pin messages', hint: 'Who can put a message in the pin bar' },
]

export default function PermissionsScreen() {
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const convId = String(id)

  const convoQ = useAsync<any>(() => api.chat.conversations.get(convId), { deps: [convId] })
  const confirmAdminsOnly = useSheetState()
  const [busy, setBusy] = React.useState<string | null>(null)
  const [denied, setDenied] = React.useState<string | null>(null)

  const convo = convoQ.data
  const settings = convo?.settings || {}
  const editable = !!convo && isAdmin(convo) && !denied

  /* The whole block, every time. A partial `settings` on a PATCH resets the
     knobs it does not mention. */
  const write = React.useCallback(async (key: string, value: any) => {
    if (!convo) return
    const before = convo.settings
    const next = {
      sendMode: settings.sendMode ?? 'ALL_MEMBERS',
      whoCanAddMembers: settings.whoCanAddMembers ?? 'ALL_MEMBERS',
      whoCanEditInfo: settings.whoCanEditInfo ?? 'ADMINS_ONLY',
      whoCanPin: settings.whoCanPin ?? 'ADMINS_ONLY',
      adminsCanPromote: settings.adminsCanPromote !== false,
      historyVisibleToNewMembers: settings.historyVisibleToNewMembers !== false,
      /* Part of the same jsonb blob (GroupSettings.slowModeSeconds) — the
         server replaces the WHOLE object, so omitting this knob silently
         turns slow mode off with every permissions change. */
      slowModeSeconds: Number(settings.slowModeSeconds) || 0,
      [key]: value,
    }

    setBusy(key)
    convoQ.setData((prev: any) => (prev ? { ...prev, settings: next } : prev))
    try {
      const fresh: any = await api.chat.conversations.update(convId, { settings: next })
      if (fresh) convoQ.setData(fresh)
    } catch (e: any) {
      convoQ.setData((prev: any) => (prev ? { ...prev, settings: before } : prev))
      if (codeOf(e) === 'ADMINS_ONLY') setDenied(errorText(e, 'You cannot change this group’s settings.'))
      else if (e?.status === 400) router.back()
      else toast.error(chatError(e, 'Could not change that setting'))
    } finally {
      setBusy(null)
    }
  }, [convo, settings, convId, convoQ, router])

  if (convoQ.loading && !convo) {
    return (
      <Screen background="sunken">
        <Header back title="Permissions" />
        <SkeletonList count={6} />
      </Screen>
    )
  }

  if (!convo) {
    return (
      <Screen background="sunken">
        <Header back title="Permissions" />
        <ChatErrorState error={convoQ.error} title="Could not load these settings" onRetry={convoQ.reload} />
      </Screen>
    )
  }

  return (
    <Screen background="sunken">
      <Header back title="Permissions" />
      <ScreenScroll>
        <Text variant="footnote" tone="muted" align="ui" style={styles.intro}>
          These apply to everyone in the group. Admins and the owner are always exempt from send limits.
        </Text>

        {denied ? <View style={styles.callout}><Callout tone="danger">{denied}</Callout></View> : null}

        <RowGroup inset={16}>
          {ROWS.map(row => (
            <View key={row.key} style={[styles.row, !editable ? styles.dim : null]}>
              <View style={styles.rowText}>
                <Text variant="body" align="ui">{row.title}</Text>
                <Text variant="footnote" tone="muted" align="ui">{row.hint}</Text>
              </View>
              {busy === row.key ? <Spinner /> : null}
              <SegmentedControl
                options={SCOPES}
                value={(settings[row.key] ?? (row.key === 'whoCanEditInfo' || row.key === 'whoCanPin' ? 'ADMINS_ONLY' : 'ALL_MEMBERS')) as Scope}
                onChange={value => {
                  if (!editable) return
                  /* Silencing a whole group is worth one question. */
                  if (row.key === 'sendMode' && value === 'ADMINS_ONLY') confirmAdminsOnly.open()
                  else void write(row.key, value)
                }}
                style={styles.segment}
              />
            </View>
          ))}
        </RowGroup>

        <RowGroup inset={16}>
          <ListRow
            title="Admins can add new admins"
            disabled={!editable}
            accessory={{
              kind: 'switch',
              value: settings.adminsCanPromote !== false,
              disabled: !editable || busy === 'adminsCanPromote',
              onValueChange: next => { void write('adminsCanPromote', next) },
            }}
          />
          <ListRow
            title="New members can see older messages"
            subtitle="When off, people only see messages sent after they join — including in search."
            disabled={!editable}
            accessory={{
              kind: 'switch',
              value: settings.historyVisibleToNewMembers !== false,
              disabled: !editable || busy === 'historyVisibleToNewMembers',
              onValueChange: next => { void write('historyVisibleToNewMembers', next) },
            }}
          />
        </RowGroup>

        {convo.slowModeSeconds ? (
          <RowGroup inset={16}>
            <ListRow
              title="Slow mode"
              subtitle="Non-admins can send one message per interval"
              accessory={{ kind: 'value', text: `${convo.slowModeSeconds}s`, chevron: false }}
            />
          </RowGroup>
        ) : null}

        {!editable && !denied ? (
          <GroupFooter>Only admins can change these.</GroupFooter>
        ) : null}
      </ScreenScroll>

      <ConfirmSheet
        visible={confirmAdminsOnly.visible}
        onClose={confirmAdminsOnly.close}
        title="Only admins can send?"
        message="Members will no longer be able to send messages. Continue?"
        confirmLabel="Continue"
        onConfirm={() => { confirmAdminsOnly.close(); void write('sendMode', 'ADMINS_ONLY') }}
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  intro: { paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.md },
  callout: { paddingHorizontal: space.lg, paddingBottom: space.sm2 },
  row: { paddingHorizontal: space.lg, paddingVertical: space.md, gap: space.sm },
  rowText: { gap: space.xxs },
  dim: { opacity: 0.5 },
  segment: { marginTop: space.xxs },
})
