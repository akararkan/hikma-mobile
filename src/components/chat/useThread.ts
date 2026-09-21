/* =========================================================
   useThread — the per-conversation message engine.

   The thread is the one screen where getting the data model
   wrong is invisible until it is catastrophic, so the rules
   are stated here rather than spread across the render:

   IDS ARE STRINGS. Message ids are 64-bit Snowflakes. Sorting,
   dedupe, high-water marks and gap sync all go through
   cmpId / maxId / gtId — never `-`, `>=` or Math.max, all of
   which silently round an 18-digit id into a different one.

   TWO PAGING MODELS. `messages.page` is a Cassandra CURSOR
   page, newest → older, so each page is REVERSED before it is
   merged into the ascending store. `messages.sync` returns a
   bare ASCENDING array of everything strictly newer than the
   high-water id — that is the gap fill, not a page.

   EVERY `connected` IS A RECONCILE. The socket fires
   `connected` on the first handshake AND on every reconnect
   (server timeouts, backgrounding, network flaps). Treating it
   as "first open" loses every message that arrived while the
   socket was down; treating it as "reconcile" costs one sync
   request and is always right.

   DELTAS, NEVER COUNTERS. No SSE frame carries a count.
   Reactions apply ±1 locally, and because a chat reaction is
   ONE per user, an `added` for someone who already reacted has
   to MOVE their count rather than add a second.

   OPTIMISTIC SENDS carry a `clientNonce`, which is both the
   server's idempotency key and the only way the sender can
   recognise its own echo. Reconcile by nonce first, id second.

   THE CLEAR FLOOR IS A FILTER, NOT A FETCH. "Delete chat" on a
   DM (or a non-owner group) is the server's per-user clear:
   `clearedBeforeMessageId` is raised and EVERY later read is
   floored at it. The client mirrors that id in
   ChatContext.clearedStore, and every row entering this store
   passes through it — a page, a gap sync, an SSE frame, a
   hydrate. Without the filter the loaded window survives the
   delete and the next `message.new` merges straight into
   yesterday's history.
   ========================================================= */
import React from 'react'
import { AppState, type AppStateStatus } from 'react-native'
import { api } from '@/api'
import { cmpId, gtId, isTmpId, maxId, newTmpId } from '@/api'
import { useChatActions, useClearedFloor } from '@/context/ChatContext'
import { useReconcile } from '@/context/RealtimeContext'
import { uploadChunked, refFrom, CHUNK_THRESHOLD } from '@/api/uploads.js'
import { dayKey } from './format'

const PAGE = 40
const READ_DEBOUNCE_MS = 400
/* Two independent resume triggers fire within a frame of each other; anything
   longer than that window is a genuinely new reason to re-read. */
const SYNC_FLOOR_MS = 1000

/** Stamp the derived time fields ONCE, when a row enters the store. The row
 *  assembly upstairs runs on every realtime frame; without the stamps it
 *  re-parsed every loaded message's ISO date (4× per message for the run
 *  grouping alone) each time. `createdAt` never changes under patch/merge —
 *  both spread the stored row first and server rows carry no `_ts`/`_day`
 *  keys — so a stamp can never go stale. */
function stampMsg(m: any) {
  if (m._ts != null) return m
  return {
    ...m,
    _ts: m.createdAt ? Date.parse(m.createdAt) : 0,
    _day: dayKey(m.createdAt),
  }
}

export interface SendPayload {
  body?: string
  replyToId?: string | null
  type?: string
  poll?: any
  location?: any
  contact?: any
}

export interface SendFilesPayload {
  body?: string
  replyToId?: string | null
  files: any[]
  durationMs?: number | null
  waveform?: string | null
  /** What the optimistic bubble should look like before the server answers. */
  optimisticMedia?: any[]
  type?: string
  /** Live upload fraction 0..1 (real bytes on the multipart path, chunk
   *  granularity on the big-file path). */
  onProgress?: (fraction: number) => void
  /** Abort mid-upload; the optimistic bubble is dropped, not failed. */
  signal?: AbortSignal
}

