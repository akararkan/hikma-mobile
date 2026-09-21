/* =========================================================
   The shared-content card inside a chat bubble.

   The backend sends a share as a plain TEXT body carrying a
   short link (lib/shareLinks) — no preview payload, no
   tombstone flag. So the card hydrates itself from the
   entity's own public GET, through a module cache so a
   thread with the same post shared five times fetches once,
   and a recycled FlashList row remounts for free.

   Unavailable content is a fact, not an error: a deleted post,
   a hidden paper and a block edge all answer 404 the same way
   (research.md "a block edge answers 404 exactly like a
   deletion"), so a 404 caches as a quiet "no longer available"
   plate — never a toast, never a retry loop. Anything else
   (network, 500) stays UNcached so the next mount retries.

   TWO FORMS, and the content picks.

   · HERO — a share that owns a picture (a post, a reel) leads
     with it: full-bleed to the bubble's content width, at the
     media's own aspect, with the name and the caption on a
     strip underneath. The maths is MediaGrid's, to the line,
     so a reel someone SENT you is the same size in the thread
     as a reel someone attached. A 44pt thumbnail beside three
     lines of type was the reply-strip grammar, and it made
     every share look like a settings row.
   · COMPACT — a paper, a question, a profile, a live host:
     nothing here has a picture worth a plate, so the icon or
     the face sits at 52pt beside the type.

   Neither form carries a chevron. A card the whole of which is
   the target does not need an arrow to say so, and the arrow
   was most of why this read as a list item.

   Renders inside both bubble sides: everything inks off the
   fg/fgMuted the bubble hands over, the same contract as
   FileTile — no colour literals, no surface of its own beyond
   the sanctioned self-ink wash.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useRouter } from 'expo-router'
import { RemoteImage } from '@/components/media/RemoteImage'
import { api, isNotFound } from '@/api'
import type { ShareRef } from '@/lib/shareLinks'
import { withAlpha } from '@/theme/colors'
import { useTheme } from '@/theme/ThemeProvider'
import { setback, shape, space } from '@/theme/tokens'
import { Icon, LiveTag, Text, Touchable, type IconName } from '@/ui'

type Preview = {
  gone?: boolean
  kindLabel: string
  title: string
  sub: string
  thumb: string | null
  /** Faces are circles; content thumbs are plates. */
  round: boolean
  live: boolean
  /** The thumb is REAL MEDIA, not a stand-in face or a logo — so it leads the
   *  card at full width instead of sitting beside the type. */
  hero: boolean
  /** w / h of that media, for the hero's height. */
  ratio: number
  /** A play plate over the hero. */
  video: boolean
}

/** The post adapters carry the aspect as a string (`'9/16'`, `'16/10'`) rather
 *  than as pixel dimensions — see api/adapters.mediaFromUrls. */
function ratioOf(spec: any, fallback: number): number {
  const m = String(spec || '').match(/^\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*$/)
  const r = m && Number(m[2]) ? Number(m[1]) / Number(m[2]) : NaN
  return Number.isFinite(r) && r > 0 ? r : fallback
}

/** MediaGrid's ceiling, and for the same reason: past this a single picture
 *  stops being a message and starts being the screen. */
const HERO_MAX_H = 320

const KIND_META: Record<ShareRef['kind'], { label: string; icon: IconName; noun: string }> = {
  post: { label: 'Post', icon: 'image', noun: 'post' },
  research: { label: 'Paper', icon: 'research', noun: 'paper' },
  question: { label: 'Question', icon: 'qna', noun: 'question' },
  live: { label: 'Live', icon: 'live', noun: 'stream' },
  channel: { label: 'Channel', icon: 'channels', noun: 'channel' },
  invite: { label: 'Invitation', icon: 'people', noun: 'invitation' },
  profile: { label: 'Profile', icon: 'person', noun: 'profile' },
  story: { label: 'Story', icon: 'camera', noun: 'story' },
}

const oneLine = (s: any) => String(s || '').replace(/\s+/g, ' ').trim()

