/* =========================================================
   New followers — a small rail section above the chat inbox.
   Port of web src/components/chat/NewFollowers.jsx; the state
   machine (watermark + done-map) is copied verbatim.

   Data: the notifications feed (type NEW_FOLLOWER, category
   SOCIAL — probed against the live backend; the DTO carries the
   full actor card). "New" is decided by a CLIENT watermark, not
   the notification's isRead flag: reading the notifications
   inbox marks everything read there, and that must not silently
   empty this section before the user has seen it HERE. (Same
   reason this component deliberately ignores the stream's
   `read` events.) The watermark (latest createdAt acknowledged)
   lives in MMKV, scoped per signed-in user.

   Tapping a row opens the get-or-create DM with that actor,
   marks that one notification read, and RETIRES the row —
   messaging someone is the whole point of this section, so a
   follower you have already written to must not be sitting here
   again after a relaunch. Dismissing advances the watermark
   over everything currently shown and bulk-marks those
   notifications read.

   A bonus rail never announces its own problems: empty renders
   null, loading renders null, a failed fetch renders null.
   ========================================================= */
import { api } from '@/api'
import type { NotifRow } from '@/components/notifications/types'
import { useAuth } from '@/context/AuthContext'
import { useNotificationEvents } from '@/context/RealtimeContext'
import { chatError } from '@/lib/chatErrors'
import { storage } from '@/platform/storage'
import { useTheme } from '@/theme/ThemeProvider'
import { rule, space } from '@/theme/tokens'
import { Avatar, Icon, Text, Touchable, toast } from '@/ui'
import { useRouter } from 'expo-router'
import React from 'react'
import { StyleSheet, View } from 'react-native'

/* The api modules are JS — TypeScript infers the option bag from the
   destructuring defaults alone, so the filter keys vanish from the inferred
   signature. This alias restores the contract api/notifications.js documents
   (the same move the notifications screen makes). */
const listNotifications = api.notifications.list as (
  args: { type?: string | string[]; page?: number; size?: number },
) => Promise<{ items: NotifRow[] }>

const CAP = 3
const seenKey = (uid: string | null) => `ika_flwseen_${uid || 'anon'}`
/* Why a second key, and not just a nudge of the watermark: the watermark is a
  single timestamp, so it can only ever acknowledge a PREFIX of the list.
  Advancing it to retire the person you just messaged would take every OLDER
  follower down with them — and you message people out of order. The map is
  therefore keyed by actor id. Its value is only an acknowledgement marker:
  once a conversation starts from this rail, that person stays retired even
  if another follower notification is later delivered. */
const doneKey = (uid: string | null) => `ika_flwdone_${uid || 'anon'}`
/* One entry per person ever messaged from this rail — bounded so a decade of
   followers cannot turn a convenience into a growing MMKV blob. */
const DONE_CAP = 50

const readDone = (uid: string | null): Record<string, string> => {
  try { return JSON.parse(storage.getItem(doneKey(uid)) || '{}') || {} } catch { return {} }
}
const writeDone = (uid: string | null, map: Record<string, string>) => {
  try {
    // String keys keep insertion order, so the oldest entries fall off the front.
    const kept = Object.entries(map).slice(-DONE_CAP)
    storage.setItem(doneKey(uid), JSON.stringify(Object.fromEntries(kept)))
  } catch { /* a full disk must not break the inbox */ }
}

