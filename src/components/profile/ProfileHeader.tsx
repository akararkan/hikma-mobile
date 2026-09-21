/* =========================================================
   The profile header — cover, avatar, identity, bio, chips,
   stats. Shared by the owner's tab and /user/[id], with an
   `owner` flag switching the button pair.

   QELAT: the avatarless cover is a flat hash hue under a
   brick course (gradients are not part of the language), and
   the whole block closes with the gilt SEAL BAND — one of the
   band's two sanctioned homes (DESIGN.md §5.2).

   `profileViews` only ever renders from the owner read: the
   public profile endpoint returns 0 for it, so showing it on
   someone else's page would print a confident zero.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import * as WebBrowser from 'expo-web-browser'
import * as Clipboard from 'expo-clipboard'
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated'
import { useTheme } from '@/theme/ThemeProvider'
import { avatarGradient } from '@/theme/colors'
import { setback, space } from '@/theme/tokens'
import { assetUrl } from '@/api'
import {
  Avatar, BrickCourse, Icon, SealBand, Skeleton, Text, Touchable, fireHaptic, toast,
} from '@/ui'
import { BadgeRow } from './BadgeRow'
import { SpecializationChips, type TaxonomyRow } from './SpecializationChips'
import { StatRow, type StatKey, type Stats } from './StatRow'

export const COVER_HEIGHT = 180
const AVATAR = 92
const OVERLAP = 46

export interface ProfileHeaderProps {
  user: any
  stats: Stats | null
  statsDegraded?: boolean
  owner: boolean
  /** Resolved from api.madhhabs.byId — the profile carries only the English name. */
  madhhabRow?: TaxonomyRow | null
  scrollY: SharedValue<number>
  onStat: (key: StatKey) => void
  onAvatarPress?: () => void
  onCoverPress?: () => void
  /** The button pair beside the avatar. */
  primary?: React.ReactNode
  secondary?: React.ReactNode
  /** Relationship strips, warnings — rendered under the stat row. */
  children?: React.ReactNode
  statKeys?: StatKey[]
}