async function fetchPreview(share: ShareRef): Promise<Preview> {
  const meta = KIND_META[share.kind]
  const base: Preview = {
    kindLabel: meta.label, title: '', sub: '', thumb: null, round: false, live: false,
    hero: false, ratio: 16 / 10, video: false,
  }

  switch (share.kind) {
    case 'post': {
      const p: any = await api.posts.get(share.ref)
      const reel = p?.type === 'REEL'
      const m = p?.media?.[0]
      const shot = m?.poster || m?.url || null
      return {
        ...base,
        kindLabel: reel ? 'Reel' : 'Post',
        title: p?._author?.full || (p?._author?.handle ? `@${p._author.handle}` : 'Post'),
        sub: oneLine(p?.body),
        /* No picture on the post — fall back to the author's face, which is a
           face and therefore a circle beside the type, never a hero. */
        thumb: shot || p?._author?.profileImage || null,
        round: !shot,
        hero: !!shot,
        /* postFromResponse maps every part through mediaFromUrls, which stamps
           16/10 on all of them — true for a photo, wrong for a reel, which is
           9/16 by definition. The post type is the better witness. */
        ratio: reel ? 9 / 16 : ratioOf(m?.ratio, 16 / 10),
        video: m?.type === 'VIDEO',
      }
    }
    case 'research': {
      const dto: any = share.via === 'token'
        ? await api.research.byShareToken(share.ref)
        : await api.research.get(share.ref)
      return {
        ...base,
        title: oneLine(dto?.title) || 'Research paper',
        sub: dto?.researcherFullName ? `by ${dto.researcherFullName}` : '',
      }
    }
    case 'question': {
      const q: any = await api.qna.get(share.ref)
      return {
        ...base,
        title: oneLine(q?.title) || 'Question',
        sub: q?._author?.full ? `Asked by ${q._author.full}` : '',
      }
    }
    case 'live': {
      const s: any = await api.chat.streams.get(share.ref)
      return {
        ...base,
        title: oneLine(s?.title) || 'Live',
        sub: s?.isLive
          ? (s?.hostHandle ? `@${s.hostHandle} is live` : 'Live now')
          : 'This stream has ended',
        thumb: s?.hostAvatarUrl || null,
        round: true,
        live: !!s?.isLive,
      }
    }
    case 'channel': {
      const ch: any = await api.channels.byHandle(share.ref)
      return {
        ...base,
        title: ch?.title || 'Channel',
        sub: `@${ch?.handle || share.ref} · ${ch?.subscriberCount ?? 0} subscribers`,
        thumb: ch?.avatarUrl || null,
      }
    }
    case 'profile': {
      const u: any = await api.users.getByUsername(share.ref)
      return {
        ...base,
        title: u?.full || `@${share.ref}`,
        sub: u?.handle ? `@${u.handle}` : '',
        thumb: u?.profileImage || null,
        round: true,
      }
    }
    case 'story': {
      const u: any = await api.users.get(share.ref)
      return {
        ...base,
        title: u?.full || 'Story',
        sub: u?.handle ? `@${u.handle}` : '',
        thumb: u?.profileImage || null,
        round: true,
      }
    }
    case 'invite':
      /* An invite token resolves only by JOINING — there is no public
         preview read, so the card states what it is and the /join route
         does the resolving. */
      return { ...base, title: 'You are invited', sub: 'Tap to view the invitation' }
  }
}

/* Settled previews (ok AND 404-gone) live for the session; in-flight promises
   dedupe the burst a thread mount fires. Transient failures cache nothing. */
const settled = new Map<string, Preview>()
const inflight = new Map<string, Promise<Preview>>()