export function NewFollowers() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const { user } = useAuth()
  const uid = user?.id ? String(user.id) : null

  const [rows, setRows] = React.useState<NotifRow[]>([])

  const load = React.useCallback(async () => {
    try {
      // Server-side type filter — NEW_FOLLOWER never aggregates, so 30 rows
      // of the right kind beat 30 mixed rows filtered down to a handful.
      const { items } = await listNotifications({ type: 'NEW_FOLLOWER', page: 0, size: 30 })
      const seen = storage.getItem(seenKey(uid)) || ''
      const done = readDone(uid)
      // One row per follower — the same person re-following must not stack.
      const byActor = new Map<string, NotifRow>()
      for (const n of items) {
        if (n.type !== 'NEW_FOLLOWER' || !n._actor?.id) continue
        if (seen && n.createdAt && n.createdAt <= seen) continue
        const prev = byActor.get(n._actor.id)
        if (!prev || (n.createdAt || '') > (prev.createdAt || '')) byActor.set(n._actor.id, n)
      }
      setRows([...byActor.values()]
        /* Filtered AFTER the collapse, not during it: the map holds only each
           actor's newest follow, so an older notification from the same person
           can never slip in behind the one that was just handled. */
        .filter(n => !done[String(n._actor.id)])
        .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
        .slice(0, CAP))
    } catch {
      /* quiet — the inbox rail must not break on a notifications hiccup */
    }
  }, [uid])

  React.useEffect(() => { void load() }, [load])

  /* The web refreshed on visibilitychange; here the shared notification
     stream is the analogue. A NEW_FOLLOWER frame is a live follow; the
     stream's own `connected` fires on every (re)connect — including the
     redial after the app resumes from background — and is the "anything
     pushed while it was down is gone, re-read via REST" signal. `read` and
     `deleted` are deliberately NOT handled: the watermark, not isRead, owns
     this section's notion of "new". */
  useNotificationEvents(e => {
    if (e.type === 'connected') { void load(); return }
    if (e.type === 'notification' && e.notification?.type === 'NEW_FOLLOWER') void load()
  })

  const dismiss = React.useCallback(() => {
    const newest = rows.reduce((m, n) => ((n.createdAt || '') > m ? n.createdAt : m), '')
    if (newest) storage.setItem(seenKey(uid), newest)
    api.notifications.markReadBulk(rows.map(n => n.id)).catch(() => {})
    setRows([])
  }, [rows, uid])

  const open = React.useCallback(async (n: NotifRow) => {
    api.notifications.markRead(n.id).catch(() => {})
    /* Retire the row: pressing it is the acknowledgement this section exists
       to collect. Written BEFORE the reload below, which reads it. */
    const actorId = String(n._actor.id)
    writeDone(uid, { ...readDone(uid), [actorId]: '1' })
    setRows(prev => prev.filter(r => String(r._actor.id) !== actorId))
    /* The list is capped at three, so retiring one may reveal a fourth
       follower who was waiting behind it. Quiet and best-effort — the row is
       already gone locally whether or not this comes back. */
    void load()
    try {
      /* The same get-or-create the New-chat picker uses: keyed on the
         unordered pair, so a thread that already exists simply opens. Push,
         not replace — this rail lives on the inbox, and Back belongs there. */
      const convo: any = await api.chat.conversations.createDirect(actorId)
      if (convo?.id) router.push(`/chat/${convo.id}`)
    } catch (e) {
      /* The one loud moment this component is allowed: the user asked for a
         chat and did not get one. chatError falls through to errorText — the
         server's own sentence, never re-worded. */
      toast.error(chatError(e, 'Could not start this chat'))
    }
  }, [uid, load, router])

  if (!rows.length) return null
  return (
    <View
      style={[styles.section, { borderBottomColor: c.border }]}
      accessibilityLabel="New followers"
    >
      <View style={styles.head}>
        <Icon name="personAdd" size={13} color={c.textMuted} />
        <Text variant="micro" tone="muted" align="ui">New followers</Text>
        <Text variant="micro" tone="faint" align="ui">{rows.length}</Text>
        <View style={styles.spacer} />
        <Touchable onPress={dismiss} feedback="dim" accessibilityLabel="Dismiss new followers">
          <Icon name="close" size={16} color={c.textMuted} />
        </Touchable>
      </View>
      {rows.map(n => (
        <Touchable
          key={n.id}
          onPress={() => { void open(n) }}
          feedback="dim"
          noAutoHitSlop
          accessibilityLabel={`Message ${n._actor.full}`}
          style={styles.row}
        >
          <Avatar uri={n._actor.profileImage} name={n._actor.full} seed={n._actor.id} size="md" />
          <View style={styles.body}>
            <Text variant="bodyStrong" numberOfLines={1}>{n._actor.full}</Text>
            <Text variant="footnote" tone="muted" numberOfLines={1}>
              @{n._actor.handle} · followed you {n.time}
            </Text>
          </View>
          <View style={styles.cta}>
            <Icon name="chat" size={13} color={c.accentText} />
            <Text variant="footnote" tone="accent" align="ui">Message</Text>
          </View>
        </Touchable>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  /* Rides the white ground; one stone hairline separates it from the inbox.
     No shadow, no fill — a rail is not a card (DESIGN.md: tinted fills mark
     state, never surface; never a shadow on list rows). */
  section: { paddingBottom: space.xs2, borderBottomWidth: rule.hairline },
  head: {
    flexDirection: 'row', alignItems: 'center', gap: space.xs2,
    paddingHorizontal: space.lg, paddingTop: space.sm2, paddingBottom: space.xxs,
  },
  spacer: { flex: 1 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    minHeight: 56, paddingHorizontal: space.lg, paddingVertical: space.xs2,
  },
  body: { flex: 1 },
  cta: { flexDirection: 'row', alignItems: 'center', gap: space.xs2 },
})
