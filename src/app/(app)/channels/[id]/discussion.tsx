/* =========================================================
   The discussion group.

   Comments on a channel post are messages in a linked GROUP, so
   "turning comments on" is really "link a group". A group can
   serve exactly one channel, which is why the picker marks the
   already-linked ones instead of letting the server refuse.

   Slow mode goes through `conversations.update`, whose
   `settings` is the same whole-object replacement trap as the
   channel's: the full blob is resent with one key changed.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { api, errorText } from '@/api'
import { useAsync } from '@/hooks/useAsync'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  Avatar, Button, Callout, ConfirmSheet, EmptyState, ErrorState, Field, GroupFooter,
  GroupLabel, Header, Icon, ListRow, RowGroup, Screen, ScreenScroll, SegmentedControl,
  Sheet, Skeleton, Text, toast, useSheetState,
} from '@/ui'
import { useChannelRights } from '@/components/channels/hooks'
import { chRoute } from '@/components/channels/routes'
import { args } from '@/components/channels/apiArgs'

const SLOW_MODES = [
  { value: '0', label: 'Off', seconds: 0 },
  { value: '10', label: '10s', seconds: 10 },
  { value: '30', label: '30s', seconds: 30 },
  { value: '60', label: '1m', seconds: 60 },
  { value: '300', label: '5m', seconds: 300 },
  { value: '900', label: '15m', seconds: 900 },
  { value: '3600', label: '1h', seconds: 3600 },
]

export default function DiscussionScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()

  const rights = useChannelRights(id)
  const channel = rights.channel
  const groupId = channel?.linkedGroupId || null

  const group = useAsync<any>(
    () => api.chat.conversations.get(groupId as string),
    { enabled: !!groupId, deps: [groupId] },
  )

  const picker = useSheetState()
  const createSheet = useSheetState()
  const confirmUnlink = useSheetState()
  const [busy, setBusy] = React.useState(false)
  const [pickerError, setPickerError] = React.useState<{ groupId: string; message: string } | null>(null)
  const [blockedGroups, setBlockedGroups] = React.useState<Set<string>>(new Set())

  const canManage = rights.can('canChangeInfo')

  const link = async (targetId: string) => {
    setBusy(true)
    setPickerError(null)
    try {
      await api.channels.discussion.link(id, targetId)
      rights.setChannel((prev: any) => (prev ? { ...prev, linkedGroupId: targetId } : prev))
      picker.close()
      toast.ok('Comments are on')
      rights.reload()
    } catch (e: any) {
      /* "already another channel's discussion group" is per-row information —
         it belongs under the offending row, not in a toast that loses which
         row it was about. */
      setPickerError({ groupId: targetId, message: errorText(e) })
      if (e?.status === 400) setBlockedGroups(s => new Set(s).add(targetId))
      if (e?.status === 403) toast.error(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  const unlink = async () => {
    setBusy(true)
    try {
      await api.channels.discussion.unlink(id)
      rights.setChannel((prev: any) => (prev ? { ...prev, linkedGroupId: null } : prev))
      toast.ok('Comments are off')
      rights.reload()
    } catch (e: any) { toast.error(errorText(e)) }
    finally { setBusy(false) }
  }

  const setSlowMode = async (seconds: number) => {
    if (!groupId) return
    const before = group.data
    group.setData((prev: any) => (prev ? { ...prev, slowModeSeconds: seconds } : prev))
    try {
      /* The whole settings blob, not just the one key — a partial object
         resets every other group setting to null. */
      const fresh = await api.chat.conversations.update(groupId, {
        settings: { ...(before?.settings || {}), slowModeSeconds: seconds },
      })
      group.setData(fresh)
      toast.ok(seconds ? 'Slow mode updated' : 'Slow mode off')
    } catch (e: any) {
      group.setData(before ?? null)
      toast.error(errorText(e))
    }
  }

  if (rights.loading && !channel) {
    return (
      <Screen background="sunken">
        <Header back title="Discussion group" />
        <View style={{ padding: space.lg, gap: space.md }}>
          <Skeleton height={130} radius={14} />
          <Skeleton height={90} radius={14} />
        </View>
      </Screen>
    )
  }

  if (rights.error) {
    return (
      <Screen background="sunken">
        <Header back title="Discussion group" />
        <ErrorState error={rights.error} onRetry={rights.reload} />
      </Screen>
    )
  }

  return (
    <Screen background="sunken">
      <Header back title="Discussion group" subtitle={channel?.title} />
      <ScreenScroll refreshing={group.refreshing} onRefresh={() => { void rights.refresh(); void group.refresh() }}>
        <View style={styles.hero}>
          <View style={[styles.heroGlyph, { backgroundColor: c.accentSoft }]}>
            <Icon name="chat" size={40} color={c.accent} />
          </View>
          <Text variant="title3" align="center" style={{ marginTop: space.md }}>Let subscribers comment</Text>
          <Text variant="callout" tone="muted" align="center" style={{ marginTop: space.xs, maxWidth: 320 }}>
            Link a group to this channel. Replies to a post become its comments, and commenters join
            the group automatically.
          </Text>
        </View>

        {!canManage ? (
          <View style={{ paddingHorizontal: t.layout.screenPadding, paddingBottom: space.md }}>
            <Callout tone="neutral" icon="lock">
              Only admins who can change this channel’s info may link a discussion group.
            </Callout>
          </View>
        ) : null}

        {groupId ? (
          <>
            <RowGroup>
              <ListRow
                title={group.data?.displayTitle || 'Discussion group'}
                subtitle={group.data ? `${group.data.memberCount} members` : undefined}
                leading={<Avatar uri={group.data?.avatarUrl} name={group.data?.displayTitle} seed={groupId} size={48} square />}
                accessory={{ kind: 'chevron' }}
                onPress={() => router.push(chRoute.chat(groupId))}
              />
            </RowGroup>

            {canManage ? (
              <>
                <GroupLabel>Slow mode</GroupLabel>
                <View style={{ paddingHorizontal: t.layout.screenPadding }}>
                  <SegmentedControl
                    scrollable
                    options={SLOW_MODES.map(m => ({ value: m.value, label: m.label }))}
                    value={String(group.data?.slowModeSeconds ?? 0)}
                    onChange={v => void setSlowMode(Number(v))}
                  />
                </View>
                <GroupFooter>Limits how often a non-admin can comment. Admins are exempt.</GroupFooter>

                <View style={{ height: 16 }} />
                <RowGroup>
                  <ListRow title="Unlink discussion group" icon="close" destructive onPress={() => confirmUnlink.open()} />
                </RowGroup>
                <GroupFooter>
                  Comments will be turned off. Existing comments stay in the group.
                </GroupFooter>
              </>
            ) : null}
          </>
        ) : canManage ? (
          <View style={{ paddingHorizontal: t.layout.screenPadding, gap: space.sm2 }}>
            <Button label="Choose a group" size="lg" block onPress={() => picker.open()} />
            <Button label="Create a new group" variant="ghost" size="lg" block onPress={() => createSheet.open()} />
          </View>
        ) : (
          <EmptyState compact icon="chat" title="Comments are off in this channel." />
        )}
      </ScreenScroll>

      <GroupPicker
        visible={picker.visible}
        onClose={picker.close}
        busy={busy}
        blocked={blockedGroups}
        error={pickerError}
        onPick={link}
        onCreate={() => { picker.close(); createSheet.open() }}
      />

      <CreateGroupSheet
        visible={createSheet.visible}
        onClose={createSheet.close}
        onCreated={async gid => { createSheet.close(); await link(gid) }}
      />

      <ConfirmSheet
        visible={confirmUnlink.visible}
        onClose={confirmUnlink.close}
        title={`Unlink ${group.data?.displayTitle || 'this group'}?`}
        message="Comments will be turned off on every post. Existing comments stay in the group."
        confirmLabel="Unlink"
        destructive
        onConfirm={() => { confirmUnlink.close(); void unlink() }}
      />
    </Screen>
  )
}

