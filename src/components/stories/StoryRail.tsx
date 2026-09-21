/* =========================================================
   StoryRail — the story-card tray at the top of the feed.

   The card form is not decoration: a circle can only show a
   face, while a tile shows the STORY — which is the thing
   being offered — with the face as an authorship mark in the
   corner. The anatomy, and why each part is where it is:

     · "Create story" is the first tile and is shaped like the
       others (same 9:16 plate), so the rail reads as one row
       of cards. Its top is your own photo; the surface foot
       carries the navy + and the label.
     · Every other tile is the story's own cover, full-bleed,
       under a bottom scrim (white text over an unknown photo
       is illegible without one). A text-only stack paints the
       newest frame's OWN words on its deterministic gradient
       (frameGradient keys on the storyId — the same rule the
       viewer uses), so it still looks authored, not broken.
     · The author ring sits top-start, lit in steel while
       unseen. A count pill appears only above 1 — "1" on a
       single story is noise. (The counter pill is one of the
       two sanctioned pills.)
     · Unseen tiles lead, newest first; watched ones sink to
       the end but stay reachable.

   Two rules kept from the old rail:

     1. A rail is a garnish. It never shows an error, never
        blocks — `loadTray` fail-opens to [] precisely so a
        broken following graph cannot take the feed with it.
     2. It opens no socket of its own. Everything comes from
        the shared tray store, fed by the ONE app-wide tray
        stream RealtimeContext holds for the session.

   The tiles are dark-by-design surfaces (like the viewer they
   open), so this file may read night ink and gradient math —
   the DESIGN.md §1 exception — while the Create foot wears the
   active theme.
   ========================================================= */
import React from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import { Image } from 'expo-image'
import { LinearGradient } from 'expo-linear-gradient'
import { useFocusEffect, useRouter } from 'expo-router'
import { initialsOf } from '@/api/adapters.js'
import { useAuth } from '@/context/AuthContext'
import { useMyStoryViews } from '@/lib/storyTray'
import { mayAutoLoadPhotos } from '@/lib/mediaPrefs'
import { isMyStoryUnseen, isStoryUnseen, markMyStorySeen, markStorySeen } from '@/lib/storySeen'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { avatarGradient, mixHex, withAlpha } from '@/theme/colors'
import { useEvent } from '@/hooks/useAsync'
import { Icon, NumericText, Text, Touchable, fireHaptic } from '@/ui'
import { StoryRing } from './StoryRing'
import { StoryRailSkeleton } from './StorySkeleton'
import { refreshMine, useStoryTray } from './trayStore'
import { frameGradient, newestAt, posterOf } from './storyVisual'
import { BLACK } from './night'

/* One card: 9:16 at a width that puts three-and-a-bit tiles on a phone —
   the cut-off card is the scroll affordance. */
const TILE_W = 106
const TILE_H = 188
const FOOT_H = 56

export interface StoryRailProps {
  onOpenAuthor?: (authorId: string) => void
  onCompose?: () => void
  onSeeAll?: () => void
  showSelf?: boolean
}

