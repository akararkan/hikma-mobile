/* =========================================================
   AuthorRow — avatar + name + trust marks + '@handle · time'.

   Every surface that attributes content uses this one row:
   feed cards, the post detail, comments, share activity, PYMK.
   Keeping it in one place is what stops the verified check from
   being 14pt on one screen and 12pt on the next.
   ========================================================= */
import React from 'react'
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { Avatar, Icon, Text, Touchable, VerifiedMark, type IconName } from '@/ui'
import type { FeedAuthor } from '@/components/feed/types'

export interface AuthorRowProps {
  /** The adapter's `_author`. A channel row passes null and supplies `title`. */
  author?: FeedAuthor | null
  /** Relative time from the adapter ('4h'). */
  time?: string | null
  size?: number
  /** Overrides the name line — channel cards sign with the channel's title. */
  title?: string
  /** Overrides the '@handle · time' line entirely. */
  subtitle?: string
  /** PUBLIC | FOLLOWERS | PRIVATE — closes the meta line with the web's
   *  visibility mark. Only post surfaces pass it. */
  visibility?: string | null
  /** Channels and groups are rounded squares; people are circles. */
  square?: boolean
  /** Rendered at the end of the row: a Follow pill, a '⋯', a chip. */
  trailing?: React.ReactNode
  onPress?: () => void
  /** Renders the overflow button when set (and no `trailing` is given). */
  onMenu?: () => void
  avatarUri?: string | null
  verified?: boolean
  style?: StyleProp<ViewStyle>
}

/** Elevated roles get a word; a plain member gets nothing, which is the point. */
function roleLabel(role: string | undefined): string | null {
  const r = String(role || '').toUpperCase()
  if (r === 'SCHOLAR') return 'Scholar'
  if (r === 'RESEARCHER') return 'Researcher'
  return null
}

/** The web's .pc-vis glyphs — globe / followers / lock. */
function visibilityIcon(v: string | null | undefined): IconName | null {
  const s = String(v || '').toUpperCase()
  if (!s) return null
  if (s === 'PUBLIC') return 'globe'
  if (s === 'FOLLOWERS') return 'people'
  return 'lock'
}

export function AuthorRow({
  author, time, size = 40, title, subtitle, visibility, square, trailing,
  onPress, onMenu, avatarUri, verified, style,
}: AuthorRowProps) {
  const t = useTheme()
  const c = t.colors
  const name = title ?? author?.full ?? 'Member'
  /* A deleted account has no profile to open — `GET /users/{id}` filters on
     `deletedAt IS NULL` and answers 404 — so the byline stops being a link
     rather than sending the reader to a dead end. The adapter has already
     blanked the handle and the avatar (adapters.js §authorFrom); this is the
     half only the renderer can do. */
  const gone = !!author?.deleted
  const open = gone ? undefined : onPress
  const isVerified = gone ? false : (verified ?? !!author?.verified)
  const role = gone ? null : roleLabel(author?.role)
  const handle = author?.handle ? `@${author.handle}` : null
  const visIcon = subtitle == null ? visibilityIcon(visibility) : null

  return (
    <View style={[styles.row, { gap: space.sm2 }, style]}>
      <Avatar
        uri={gone ? null : (avatarUri ?? author?.profileImage)}
        name={name}
        seed={author?.id}
        size={size}
        square={square}
        onPress={open}
        accessibilityLabel={gone ? name : `${name}'s profile`}
      />

      <Touchable
        onPress={open}
        disabled={!open}
        feedback={open ? 'dim' : 'none'}
        noAutoHitSlop
        style={styles.flex}
      >
        <View style={styles.nameLine}>
          {/* The web's .pc-line: 14.5/600. */}
          <Text variant="callout" weight="600" numberOfLines={1} style={styles.shrink}>{name}</Text>
          {isVerified ? <VerifiedMark size={14} /> : null}
          {role ? (
            <View style={[styles.roleChip, { backgroundColor: role === 'Scholar' ? c.scholarSoft : c.accentSoft }]}>
              {/* No call-site transform: `micro` uppercases LATIN ONLY inside
                  the Text primitive, which is what protects Arabic and
                  Kurdish role labels from being mangled (DON'T #5). */}
              <Text variant="micro" color={role === 'Scholar' ? c.scholarText : c.accentText}>{role}</Text>
            </View>
          ) : null}
        </View>
        {subtitle != null ? (
          subtitle ? (
            <Text variant="caption" caps={false} tone="muted" numberOfLines={1} align="ui" style={styles.metaLine}>
              {subtitle}
            </Text>
          ) : null
        ) : handle || time || visIcon ? (
          /* The web's .pc-meta: mono handle + mono time, dotted apart, the
             visibility mark closing the line. The ledger is lowercase —
             `caps={false}` because a handle is an address, not an eyebrow. */
          <View style={[styles.metaLine, styles.metaRow]}>
            {handle ? (
              <Text variant="caption" caps={false} tone="muted" mono numberOfLines={1} style={styles.shrink}>{handle}</Text>
            ) : null}
            {handle && time ? <Text variant="caption" tone="muted">·</Text> : null}
            {time ? <Text variant="caption" caps={false} tone="muted" mono>{time}</Text> : null}
            {visIcon ? (
              <>
                {handle || time ? <Text variant="caption" tone="muted">·</Text> : null}
                <Icon name={visIcon} size={11} color={c.textMuted} />
              </>
            ) : null}
          </View>
        ) : null}
      </Touchable>

      {trailing ?? (onMenu ? (
        <Touchable
          onPress={onMenu}
          feedback="dim"
          haptic="light"
          accessibilityLabel="More options"
          hitSlop={8}
          style={styles.menu}
        >
          <Icon name="more" size={19} color={c.textMuted} />
        </Touchable>
      ) : null)}
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
  shrink: { flexShrink: 1 },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: space.xs2 },
  metaLine: { marginTop: space.xxs },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs2 },
  roleChip: { paddingHorizontal: space.xs2, paddingVertical: 1.5, borderRadius: 4 },
  menu: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
})