export function useThread(convId: string, myId: string | null) {
  const { subscribe, getConvo, markRead, noteOutgoing } = useChatActions()

  const store = React.useRef(new Map<string, any>())
  const [messages, setMessages] = React.useState<any[]>([])
  const [loading, setLoading] = React.useState(true)
  const [loadingOlder, setLoadingOlder] = React.useState(false)
  const [error, setError] = React.useState<any>(null)
  const [hasMore, setHasMore] = React.useState(false)
  const [pinnedList, setPinnedList] = React.useState<any[]>([])
  /* The thread stopped existing under the reader: the owner deleted the group
     or the channel while it was open. Distinct from `error` — nothing failed
     and there is nothing to retry. */
  const [gone, setGone] = React.useState(false)

  /* This device's mirror of the server's `clearedBeforeMessageId`. The hook
     re-renders the screen when it moves; the ref is what the merge path and
     the event handlers read, so neither is rebuilt on every floor read. */
  const clearedFloor = useClearedFloor(convId)
  const floorRef = React.useRef<string | null>(clearedFloor)
  floorRef.current = clearedFloor
  /** Is this row still visible to the account? Tmp ids sort after every real
   *  id (ids.js), so an optimistic bubble is never floored out. */
  const visible = React.useCallback(
    (id: any) => !floorRef.current || gtId(String(id), floorRef.current),
    [],
  )

  const cursor = React.useRef<string | null>(null)
  const highWater = React.useRef<string | null>(null)
  /* The floor this store has already been evicted against, so the eviction
     runs once per floor rather than on every render that reads it. */
  const prunedFloor = React.useRef<string | null>(null)
  const nonces = React.useRef(new Map<string, string>())   // clientNonce → tmp id
  const readSent = React.useRef<string | null>(null)
  const readTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const deliveredAcked = React.useRef(new Set<string>())
  const alive = React.useRef(true)
  /* The gap-sync single-flight — see sync() below. */
  const syncInflight = React.useRef<Promise<void> | null>(null)
  const syncedAt = React.useRef(0)

  React.useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      if (readTimer.current) clearTimeout(readTimer.current)
    }
  }, [])

  /* ---------------- the store ---------------- */

  const commit = React.useCallback(() => {
    if (!alive.current) return
    const rows = [...store.current.values()].sort((a, b) => cmpId(a.id, b.id))
    setMessages(rows)
    for (let i = rows.length - 1; i >= 0; i--) {
      if (!isTmpId(rows[i].id)) { highWater.current = maxId(highWater.current, rows[i].id); break }
    }
  }, [])

  const merge = React.useCallback((rows: any[]) => {
    /* Append fast-path: the common live case is one new message past the
       high-water mark, and re-sorting the whole loaded window for it cost
       O(n log n) per arriving frame in a deep-scrolled thread. The floor is
       the max REAL id — tmp ids sort after every real one (ids.js), so during
       an active send the array's tail is tmp bubbles and fresh rows are
       spliced in front of them. Any other shape falls through to commit(). */
    const fresh: any[] = []
    let appendOnly = true
    for (const m of rows) {
      if (!m?.id) continue
      /* The one gate every row passes through, whichever read produced it. */
      if (!visible(m.id)) continue
      const key = String(m.id)
      const prev = store.current.get(key)
      /* A page row does not carry `reactedByMe`, so a merge must never
         downgrade a row a detail read already resolved. */
      const next = prev
        ? { ...prev, ...m, _reactionsAuthoritative: prev._reactionsAuthoritative || m._reactionsAuthoritative }
        : stampMsg(m)
      store.current.set(key, next)
      if (!prev && !isTmpId(key) && gtId(key, highWater.current)) fresh.push(next)
      else appendOnly = false
    }
    if (!appendOnly || fresh.length === 0) { commit(); return }
    if (!alive.current) return
    fresh.sort((a, b) => cmpId(a.id, b.id))
    highWater.current = maxId(highWater.current, fresh[fresh.length - 1].id)
    setMessages(prevRows => {
      /* The store is the truth. If the rendered array diverged in a way this
         updater cannot see (a retired optimistic bubble deleted straight off
         the store), rebuild instead of splicing. */
      if (prevRows.length + fresh.length !== store.current.size) {
        return [...store.current.values()].sort((a, b) => cmpId(a.id, b.id))
      }
      let cut = prevRows.length
      while (cut > 0 && isTmpId(prevRows[cut - 1].id)) cut--
      return [...prevRows.slice(0, cut), ...fresh, ...prevRows.slice(cut)]
    })
  }, [commit, visible])

  const patch = React.useCallback((id: string, fn: (m: any) => any) => {
    const key = String(id)
    const cur = store.current.get(key)
    if (!cur) return
    const next = fn(cur)
    store.current.set(key, next)
    if (!alive.current) return
    /* An id never changes under patch, so order is preserved — replace the
       row in the already-sorted array rather than re-sorting the window
       (reaction bursts made that a full-window sort per frame). */
    setMessages(prevRows => {
      const i = prevRows.findIndex(m => String(m.id) === key)
      if (i < 0) return prevRows
      const out = prevRows.slice()
      out[i] = next
      return out
    })
  }, [])

  /* ---------------- first page + pins ---------------- */

  const loadFirst = React.useCallback(async () => {
    if (!convId) return
    setLoading(true)
    setError(null)
    try {
      const res: any = await api.chat.messages.page(convId, { limit: PAGE } as any)
      if (!alive.current) return
      store.current.clear()
      cursor.current = res.nextCursor
      setHasMore(!!res.hasMore)
      /* The page is newest-first; the store is ascending. */
      merge([...res.items].reverse())
    } catch (e) {
      if (alive.current) setError(e)
    } finally {
      if (alive.current) setLoading(false)
    }
  }, [convId, merge])

  const loadPinned = React.useCallback(async () => {
    if (!convId) return
    try {
      const rows: any = await api.chat.messages.pinned(convId)
      if (alive.current) setPinnedList(rows || [])
    } catch { /* the pin bar is decoration; its failure is not the thread's */ }
  }, [convId])

  React.useEffect(() => {
    store.current.clear()
    nonces.current.clear()
    deliveredAcked.current.clear()
    highWater.current = null
    readSent.current = null
    syncInflight.current = null
    syncedAt.current = 0
    prunedFloor.current = null
    setMessages([])
    setGone(false)
    void loadFirst()
    void loadPinned()
  }, [convId, loadFirst, loadPinned])

  /* The floor MOVED — the user just deleted this chat, on this device or on
     another one of theirs. Everything at or below it is now unfetchable, so
     drop it from the window the reader is looking at rather than leaving a
     thread full of messages the next reload cannot produce. `merge` keeps new
     ones out; this is the one-off eviction of what was already in.

     `highWater` is raised to the floor rather than reset: a gap sync from a
     cleared thread should ask for "everything after the clear point", which is
     exactly the resurfaced-conversation case. */
  React.useEffect(() => {
    if (!clearedFloor) {
      /* The floor came back DOWN — the DELETE failed and ChatContext rolled it
         back. The eviction below is destructive, so the window it emptied
         cannot be un-emptied from memory; re-read the page instead, which is
         also the only way to learn that the messages are still there. */
      if (prunedFloor.current) { prunedFloor.current = null; void loadFirst() }
      return
    }
    if (prunedFloor.current === clearedFloor) return
    prunedFloor.current = clearedFloor
    let dropped = false
    for (const key of [...store.current.keys()]) {
      if (isTmpId(key) || gtId(key, clearedFloor)) continue
      store.current.delete(key)
      dropped = true
    }
    highWater.current = maxId(highWater.current, clearedFloor)
    setPinnedList(prev => {
      const next = prev.filter(p => gtId(String(p.id), clearedFloor))
      return next.length === prev.length ? prev : next
    })
    if (!dropped) return
    /* Nothing older survives a clear, so the top spinner must stop asking. */
    if (!store.current.size) { cursor.current = null; setHasMore(false) }
    commit()
  }, [clearedFloor, commit, loadFirst])

  const loadOlder = React.useCallback(async () => {
    if (!hasMore || loadingOlder || !cursor.current) return
    setLoadingOlder(true)
    try {
      const res: any = await api.chat.messages.page(convId, { cursor: cursor.current, limit: PAGE } as any)
      if (!alive.current) return
      cursor.current = res.nextCursor
      setHasMore(!!res.hasMore)
      merge([...res.items].reverse())
    } catch { /* keep the loaded window; the top spinner simply stops */ }
    finally { if (alive.current) setLoadingOlder(false) }
  }, [convId, hasMore, loadingOlder, merge])

  /** Page backwards until `targetId` is in memory — jumping to a search hit or
   *  a reply that sits below the loaded window. Bounded so a jump into a
   *  hundred-thousand-message channel cannot run forever. */
  const pageToward = React.useCallback(async (targetId: string, maxPages = 8) => {
    for (let i = 0; i < maxPages; i++) {
      if (store.current.has(String(targetId))) return true
      if (!cursor.current) break
      try {
        const res: any = await api.chat.messages.page(convId, { cursor: cursor.current, limit: PAGE } as any)
        cursor.current = res.nextCursor
        setHasMore(!!res.hasMore)
        merge([...res.items].reverse())
        if (!res.hasMore) break
      } catch { break }
    }
    return store.current.has(String(targetId))
  }, [convId, merge])

  /* ---------------- gap sync ---------------- */

  /* SELF-DEDUPING. Two triggers land on the same foreground event: useReconcile
     below (the chat stream re-keys on resume, which bumps `epoch`) and this
     hook's own AppState listener. Ungated that is two identical
     /messages/sync calls carrying the same cursor, merging the same rows twice
     — double the visible catch-up latency on the screen the user opens most.
     The in-flight promise is handed to the second caller and a one-second
     floor swallows the trailing edge, so neither trigger has to know the other
     exists. Both refs are cleared when the conversation changes: the promise
     belongs to the OLD thread and must never answer for the new one. */
  const sync = React.useCallback((): Promise<void> => {
    if (!convId) return Promise.resolve()
    if (syncInflight.current) return syncInflight.current
    if (Date.now() - syncedAt.current < SYNC_FLOOR_MS) return Promise.resolve()
    /* `after` is REQUIRED on /messages/sync (messages.md §1.2) — with no
       high-water id yet (empty thread, first page still in flight) a sync
       would be a guaranteed 400 MISSING_PARAMETER; the first page IS the
       gap fill in that state. */
    if (!highWater.current) { syncedAt.current = Date.now(); void loadFirst(); return Promise.resolve() }
    const after = highWater.current
    const run = (async () => {
      try {
        const rows: any = await api.chat.messages.sync(convId, after, 100)
        if (alive.current && rows?.length) merge(rows)
      } catch { /* the next reconnect tries again */ }
      finally { syncedAt.current = Date.now(); syncInflight.current = null }
    })()
    syncInflight.current = run
    return run
  }, [convId, merge, loadFirst])

  /* Every (re)connect. Not "on mount" — the first page already covered that. */
  useReconcile(() => { void sync() })

  React.useEffect(() => {
    let last: AppStateStatus = AppState.currentState
    const sub = AppState.addEventListener('change', next => {
      /* iOS also emits 'inactive' for the app switcher, which is not a resume. */
      if (next === 'active' && last !== 'active') void sync()
      last = next
    })
    return () => sub.remove()
  }, [sync])

  /* ---------------- live frames ---------------- */

  React.useEffect(() => subscribe(evt => {
    if (evt.conversationId && String(evt.conversationId) !== String(convId)) return

    switch (evt.type) {
      case 'message.new': {
        const m = evt.message
        if (!m?.id) return
        /* My own echo: retire the optimistic bubble before merging, or the
           sender sees their message twice until the POST resolves.

           NOTE: `msgFrom` does not surface `clientNonce`, so the nonce path
           only fires on a deploy that echoes it. The fallback matches the
           pending bubble on sender + body + reply target, which is exact for
           every case a user can produce inside one round trip. */
        const tmp = m.clientNonce ? nonces.current.get(String(m.clientNonce)) : undefined
        if (tmp) {
          store.current.delete(tmp)
          nonces.current.delete(String(m.clientNonce))
        } else if (String(m.senderId) === String(myId)) {
          for (const [key, row] of store.current) {
            if (!isTmpId(key) || row.failed) continue
            if (row.body === m.body && String(row.replyToId ?? '') === String(m.replyToId ?? '')) {
              store.current.delete(key)
              if (row.clientNonce) nonces.current.delete(String(row.clientNonce))
              break
            }
          }
        }
        merge([m])
        /* The open thread acks its own arrivals; ChatContext handles the
           closed-conversation case, so acking here too would duplicate it. */
        if (String(m.senderId) !== String(myId) && !deliveredAcked.current.has(String(m.id))) {
          deliveredAcked.current.add(String(m.id))
          api.chat.messages.delivered(m.id).catch(() => {})
        }
        break
      }

      case 'message.edited':
        patch(evt.messageId!, m => ({ ...m, body: evt.body || '', editedAt: evt.editedAt || new Date().toISOString() }))
        break

      case 'message.deleted':
        /* This frame is the ONLY place the deleter is knowable — the REST row
           comes back without one — so stamp it here or the tombstone can never
           say more than "this message was deleted". */
        patch(evt.messageId!, m => ({
          ...m, deleted: true, deletedBy: evt.userId || null,
          body: '', media: [], reactions: [], starred: false, poll: null,
        }))
        setPinnedList(prev => prev.filter(p => String(p.id) !== String(evt.messageId)))
        break

      case 'message.reaction': {
        const emoji = evt.emoji
        const byMe = String(evt.userId) === String(myId)
        patch(evt.messageId!, m => {
          const buckets: any[] = (m.reactions || []).map((r: any) => ({ ...r }))
          const find = (e: string) => buckets.find(b => b.emoji === e)

          if (evt.added) {
            /* ONE reaction per user: an add by someone who already had a
               different emoji is a MOVE. Only my own previous emoji is
               knowable locally, so that is the one that gets decremented. */
            if (byMe) {
              const old = buckets.find(b => b.reactedByMe && b.emoji !== emoji)
              if (old) old.count = Math.max(0, old.count - 1)
              if (old) old.reactedByMe = false
            }
            const b = find(emoji)
            if (b) { b.count += 1; if (byMe) b.reactedByMe = true }
            else buckets.push({ emoji, count: 1, reactedByMe: byMe })
          } else {
            const b = find(emoji)
            if (b) { b.count = Math.max(0, b.count - 1); if (byMe) b.reactedByMe = false }
          }
          return { ...m, reactions: buckets.filter(b => b.count > 0) }
        })
        break
      }

      case 'poll.updated':
        /* The aggregate is viewer-NEUTRAL. Take the counts, keep myVotes — a
           wholesale merge wipes the viewer's own selection. */
        patch(evt.messageId!, m => {
          if (!m.poll || !evt.poll) return m
          const mine = m.poll.myVotes || []
          return {
            ...m,
            poll: {
              ...evt.poll,
              myVotes: mine,
              voted: mine.length > 0,
              revealed: !!evt.poll.closed || mine.length > 0,
              options: evt.poll.options.map((o: any) => ({ ...o, mine: mine.includes(o.index) })),
            },
          }
        })
        break

      case 'conversation.updated':
        if (evt.memberChange === 'PINNED' || evt.memberChange === 'UNPINNED') void loadPinned()
        /* The owner deleted the group (or the channel) for everyone while it
           was open — conversations.md §DELETE. The thread is soft-deleted
           server-side, so every send and every read from here is a 404. Say so
           now rather than letting the reader type into a dead composer.
           ChatContext drops the inbox row off the same frame. */
        else if (evt.memberChange === 'DELETED') setGone(true)
        break

      default:
        break
    }
  }), [subscribe, convId, myId, merge, patch, loadPinned])

  /* ---------------- the read marker ---------------- */

  const markReadUpTo = React.useCallback((newestId: string | null | undefined) => {
    if (!newestId || isTmpId(newestId)) return
    /* You cannot read what you cannot see — a backgrounded thread must not
       clear an unread count the user has not looked at. */
    if (AppState.currentState !== 'active') return
    const convo = getConvo(convId)
    const floor = maxId(readSent.current, convo?.lastReadMessageId)
    if (!gtId(newestId, floor)) return

    readSent.current = newestId
    if (readTimer.current) clearTimeout(readTimer.current)
    readTimer.current = setTimeout(() => { void markRead(convId, newestId) }, READ_DEBOUNCE_MS)
  }, [convId, getConvo, markRead])

  /* ---------------- writes ---------------- */

  const optimistic = React.useCallback((patchFields: any) => {
    const id = newTmpId()
    const row = stampMsg({
      id,
      conversationId: convId,
      senderId: myId,
      type: 'TEXT',
      body: '',
      media: [],
      reactions: [],
      createdAt: new Date().toISOString(),
      isSystem: false,
      deleted: false,
      ...patchFields,
    })
    store.current.set(id, row)
    if (row.clientNonce) nonces.current.set(String(row.clientNonce), id)
    commit()
    return id
  }, [convId, myId, commit])

  const settle = React.useCallback((tmpId: string, real: any) => {
    store.current.delete(tmpId)
    if (real?.id) store.current.set(String(real.id), stampMsg(real))
    commit()
  }, [commit])

  const fail = React.useCallback((tmpId: string, e: any) => {
    patch(tmpId, m => ({ ...m, failed: true, _error: e }))
  }, [patch])

  const send = React.useCallback(async (payload: SendPayload) => {
    const clientNonce = api.chat.newNonce()
    const tmpId = optimistic({
      clientNonce,
      type: payload.type || 'TEXT',
      body: payload.body || '',
      replyToId: payload.replyToId || null,
      replyTo: payload.replyToId ? snapshotReply(store.current, payload.replyToId) : null,
      poll: payload.poll ?? null,
      location: payload.location ?? null,
      contact: payload.contact ?? null,
    })
    try {
      const real: any = await api.chat.messages.send(convId, {
        clientNonce,
        type: payload.type || 'TEXT',
        body: payload.body,
        replyToId: payload.replyToId ?? undefined,
        poll: payload.poll,
        location: payload.location,
        contact: payload.contact,
      } as any)
      nonces.current.delete(clientNonce)
      settle(tmpId, real)
      /* The rail row, immediately — the SSE echo repeats this patch when the
         socket is up, and carries it alone when it is not. */
      noteOutgoing(convId, real)
      return real
    } catch (e) {
      nonces.current.delete(clientNonce)
      fail(tmpId, e)
      throw e
    }
  }, [convId, optimistic, settle, fail, noteOutgoing])

  const sendFiles = React.useCallback(async (payload: SendFilesPayload) => {
    const clientNonce = api.chat.newNonce()
    const tmpId = optimistic({
      clientNonce,
      type: payload.type || 'IMAGE',
      body: payload.body || '',
      replyToId: payload.replyToId || null,
      replyTo: payload.replyToId ? snapshotReply(store.current, payload.replyToId) : null,
      media: payload.optimisticMedia || [],
      /* Kept on the bubble so a failed upload can be retried without asking the
         user to pick the same files again. */
      _files: payload.files,
      _durationMs: payload.durationMs ?? null,
      _waveform: payload.waveform ?? null,
    })
    try {
      let real: any
      const sizes = payload.files.map(f => Number(f?.fileSize ?? f?.size ?? 0))
      if (sizes.some(n => n >= CHUNK_THRESHOLD)) {
        /* Big-file path: every file rides a resumable chunked session (a
           dropped connection resumes instead of restarting), then ONE JSON
           send attaches all the resulting media refs — small files in the
           same batch take the session path too so the batch stays one
           message, matching the multipart behavior. */
        const totalBytes = sizes.reduce((s, n) => s + n, 0) || 1
        let doneBytes = 0
        const uploaded: { r: any; f: any }[] = []   // raw IngestResults for rollback
        try {
          for (let i = 0; i < payload.files.length; i++) {
            const f = payload.files[i]
            const r = await uploadChunked(f, {
              surface: 'CHAT_MEDIA',
              signal: payload.signal,
              onProgress: (p: number) => payload.onProgress?.((doneBytes + p * sizes[i]) / totalBytes),
            })
            uploaded.push({ r, f })
            doneBytes += sizes[i]
          }
          const refs = uploaded.map(({ r, f }) => refFrom(r, { type: f?.mimeType, name: f?.fileName || f?.name }))
          real = await api.chat.messages.send(convId, {
            clientNonce,
            type: refs[0]?.kind || 'FILE',
            body: payload.body,
            media: refs,
            replyToId: payload.replyToId ?? undefined,
          } as any)
        } catch (e) {
          /* The send never happened — don't leak the already-ingested assets. */
          for (const { r } of uploaded) {
            if (r?.assetId) api.media.remove(r.assetId).catch(() => {})
          }
          throw e
        }
      } else {
        real = await api.chat.messages.sendFiles(convId, {
          clientNonce,
          body: payload.body,
          files: payload.files,
          replyToId: payload.replyToId ?? undefined,
          durationMs: payload.durationMs ?? undefined,
          waveform: payload.waveform ?? undefined,
          onProgress: payload.onProgress,
          signal: payload.signal,
        } as any)
      }
      nonces.current.delete(clientNonce)
      settle(tmpId, real)
      noteOutgoing(convId, real)
      return real
    } catch (e: any) {
      nonces.current.delete(clientNonce)
      /* A deliberate cancel removes the bubble outright — a "failed" bubble
         for something the user stopped on purpose would just demand a second
         dismissal. Re-thrown so the caller knows nothing was sent. */
      if (e?.name === 'AbortError') {
        store.current.delete(String(tmpId))
        commit()
        throw e
      }
      fail(tmpId, e)
      throw e
    }
  }, [convId, optimistic, settle, fail, noteOutgoing, commit])

  /** Re-send a failed optimistic bubble under a FRESH nonce. Reusing the old
   *  one would make the server treat the retry as a duplicate and answer with
   *  a message that was never stored. */
  const retry = React.useCallback(async (tmpId: string) => {
    const row = store.current.get(String(tmpId))
    if (!row) return
    store.current.delete(String(tmpId))
    commit()
    if (row._files?.length) {
      await sendFiles({
        body: row.body, replyToId: row.replyToId, files: row._files,
        optimisticMedia: row.media, durationMs: row._durationMs, waveform: row._waveform,
      })
    } else {
      await send({ body: row.body, replyToId: row.replyToId, type: row.type, poll: row.poll, location: row.location, contact: row.contact })
    }
  }, [commit, send, sendFiles])

  const drop = React.useCallback((tmpId: string) => {
    store.current.delete(String(tmpId))
    commit()
  }, [commit])

  const edit = React.useCallback(async (messageId: string, body: string) => {
    const before = store.current.get(String(messageId))
    patch(messageId, m => ({ ...m, body, editedAt: new Date().toISOString() }))
    try { return await api.chat.messages.edit(messageId, body) }
    catch (e) { if (before) patch(messageId, () => before); throw e }
  }, [patch])

  const remove = React.useCallback(async (messageId: string, scope: 'me' | 'everyone') => {
    const before = store.current.get(String(messageId))
    if (scope === 'me') { store.current.delete(String(messageId)); commit() }
    else patch(messageId, m => ({ ...m, deleted: true, deletedBy: myId, body: '', media: [], reactions: [] }))
    try { await api.chat.messages.remove(messageId, scope) }
    catch (e) {
      if (before) { store.current.set(String(messageId), before); commit() }
      throw e
    }
  }, [commit, patch, myId])

  /* Optimistic like toggleStar below — these were the last engagement writes
     in the app whose chip did not move until the server answered. The guess
     touches only the counts; the server's authoritative rows replace it, and
     the screen's localReactions map keeps carrying the mine-highlight. */
  const react = React.useCallback(async (messageId: string, emoji: string) => {
    const before = store.current.get(String(messageId))
    patch(messageId, m => {
      const rows = [...(m.reactions || [])]
      const i = rows.findIndex((r: any) => r.emoji === emoji)
      if (i >= 0) rows[i] = { ...rows[i], count: (rows[i].count || 0) + 1 }
      else rows.push({ emoji, count: 1 })
      return { ...m, reactions: rows }
    })
    try {
      const rows: any = await api.chat.messages.react(messageId, emoji)
      patch(messageId, m => ({ ...m, reactions: rows, _reactionsAuthoritative: true }))
      return rows
    } catch (e) {
      if (before) patch(messageId, () => before)
      throw e
    }
  }, [patch])

  const unreact = React.useCallback(async (messageId: string, emojiHint?: string) => {
    const before = store.current.get(String(messageId))
    /* The caller knows which chip was tapped; without the hint the guess is
       skipped and only the reconcile lands (the old behaviour). */
    if (emojiHint) {
      patch(messageId, m => ({
        ...m,
        reactions: (m.reactions || [])
          .map((r: any) => (r.emoji === emojiHint ? { ...r, count: Math.max(0, (r.count || 1) - 1) } : r))
          .filter((r: any) => (r.count || 0) > 0),
      }))
    }
    try {
      const rows: any = await api.chat.messages.unreact(messageId)
      patch(messageId, m => ({ ...m, reactions: rows, _reactionsAuthoritative: true }))
      return rows
    } catch (e) {
      if (before) patch(messageId, () => before)
      throw e
    }
  }, [patch])

  const toggleStar = React.useCallback(async (messageId: string, starred: boolean) => {
    patch(messageId, m => ({ ...m, starred }))
    try { await (starred ? api.chat.messages.star(messageId) : api.chat.messages.unstar(messageId)) }
    catch (e) { patch(messageId, m => ({ ...m, starred: !starred })); throw e }
  }, [patch])

  const setPinned = React.useCallback(async (messageId: string, pin: boolean) => {
    try {
      await (pin ? api.chat.messages.pin(convId, messageId) : api.chat.messages.unpin(convId, messageId))
      await loadPinned()
    } catch (e) { await loadPinned(); throw e }
  }, [convId, loadPinned])

  /* Optimistic marks only — results (`pct`) stay server-computed, so the
     guess is just the radio fill, `voted`, and the voter line. closePoll
     stays request-then-patch: closing is an admin act, not a feel path. */
  const vote = React.useCallback(async (messageId: string, indexes: number[]) => {
    const before = store.current.get(String(messageId))
    const chosen = new Set(indexes)
    patch(messageId, m => (m.poll?.options ? {
      ...m,
      poll: {
        ...m.poll,
        voted: true,
        totalVoters: (m.poll.totalVoters || 0) + (m.poll.voted ? 0 : 1),
        options: m.poll.options.map((o: any) => (chosen.has(o.index) ? { ...o, mine: true } : o)),
      },
    } : m))
    try {
      const poll: any = await api.chat.messages.vote(messageId, indexes)
      patch(messageId, m => ({ ...m, poll }))
    } catch (e) {
      if (before) patch(messageId, () => before)
      throw e
    }
  }, [patch])

  const retractVote = React.useCallback(async (messageId: string) => {
    const before = store.current.get(String(messageId))
    patch(messageId, m => (m.poll?.options ? {
      ...m,
      poll: {
        ...m.poll,
        voted: false,
        totalVoters: Math.max(0, (m.poll.totalVoters || 0) - (m.poll.voted ? 1 : 0)),
        options: m.poll.options.map((o: any) => (o.mine ? { ...o, mine: false } : o)),
      },
    } : m))
    try {
      const poll: any = await api.chat.messages.retractVote(messageId)
      patch(messageId, m => ({ ...m, poll }))
    } catch (e) {
      if (before) patch(messageId, () => before)
      throw e
    }
  }, [patch])

  const closePoll = React.useCallback(async (messageId: string) => {
    const poll: any = await api.chat.messages.closePoll(messageId)
    patch(messageId, m => ({ ...m, poll }))
  }, [patch])

  /** The only read that populates `reactedByMe` — the reaction sheet and a
   *  jump to an unloaded message both need it. */
  const hydrate = React.useCallback(async (messageId: string) => {
    const m: any = await api.chat.messages.get(messageId)
    if (m) merge([{ ...m, _reactionsAuthoritative: true }])
    return m
  }, [merge])

  const has = React.useCallback((id: string) => store.current.has(String(id)), [])

  /* The return value's identity is a dependency in the screen's renderRow and
     every send/scroll callback, so it must only change when the STATE changes.
     Every method above is useCallback-stable; a bare object literal here would
     hand the screen a fresh identity per render and defeat all of it. */
  return React.useMemo(() => ({
    messages, loading, loadingOlder, hasMore, error, pinnedList, gone,
    reload: loadFirst, loadOlder, pageToward, sync, loadPinned,
    markReadUpTo, hydrate,
    send, sendFiles, retry, drop, edit, remove,
    react, unreact, toggleStar, setPinned, vote, retractVote, closePoll,
    has,
  }), [
    messages, loading, loadingOlder, hasMore, error, pinnedList, gone,
    loadFirst, loadOlder, pageToward, sync, loadPinned,
    markReadUpTo, hydrate,
    send, sendFiles, retry, drop, edit, remove,
    react, unreact, toggleStar, setPinned, vote, retractVote, closePoll,
    has,
  ])
}

/** The reply strip on an optimistic bubble: the server would send one back,
 *  but not for another second, and a reply that renders without its quote
 *  looks like the quote was lost. */
function snapshotReply(store: Map<string, any>, replyToId: string) {
  const target = store.get(String(replyToId))
  if (!target) return null
  return {
    messageId: String(replyToId),
    senderId: target.senderId,
    type: target.type,
    snippet: target.body || '',
    deleted: !!target.deleted,
  }
}