export function StoryRail({ onOpenAuthor, onCompose, onSeeAll, showSelf = true }: StoryRailProps = {}) {
  const router = useRouter()
  const { user } = useAuth()
  const me = user?.id ? String(user.id) : null

  const { tray, mine, loading } = useStoryTray(me)
  /* Bumped on focus so the rings re-evaluate against the local seen-stamps the
     viewer just wrote — otherwise a ring you cleared stays lit until the next
     fan-out replaces the array. The self read rides along: the tray SSE never
     carries your own posts, so a silently-failed refreshMine would otherwise
     leave "Your story" blank until the next mount. */
  const [epoch, setEpoch] = React.useState(0)
  useFocusEffect(React.useCallback(() => { setEpoch(n => n + 1); void refreshMine(); return undefined }, []))

  const { views } = useMyStoryViews(mine, epoch)
  const myNewest = React.useMemo(() => newestAt(mine), [mine])

  /* My own tile's face: the newest frame with real media, else the newest
     TEXT frame's words — the same precedence entryOf applies to everyone. */
  const myPoster = React.useMemo(
    () => posterOf(mine.find(s => s.thumbnailUrl || s.mediaUrl) ?? null),
    [mine],
  )
  const myText = React.useMemo(() => {
    if (myPoster) return null
    const f = [...mine]
      .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
      .find(s => s.textContent)
    return f ? { text: String(f.textContent), seed: String(f.storyId) } : null
  }, [mine, myPoster])

  /* Unseen first (newest first), watched sunk to the end — the ordering the
     reader actually wants. `epoch` is the re-read trigger for the local
     seen-stamps. */
  const rows = React.useMemo(() => {
    const list = tray.map(e => ({ ...e, unseen: isStoryUnseen(e.authorId, e.at) }))
    return list.sort((a, b) => (a.unseen === b.unseen ? b.at - a.at : a.unseen ? -1 : 1))
  }, [tray, epoch])   // eslint-disable-line react-hooks/exhaustive-deps -- epoch re-reads the seen-stamps

  /* Warm the frame the next tap will open: the first unseen author's cover is
     exactly what the viewer paints under its full-res read, and the tile has
     it in cache already — this covers the case where the tray scrolled and
     the tile was recycled out. Auto-download gated like every warm the reader
     did not ask for (the story pager's rule). */
  React.useEffect(() => {
    if (!rows.length || !mayAutoLoadPhotos()) return
    const first = rows.find(e => e.unseen) || rows[0]
    if (first?.cover) void Image.prefetch(first.cover, 'memory-disk').catch(() => {})
  }, [rows])

  /* Every handler below is a useEvent: one identity for the life of the rail,
     so the memoized tiles only re-render when their own scalars move. */
  const compose = useEvent(() => {
    if (onCompose) onCompose()
    else router.push('/story/compose' as any)
  })

  const open = useEvent((authorId: string, at: number) => {
    markStorySeen(authorId, at)
    setEpoch(n => n + 1)
    if (onOpenAuthor) onOpenAuthor(authorId)
    else router.push(`/story/${authorId}?source=tray` as any)
  })

  const openMine = useEvent(() => {
    if (!me) return
    if (!mine.length) { compose(); return }
    markMyStorySeen(myNewest, views)
    setEpoch(n => n + 1)
    router.push(`/story/${me}` as any)
  })

  const seeAll = useEvent(() => {
    if (onSeeAll) onSeeAll()
    else router.push('/story' as any)
  })

  const openMineLong = useEvent(() => { fireHaptic('light'); router.push('/story/mine' as any) })

  if (loading && !tray.length && !mine.length) {
    return <View style={styles.rail}><StoryRailSkeleton /></View>
  }
  /* Signed out (or self hidden) with nothing to show is nothing to draw. */
  if (!(showSelf && me) && !tray.length) return null

  /* THE SHARED one (api/adapters). This file used to carry its own, which took
     the first two characters of the whole string — so "akar arkan" read AK and
     "Ui Test" read UI, and my tile disagreed with every other tile on the rail,
     which all use the author view's precomputed `initials`. */
  const myInitials = initialsOf(user?.displayName || user?.handle || 'You')

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.rail}
      contentContainerStyle={styles.content}
    >
      {showSelf && me ? (
        <CreateTile
          uri={user?.profileImage || null}
          initials={myInitials}
          seed={me}
          onPress={compose}
        />
      ) : null}

      {showSelf && me && mine.length ? (
        <Tile
          label="Your story"
          cover={myPoster}
          preview={myText?.text ?? null}
          previewSeed={myText?.seed ?? me}
          uri={user?.profileImage || null}
          initials={myInitials}
          avc={null}
          seed={me}
          unseen={isMyStoryUnseen(myNewest, views)}
          count={mine.length}
          onOpen={openMine}
          onHold={openMineLong}
        />
      ) : null}

      {rows.map(entry => (
        <Tile
          key={String(entry.authorId)}
          authorId={String(entry.authorId)}
          at={entry.at}
          label={entry.author?.full || 'Member'}
          cover={entry.cover}
          preview={entry.preview ?? null}
          previewSeed={entry.previewSeed ?? String(entry.authorId)}
          uri={entry.author?.profileImage || null}
          initials={entry.author?.initials || '··'}
          avc={entry.author?.avc || null}
          seed={String(entry.authorId)}
          unseen={entry.unseen}
          count={entry.count}
          onOpen={open}
          onHold={seeAll}
        />
      ))}
    </ScrollView>
  )
}