/* ---------------------------------------------------------
   Picker
   --------------------------------------------------------- */

function GroupPicker({
  visible, onClose, busy, blocked, error, onPick, onCreate,
}: {
  visible: boolean
  onClose: () => void
  busy: boolean
  blocked: Set<string>
  error: { groupId: string; message: string } | null
  onPick: (groupId: string) => void
  onCreate: () => void
}) {
  const t = useTheme()
  const list = useAsync<any>(
    () => api.chat.conversations.list({ page: 0, size: 50 }),
    { enabled: visible, deps: [visible] },
  )

  const groups = React.useMemo(
    () => (list.data?.items || []).filter((x: any) => x.type === 'GROUP' && (x.myRole === 'OWNER' || x.myRole === 'ADMIN')),
    [list.data],
  )

  return (
    <Sheet visible={visible} onClose={onClose} title="Choose a group" subtitle="Groups you administer" maxHeightRatio={0.8}>
      {list.loading ? (
        <View style={{ padding: space.lg, gap: space.sm2 }}>
          {[0, 1, 2].map(i => <Skeleton key={i} height={52} radius={12} />)}
        </View>
      ) : !groups.length ? (
        <EmptyState
          compact
          icon="people"
          title="You don’t administer any groups yet"
          actionLabel="Create a new group"
          onAction={onCreate}
        />
      ) : (
        <View style={{ paddingBottom: space.md }}>
          {groups.map((g: any) => {
            const off = blocked.has(g.id)
            return (
              <View key={g.id}>
                <ListRow
                  title={g.displayTitle}
                  subtitle={`${g.memberCount} members`}
                  leading={<Avatar uri={g.avatarUrl} name={g.displayTitle} seed={g.id} size={36} square />}
                  disabled={busy || off}
                  accessory={off ? { kind: 'value', text: 'Linked elsewhere', chevron: false } : { kind: 'chevron' }}
                  onPress={() => onPick(g.id)}
                />
                {error?.groupId === g.id ? (
                  <Text variant="footnote" tone="danger" align="ui" style={{ paddingHorizontal: t.layout.screenPadding, paddingBottom: space.sm }}>
                    {error!.message}
                  </Text>
                ) : null}
              </View>
            )
          })}
        </View>
      )}
    </Sheet>
  )
}

function CreateGroupSheet({
  visible, onClose, onCreated,
}: { visible: boolean; onClose: () => void; onCreated: (groupId: string) => void }) {
  const t = useTheme()
  const [title, setTitle] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => { if (!visible) { setTitle(''); setBusy(false) } }, [visible])

  const create = async () => {
    if (!title.trim()) return
    setBusy(true)
    try {
      const group = await api.chat.conversations.createGroup(args({ title: title.trim(), memberIds: [] }))
      if (group?.id) onCreated(group.id)
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
      title="Create a discussion group"
      maxHeightRatio={0.5}
      footer={<Button label="Create and link" onPress={create} disabled={!title.trim()} loading={busy} size="lg" block />}
    >
      <View style={{ padding: t.layout.screenPadding, gap: space.sm2 }}>
        <Field label="Group name" value={title} onChangeText={setTitle} placeholder="Channel discussion" autoFocus maxLength={120} />
        <Text variant="footnote" tone="muted" align="ui">
          Subscribers who comment join this group automatically.
        </Text>
      </View>
    </Sheet>
  )
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', paddingHorizontal: space.xxl, paddingTop: space.lg2, paddingBottom: 22 },
  heroGlyph: { width: 96, height: 96, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
})