export function ProfileHeader({
  user, stats, statsDegraded, owner, madhhabRow, scrollY,
  onStat, onAvatarPress, onCoverPress, primary, secondary, children, statKeys,
}: ProfileHeaderProps) {
  const t = useTheme()
  const c = t.colors
  const [bioOpen, setBioOpen] = React.useState(false)

  const cover = user?.coverImage ? assetUrl(user.coverImage) : null
  const [coverHue] = avatarGradient(user?.id ?? user?.handle ?? '')

  /* The cover lags the scroll and stretches on overscroll — the one motion
     that makes a static header feel attached to the list above it. */
  const coverAnim = useAnimatedStyle(() => {
    const y = scrollY.value
    return {
      transform: [
        { translateY: y < 0 ? y * 0.6 : y * 0.28 },
        { scale: y < 0 ? 1 + Math.min(0.6, -y / COVER_HEIGHT) : 1 },
      ],
    }
  })

  const titleLine = [user?.selfDescriber, user?.academicTitle, user?.institution]
    .filter(Boolean)
    .join(' · ')

  return (
    <View>
      <Touchable onPress={onCoverPress} disabled={!onCoverPress} feedback="none" noAutoHitSlop>
        <View style={{ height: COVER_HEIGHT, overflow: 'hidden', backgroundColor: c.surfaceSunken }}>
          <Animated.View style={[StyleSheet.absoluteFill, coverAnim]}>
            {cover ? (
              <Image
                source={{ uri: cover }}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
                transition={200}
                cachePolicy="memory-disk"
              />
            ) : (
              /* Flat hash hue + running-bond brickwork (§5.1) — the cover
                 fallback is drawn clay, never a gradient. */
              <View style={[StyleSheet.absoluteFill, { backgroundColor: coverHue }]}>
                <BrickCourse />
              </View>
            )}
          </Animated.View>
        </View>
      </Touchable>

      <View style={{ paddingHorizontal: t.layout.screenPadding }}>
        <View style={[styles.avatarRow, { marginTop: -OVERLAP }]}>
          <View style={[styles.ring, { backgroundColor: c.bg, borderRadius: (AVATAR + 8) / 2 }]}>
            <Avatar
              uri={user?.profileImage}
              name={user?.full}
              seed={user?.id}
              size={AVATAR}
              onPress={onAvatarPress}
              accessibilityLabel={`${user?.full || 'Profile'} photo`}
            />
          </View>
          <View style={styles.actionPair}>
            {primary}
            {secondary}
          </View>
        </View>

        <View style={{ marginTop: space.sm2, gap: space.xxs }}>
          <View style={styles.nameLine}>
            <Text variant="title2" numberOfLines={2} align="auto" style={styles.shrink}>
              {user?.full || 'Member'}
            </Text>
            <BadgeRow badges={user?.badges} role={user?.role} size="md" />
          </View>

          <View style={styles.handleLine}>
            <Touchable
              onLongPress={async () => {
                await Clipboard.setStringAsync(`@${user?.handle || ''}`)
                fireHaptic('success')
                toast.ok('Handle copied')
              }}
              feedback="dim"
              noAutoHitSlop
            >
              <Text variant="body" tone="muted" align="ui">@{user?.handle || 'member'}</Text>
            </Touchable>
            {user?.profileLocked ? (
              /* Setback chip, not a pill — pills are for unread counters
                 and LIVE badges only (DESIGN.md §8.9). */
              <View style={[styles.lockChip, { backgroundColor: c.surfaceSunken, ...setback(t.shape.chip) }]}>
                <Icon name="lock" size={11} color={c.textMuted} />
                <Text variant="caption" tone="muted">Locked</Text>
              </View>
            ) : null}
          </View>

          {titleLine ? (
            <Text variant="body" tone="secondary" align="auto" style={{ marginTop: space.xs }}>{titleLine}</Text>
          ) : null}

          {user?.bio ? (
            <Touchable onPress={() => setBioOpen(o => !o)} feedback="none" noAutoHitSlop style={{ marginTop: space.xs2 }}>
              <BioText bio={String(user.bio)} open={bioOpen} />
              {!bioOpen && String(user.bio).length > 180 ? (
                <Text variant="subhead" tone="accent" align="ui" style={{ marginTop: space.xxs }}>more</Text>
              ) : null}
            </Touchable>
          ) : null}

          <View style={[styles.factRow, { marginTop: space.sm }]}>
            {user?.location ? <Fact icon="location" text={user.location} /> : null}
            {user?.website ? (
              <Touchable
                onPress={() => { void WebBrowser.openBrowserAsync(normalizeUrl(user.website)) }}
                feedback="dim"
                noAutoHitSlop
                style={styles.fact}
              >
                <Icon name="link" size={13} color={c.accent} />
                <Text variant="subhead" tone="accent" numberOfLines={1}>{prettyUrl(user.website)}</Text>
              </Touchable>
            ) : null}
            {user?.joinedAt ? <Fact icon="calendar" text={`Joined ${user.joinedAt}`} /> : null}
          </View>

          <SpecializationChips
            items={user?.specializations}
            lang={t.language}
            madhhab={user?.madhhabId != null || user?.madhhab ? { row: madhhabRow ?? null, fallbackName: user?.madhhab } : null}
            style={{ marginTop: space.md }}
          />
        </View>
      </View>

      <View style={{ marginTop: space.md2 }}>
        <StatRow stats={stats} keys={statKeys} onPress={onStat} degraded={statsDegraded} />
      </View>

      {owner && user?.profileViews != null ? (
        <Text
          variant="footnote"
          tone="muted"
          align="ui"
          style={{ paddingHorizontal: t.layout.screenPadding, marginTop: space.xxs }}
        >
          {user.profileViews === 1 ? '1 profile view' : `${user.profileViews} profile views`}
        </Text>
      ) : null}

      {owner ? <OwnerQuickLinks /> : null}

      {children}

      {/* The cylinder-seal impression that closes the header block —
          one of the SEAL BAND's two sanctioned homes (§5.2). */}
      <SealBand style={{ marginTop: space.md2, marginHorizontal: t.layout.screenPadding }} />
    </View>
  )
}

/* ---------------------------------------------------------
   The owner's private-page shortcuts — Activity, Saved, Liked
   have no tab of their own, and burying them in overflow made
   them unfindable. Accent-wash plates (the app-wide "buttons
   must read as buttons" rule), owner profile only.
   --------------------------------------------------------- */

function OwnerQuickLinks() {
  const t = useTheme()
  const router = useRouter()
  return (
    <View style={[styles.quickRow, { paddingHorizontal: t.layout.screenPadding }]}>
      <QuickLink icon="history" label="Activity" onPress={() => router.push('/activity' as any)} />
      <QuickLink icon="bookmark" label="Saved" onPress={() => router.push('/saved' as any)} />
      <QuickLink icon="heart" label="Liked" onPress={() => router.push('/liked' as any)} />
    </View>
  )
}

function QuickLink({ icon, label, onPress }: { icon: any; label: string; onPress: () => void }) {
  const t = useTheme()
  const c = t.colors
  return (
    <Touchable
      onPress={onPress}
      feedback="dim"
      haptic="light"
      noAutoHitSlop
      accessibilityLabel={label}
      style={[styles.quickLink, { backgroundColor: c.accentSoft, borderRadius: t.radius.md }]}
    >
      <Icon name={icon} size={18} color={c.accentText} />
      <Text variant="caption" tone="accent" align="center" numberOfLines={1}>{label}</Text>
    </Touchable>
  )
}