/* ---------------------------------------------------------
   The Create tile: your photo (or plate) on top, the active
   theme's surface as the foot, the navy + straddling the seam
   so it reads as one card with the tiles beside it.
   --------------------------------------------------------- */
function CreateTile({
  uri, initials, seed, onPress,
}: { uri: string | null; initials: string; seed: string; onPress: () => void }) {
  const t = useTheme()
  const c = t.colors
  return (
    <Touchable
      onPress={onPress}
      feedback="scale"
      noAutoHitSlop
      accessibilityLabel="Create a story"
      style={[styles.tile, { backgroundColor: c.surfaceSunken, borderColor: c.border }]}
    >
      {uri ? (
        <Image source={{ uri }} style={styles.createCover} contentFit="cover" cachePolicy="memory-disk" recyclingKey={uri} />
      ) : (
        <View style={[styles.createCover, styles.center, { backgroundColor: avatarGradient(seed)[0] }]}>
          <Text serif weight="600" color={c.textOnAccent} style={styles.plateInitials}>{initials}</Text>
        </View>
      )}
      <View style={[styles.createFoot, { backgroundColor: c.surface }]}>
        <View style={[styles.plus, { backgroundColor: c.accent, borderColor: c.surface }]}>
          <Icon name="add" size={16} color={c.textOnAccent} />
        </View>
        <Text variant="footnote" weight="600" align="center" numberOfLines={1}>Create story</Text>
      </View>
    </Touchable>
  )
}

/* ---------------------------------------------------------
   One story tile. Scalars in, one shared handler pair out —
   the shape that makes React.memo worth having.
   --------------------------------------------------------- */