function usePreview(share: ShareRef): Preview | null {
  const key = `${share.kind}:${share.via}:${share.ref}`
  const [prev, setPrev] = React.useState<Preview | null>(() => settled.get(key) ?? null)

  React.useEffect(() => {
    if (settled.has(key)) { setPrev(settled.get(key)!); return }
    let alive = true
    let p = inflight.get(key)
    if (!p) {
      p = fetchPreview(share)
        .catch(e => {
          if (isNotFound(e)) {
            const gonePrev: Preview = {
              gone: true, kindLabel: KIND_META[share.kind].label, title: '', sub: '',
              thumb: null, round: false, live: false, hero: false, ratio: 16 / 10, video: false,
            }
            return gonePrev
          }
          throw e
        })
        .then(res => { settled.set(key, res); return res })
        .finally(() => { inflight.delete(key) })
      inflight.set(key, p)
    }
    p.then(res => { if (alive) setPrev(res) }).catch(() => { /* transient — next mount retries */ })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return prev
}

export function ShareCard({ share, fg, fgMuted, accent, width, onDark }: {
  share: ShareRef
  fg: string
  fgMuted: string
  /** The caption ink for the kind label — the bubble's quote-who colour. */
  accent: string
  width: number
  /** True inside the own (navy) bubble — deepens the self-ink wash a step. */
  onDark: boolean
}) {
  const t = useTheme()
  const router = useRouter()
  const preview = usePreview(share)
  const meta = KIND_META[share.kind]

  const gone = !!preview?.gone
  const thumb = gone ? null : preview?.thumb ?? null
  const round = !!preview?.round
  const hero = !!preview?.hero && !!thumb
  /* One wash for both forms: the media covers the top of it and what is left
     showing IS the caption strip, which is the whole trick — no second plate,
     no border, nothing that has to be kept in step with the bubble's side. */
  const wash = withAlpha(fg, onDark ? 0.12 : 0.07)

  /* MediaGrid's single-image maths, deliberately unchanged: same clamp, same
     ceiling, so a shared reel and an attached one are the same object. */
  const heroH = hero
    ? Math.min(HERO_MAX_H, Math.round(width / Math.max(0.5, Math.min(2.2, preview!.ratio))))
    : 0

  const shell = (
    <>
      <View style={styles.kindRow}>
        <Text variant="caption" color={accent} align="ui" numberOfLines={1}>
          {preview && !gone ? preview.kindLabel : meta.label}
        </Text>
        {preview?.live ? <LiveTag /> : null}
      </View>
      {gone ? (
        <Text variant="footnote" italic color={fgMuted} align="auto" style={styles.line}>
          This {meta.noun} is no longer available
        </Text>
      ) : (
        <>
          {/* Bigger than the old subhead, and that is the point: on a card the
              picture leads, the name is the second thing read, not the fifth
              thing on the row. */}
          <Text variant="callout" weight="600" color={fg} align="auto" numberOfLines={1} style={styles.line}>
            {preview?.title || '…'}
          </Text>
          {preview?.sub ? (
            <Text variant="footnote" color={fgMuted} align="auto" numberOfLines={2} style={styles.sub}>
              {preview.sub}
            </Text>
          ) : null}
        </>
      )}
    </>
  )

  const seat = {
    onPress: () => router.push(share.route as any),
    feedback: 'dim' as const,
    noAutoHitSlop: true,
    disabled: gone,
    accessibilityRole: 'button' as const,
    accessibilityLabel: gone
      ? `Shared ${meta.noun}, no longer available`
      : `Shared ${meta.noun}${preview?.title ? `: ${preview.title}` : ''}`,
  }

  if (hero) {
    return (
      <Touchable {...seat} style={[styles.heroCard, { width, backgroundColor: wash }]}>
        {/* Sunken behind the picture, so a slow decode is a quiet plate at the
            card's own size rather than a hole that resizes when it lands. */}
        <View style={{ width, height: heroH, backgroundColor: t.colors.surfaceSunken }}>
          {/* A dead thumbnail (moderation deleted the asset) leaves the quiet
              sunken plate above — the card itself keeps working. */}
          <RemoteImage
            source={thumb!}
            fallback="hidden"
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            transition={140}
            cachePolicy="memory-disk"
            recyclingKey={thumb!}
          />
          {preview!.video ? (
            /* MediaGrid's play plate, at MediaGrid's size — a shared reel and
               an attached one must not disagree about what a video looks like. */
            <View style={[StyleSheet.absoluteFill, styles.center]} pointerEvents="none">
              <View style={[styles.play, { backgroundColor: t.colors.overlayChip }]}>
                <Icon name="play" size={20} color={t.colors.overlayText} filled />
              </View>
            </View>
          ) : null}
        </View>
        <View style={styles.footer}>{shell}</View>
      </Touchable>
    )
  }

  return (
    <Touchable {...seat} style={[styles.card, { width, backgroundColor: wash }]}>
      {thumb ? (
        /* On a dead thumb, fall to the same icon stand-in a thumbless share
           gets — RemoteImage's glyph rides the row's sunken tone. */
        <RemoteImage
          source={thumb}
          fallbackIcon={meta.icon}
          style={[styles.thumb, round ? styles.thumbRound : { borderRadius: t.radius.sm }]}
          contentFit="cover"
          cachePolicy="memory-disk"
          recyclingKey={thumb}
        />
      ) : (
        /* Icon stand-in on its own quiet wash — the FileTile grammar, minus
           the tinted document plate: shares are not documents. */
        <View style={[styles.thumb, round ? styles.thumbRound : { borderRadius: t.radius.sm }, { backgroundColor: withAlpha(fg, 0.1) }]}>
          <Icon name={meta.icon} size={22} color={fgMuted} />
        </View>
      )}
      <View style={styles.flex}>{shell}</View>
    </Touchable>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  /* A quiet self-ink wash so the card recedes into whichever bubble side it
     sits on. `shape.card`, not `shape.field`, and the same 14 MediaGrid gives
     a picture: this is a piece of content in a bubble, not an input in a form. */
  heroCard: {
    marginBottom: space.xs2, overflow: 'hidden',
    ...setback(shape.card), borderCurve: 'continuous',
  },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    padding: space.sm2, marginBottom: space.xs2, overflow: 'hidden',
    ...setback(shape.card), borderCurve: 'continuous',
  },
  /* The strip under the picture. Roomier than the compact row's padding —
     type that starts at the very edge of a photo reads as a caption that fell
     off it. */
  footer: { paddingHorizontal: space.md, paddingTop: space.sm2, paddingBottom: space.md },
  thumb: { width: 52, height: 52, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  thumbRound: { borderRadius: 26 },
  kindRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs2 },
  /* 3 and 1: the eyebrow is set in caps with its own tracking, so it already
     carries air under it; the caption needs the opposite. */
  line: { marginTop: space.xs },
  sub: { marginTop: space.xxs },
  play: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
})