function Fact({ icon, text }: { icon: any; text: string }) {
  const t = useTheme()
  return (
    <View style={styles.fact}>
      <Icon name={icon} size={13} color={t.colors.textMuted} />
      <Text variant="subhead" tone="muted" numberOfLines={1}>{text}</Text>
    </View>
  )
}

/* @handles, #tags and bare links in the bio are DOORS, not decoration — the
   same three spans every body renderer opens (lib/richtext), inlined here
   because the bio must also CLAMP to four lines, which the block renderer
   cannot do across blocks. A span's own press wins over the outer expand
   Touchable for exactly its run. Mention charset mirrors richtext's
   MENTION_RE. */
const BIO_TOKEN = /(@[a-zA-Z0-9_.]{2,50})|(#[\p{L}\p{N}_]{2,64})|(https?:\/\/\S+)/gu

function BioText({ bio, open }: { bio: string; open: boolean }) {
  const router = useRouter()
  const parts = React.useMemo(() => {
    const out: { text: string; kind: 'plain' | 'mention' | 'tag' | 'link' }[] = []
    let last = 0
    for (const m of bio.matchAll(BIO_TOKEN)) {
      const i = m.index ?? 0
      if (i > last) out.push({ text: bio.slice(last, i), kind: 'plain' })
      out.push({ text: m[0], kind: m[1] ? 'mention' : m[2] ? 'tag' : 'link' })
      last = i + m[0].length
    }
    if (last < bio.length) out.push({ text: bio.slice(last), kind: 'plain' })
    return out
  }, [bio])

  return (
    <Text variant="body" align="auto" numberOfLines={open ? undefined : 4}>
      {parts.map((p, i) => (p.kind === 'plain' ? (
        <Text key={i} variant="body">{p.text}</Text>
      ) : (
        <Text
          key={i}
          variant="body"
          tone="accent"
          onPress={() => {
            if (p.kind === 'mention') router.push(`/u/${p.text.slice(1)}`)
            else if (p.kind === 'tag') router.push(`/tags/${p.text.slice(1)}`)
            else void WebBrowser.openBrowserAsync(normalizeUrl(p.text))
          }}
        >
          {p.text}
        </Text>
      )))}
    </Text>
  )
}

function normalizeUrl(u: string) {
  return /^https?:\/\//i.test(u) ? u : `https://${u}`
}
function prettyUrl(u: string) {
  return String(u).replace(/^https?:\/\//i, '').replace(/\/$/, '')
}

/* ---------------------------------------------------------
   The header's own skeleton — cover block, avatar circle, two
   text bars, a stat row. Same geometry, so nothing jumps when
   the real thing lands.
   --------------------------------------------------------- */

export function ProfileHeaderSkeleton() {
  const t = useTheme()
  return (
    <View>
      <Skeleton width="100%" height={COVER_HEIGHT} radius={0} />
      <View style={{ paddingHorizontal: t.layout.screenPadding }}>
        <View style={[styles.avatarRow, { marginTop: -OVERLAP }]}>
          <View style={[styles.ring, { backgroundColor: t.colors.bg, borderRadius: (AVATAR + 8) / 2 }]}>
            <Skeleton circle width={AVATAR} height={AVATAR} />
          </View>
          <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center' }}>
            {/* Default skeleton corners are the setback; only the icon-button
                stand-in stays round (icons are circles). */}
            <Skeleton width={116} height={36} />
            <Skeleton circle width={40} height={40} />
          </View>
        </View>
        <View style={{ marginTop: space.md, gap: space.sm }}>
          <Skeleton width="52%" height={20} />
          <Skeleton width="34%" height={13} />
          <Skeleton width="88%" height={13} />
          <Skeleton width="66%" height={13} />
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: space.lg2, paddingHorizontal: t.layout.screenPadding, marginTop: space.lg2 }}>
        {Array.from({ length: 4 }, (_, i) => (
          <View key={i} style={{ gap: space.xs2, alignItems: 'center' }}>
            <Skeleton width={34} height={16} />
            <Skeleton width={44} height={9} />
          </View>
        ))}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  avatarRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  ring: { padding: space.xs },
  actionPair: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingBottom: space.xs2 },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: space.xs2 },
  shrink: { flexShrink: 1 },
  handleLine: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  lockChip: { flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingHorizontal: space.sm, paddingVertical: space.xs, borderCurve: 'continuous' },
  factRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md2, rowGap: space.xs },
  fact: { flexDirection: 'row', alignItems: 'center', gap: space.xs2, maxWidth: '100%' },
  quickRow: { flexDirection: 'row', gap: space.sm, marginTop: space.md },
  quickLink: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.xs, paddingVertical: space.sm2, minHeight: 48 },
})