const Tile = React.memo(function Tile({
  authorId, at = 0, label, cover, preview, previewSeed, uri, initials, avc, seed,
  unseen, count, onOpen, onHold,
}: {
  /** Absent on the self tile, whose handlers take no arguments. */
  authorId?: string
  at?: number
  label: string
  cover: string | null
  preview: string | null
  previewSeed: string
  uri: string | null
  initials: string
  avc: string | null
  seed: string
  unseen: boolean
  count: number
  onOpen: (authorId: string, at: number) => void
  onHold?: () => void
}) {
  const t = useTheme()
  const c = t.colors
  const press = React.useCallback(() => { onOpen(authorId ?? '', at) }, [onOpen, authorId, at])

  /* The plate under everything: a real cover, else the text frame's own
     gradient, else the author's deterministic colour fading into night.

     The AUTHOR'S FACE is deliberately not the ground here: the StoryRing below
     already carries it, and a tile wearing the same face full-bleed AND in its
     ring shows one person twice. That ring looked empty for your own story
     until 2026-08-21 — not because it was missing, but because it was handed
     `user.avatarUrl`, a key the meFrom view does not have. */
  const plate = cover ? null : preview ? frameGradient(previewSeed) : null
  const fallback = avc || avatarGradient(seed)[0]

  return (
    <Touchable
      onPress={press}
      onLongPress={onHold}
      feedback="scale"
      noAutoHitSlop
      accessibilityLabel={unseen ? `${label} — new story` : `${label}'s story`}
      style={[styles.tile, { backgroundColor: fallback, borderColor: c.border }]}
    >
      {cover ? (
        <Image
          source={{ uri: cover }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={120}
          cachePolicy="memory-disk"
          recyclingKey={cover}
        />
      ) : (
        <LinearGradient
          colors={plate
            ? [plate[0], mixHex(plate[1], BLACK, 0.55)]
            : [fallback, mixHex(fallback, BLACK, 0.55)]}
          start={{ x: 0.2, y: 0 }}
          end={{ x: 0.8, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
      )}

      {preview && !cover ? (
        <View style={styles.previewBox} pointerEvents="none">
          {/* The frame's own words, in the editorial voice — Amiri carries
              Arabic and Kurdish runs exactly as the viewer will. */}
          <Text serif color={c.textOnAccent} align="center" numberOfLines={4} style={styles.previewText}>
            {preview}
          </Text>
        </View>
      ) : null}
      {!preview && !cover ? (
        <View style={[StyleSheet.absoluteFill, styles.center]} pointerEvents="none">
          <Text serif weight="600" color={c.textOnAccent} style={styles.plateInitials}>{initials}</Text>
        </View>
      ) : null}

      {/* The scrim is load-bearing over a photo: white text on an unknown
          image is illegible without it. The drawn plates are already dark. */}
      {cover ? (
        <LinearGradient
          colors={[withAlpha(BLACK, 0), withAlpha(BLACK, 0.72)]}
          style={styles.scrim}
          pointerEvents="none"
        />
      ) : null}

      <View style={styles.ring} pointerEvents="none">
        <StoryRing
          uri={uri}
          initials={initials}
          avc={avc}
          size={34}
          state={unseen ? 'unseen' : 'seen'}
          gapColor="transparent"
          /* Steel, the web's choice: sky is so pale that over a navy tile it
             reads as white. Plain bordered ring — SealRing spec, list-safe. */
          ringUnseenColor={c.storyRing}
          /* Stone for seen (§2) — the default ink.ghost is the night skin's. */
          ringSeenColor={c.storyRingSeen}
        />
      </View>

      {count > 1 ? (
        /* The counter pill — one of the two sanctioned pills. */
        <View style={[styles.count, { backgroundColor: c.overlayBg }]} pointerEvents="none">
          <NumericText variant="micro" caps={false} color={c.overlayText}>{count}</NumericText>
        </View>
      ) : null}

      <Text
        variant="footnote"
        weight="600"
        color={c.overlayText}
        numberOfLines={2}
        style={styles.name}
        pointerEvents="none"
      >
        {label}
      </Text>
    </Touchable>
  )
})

const styles = StyleSheet.create({
  rail: { flexGrow: 0 },
  /* 14 = the feed plate's gutter: the first tile's edge lines up with the
     composer avatar and every author avatar in the column below. */
  content: { gap: space.sm, paddingHorizontal: space.md2, paddingBottom: space.xxs },
  tile: {
    width: TILE_W,
    height: TILE_H,
    borderRadius: 12,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  center: { alignItems: 'center', justifyContent: 'center' },
  /* THE LINE HEIGHT HAS TO COME WITH THE SIZE. The Text primitive defaults to
     the `body` variant, whose lineHeight is 23 — so overriding fontSize alone
     left 30pt letters inside a 23pt line box and the tops and tails were
     sliced off. Every other raw fontSize in this app carries its own
     lineHeight for exactly this reason. */
  plateInitials: { fontSize: 30, lineHeight: 38, letterSpacing: 0.5 },

  /* Create: the photo stops where the foot begins; the + rides the seam. */
  createCover: { position: 'absolute', top: 0, start: 0, end: 0, bottom: FOOT_H },
  createFoot: {
    position: 'absolute',
    start: 0,
    end: 0,
    bottom: 0,
    height: FOOT_H,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: space.sm2,
    paddingHorizontal: space.xs2,
  },
  plus: {
    position: 'absolute',
    top: -17,
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },

  previewBox: {
    position: 'absolute',
    top: 48,
    bottom: 40,
    start: 8,
    end: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewText: { fontSize: 13, lineHeight: 20 },
  scrim: { position: 'absolute', start: 0, end: 0, bottom: 0, height: '55%' },
  ring: { position: 'absolute', top: 8, start: 8 },
  count: {
    position: 'absolute',
    top: 10,
    end: 8,
    minWidth: 18,
    height: 18,
    borderRadius: 999,
    paddingHorizontal: space.xs2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: { position: 'absolute', start: 8, end: 8, bottom: 8 },
})
