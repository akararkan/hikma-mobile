/* =========================================================
   Avatar — the most-rendered component in the app.

   Faces are the ONE round thing in the interface (DESIGN.md
   §3): people are full circles, always; channels and groups
   (`square`) are uniformly rounded tiles because they are
   surfaces, not faces. Three jobs beyond "show a picture":

     · a deterministic fallback, hashed from the user id so an
       avatarless account looks the same on every screen and
       client: a FLAT hash-hue plate (no gradients in this
       language) with a Lora 700 initial, ink chosen by
       inkOn() per the on-plate luminance rule
     · the story ring: unseen is a 2pt steel ring (SealRing,
       a plain bordered View — list-safe); seen is stone;
       live is a 2pt liveDot ring + the LIVE pill (a
       sanctioned pill); close friends keep presence green
     · the presence dot — 8pt role hue in a 2px bg ring at
       the trailing-bottom corner, mirrored under RTL

   Sizes come from the token file, so a "md" avatar is 40pt
   everywhere. Every ring state shares one footprint (px + 16,
   the seal ring's envelope) so unseen→seen never reflows the
   row around it.
   ========================================================= */
import React from 'react'
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import { Image } from 'expo-image'
import { useTheme } from '@/theme/ThemeProvider'
import { avatarGradient, inkOn, withAlpha } from '@/theme/colors'
import { shape, space } from '@/theme/tokens'
import { assetUrl, adapters } from '@/api'
import { Text } from './Text'
import { Icon } from './Icon'
import { Touchable } from './Touchable'
import { SealRing } from './ornaments'

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'xxl' | number
export type StoryRing = 'none' | 'unseen' | 'seen' | 'close' | 'live'
export type Presence = 'online' | 'away' | 'offline' | null | undefined

export interface AvatarProps {
  uri?: string | null
  /** Drives the fallback initials. */
  name?: string | null
  /** Drives the fallback hue — pass the user id so it stays stable. */
  seed?: string | number | null
  size?: AvatarSize
  ring?: StoryRing
  presence?: Presence
  /** Setback tile — channels and groups, not people. */
  square?: boolean
  onPress?: () => void
  onLongPress?: () => void
  style?: StyleProp<ViewStyle>
  accessibilityLabel?: string
}

/* Presence is not a colour. DESIGN.md's accessibility rule — and the
   platform's — is that meaning never rides on hue alone: green and grey at
   12pt are the same dot to a red-green colour-blind reader, and to a screen
   reader they were nothing at all, because this dot carried no label.

   So each state gets a SHAPE as well as its existing colour, cut out of the
   dot with the background it already sits on. No new colours:

     online   solid disc
     away     disc with a bar cut across it
     offline  ring — a hollow centre

   And each gets a word, gathered into whatever accessible parent wraps the
   avatar (a list row's Touchable collects its children's labels), so the
   signal survives with the picture switched off. */
const PRESENCE_LABEL = { online: 'Online', away: 'Away', offline: 'Offline' } as const

/* The shared ring footprint: SealRing's envelope is face + 2pt gap +
   2pt stroke + 3pt ticks + margin = 8pt per side. Every ring state
   uses it so switching states never shifts the layout. */
const RING_SPAN = 8
/* Clear space between the face edge and any ring stroke. */
const RING_GAP = 2

export function Avatar({
  uri, name, seed, size = 'md', ring = 'none', presence, square = false,
  onPress, onLongPress, style, accessibilityLabel,
}: AvatarProps) {
  const interactive = !!onPress || !!onLongPress
  const t = useTheme()
  const c = t.colors
  const px = typeof size === 'number' ? size : t.layout.avatar[size]
  const src = uri ? assetUrl(uri) : null
  /* avatarGradient survives as the shared hash (same modulus as the web
     client) but the Oxford pairs are flat — only the first stop matters. */
  const [hue] = avatarGradient(seed ?? name ?? '')
  const ink = inkOn(hue)
  const initials = adapters.initialsOf(name || '')
  /* Keyed BY SOURCE, not a bare boolean: this component is handed to the next
     row by FlashList, and a `broken` flag would follow it there and blank a
     face that loads perfectly well. */
  const [brokenSrc, setBrokenSrc] = React.useState<string | null>(null)
  const failed = !!src && brokenSrc === src

  /* Rounded-square tiles (channels/groups) — uniform friendly corners. */
  const tileR = Math.max(6, Math.round(px * 0.22))

  const showRing = ring !== 'none'
  const outer = showRing ? px + RING_SPAN * 2 : px
  /* Drawn-border rings — every state except the circular unseen seal.
     Widths per DESIGN.md §6: seen 1.5pt, live 2pt; close friends keep
     the sacred presence green; unseen falls back to a plain accent
     ring on setback tiles (the seal impression is circular). */
  const sealRing = showRing && ring === 'unseen' && !square
  const ringStroke =
    ring === 'seen' ? { width: 1.5, color: c.storyRingSeen }
      : ring === 'live' ? { width: 2, color: c.liveDot }
        : ring === 'close' ? { width: 2, color: c.online }
          : { width: 2, color: c.storyRing }
  const ringSize = px + (RING_GAP + ringStroke.width) * 2
  const ringInset = (outer - ringSize) / 2

  const face = (
    <View
      style={[
        { width: px, height: px, overflow: 'hidden', backgroundColor: c.surfaceSunken },
        square
          ? { borderRadius: tileR, borderCurve: 'continuous' as const }
          : { borderRadius: px / 2 },
      ]}
    >
      {/* THE LETTERS ARE THE GROUND, ALWAYS — the image is what covers them.
          They used to be the `else` branch, so a face whose photo was slow,
          missing or simply 404 showed an empty grey disc with no name in it,
          which is what a whole list of seeded accounts looked like. Drawing
          them underneath costs one flat View and means there is no state in
          which a person has no mark at all. */}
      <View style={[StyleSheet.absoluteFill, styles.center, { backgroundColor: hue }]}>
        {initials && initials !== '··' ? (
          <Text
            serif
            weight="700"
            color={ink}
            align="center"
            style={{ fontSize: px * 0.38, lineHeight: px * 0.46 }}
          >
            {initials}
          </Text>
        ) : (
          <Icon name={square ? 'people' : 'person'} size={px * 0.5} color={withAlpha(ink, 0.9)} filled />
        )}
      </View>

      {src && !failed ? (
        <Image
          source={{ uri: src }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          /* Row-sized avatars live inside recycled cells, where a cross-fade
             is churn nobody ever sees complete and a second bitmap stays
             alive for its duration. The fade is kept only at the profile
             sizes (xl/xxl), where it is actually perceptible. */
          transition={px >= t.layout.avatar.xl ? 140 : 0}
          cachePolicy="memory-disk"
          recyclingKey={src}
          /* A half-loaded or transparent PNG would otherwise sit ON the
             letters; dropping the image puts them back cleanly. */
          onError={() => setBrokenSrc(src)}
        />
      ) : null}
    </View>
  )

  const body = (
    <View style={[{ width: outer, height: outer }, styles.center, style]}>
      {sealRing ? (
        /* A plain bordered View (no SVG — list-safe). Sized to the footprint
           so its 2pt stroke lands exactly 2pt outside the face. */
        <SealRing size={outer} />
      ) : showRing ? (
        <View
          pointerEvents="none"
          style={[
            styles.ringAbs,
            {
              width: ringSize,
              height: ringSize,
              top: ringInset,
              start: ringInset,
              borderWidth: ringStroke.width,
              borderColor: ringStroke.color,
            },
            square
              ? {
                  borderRadius: tileR + RING_GAP + ringStroke.width,
                  borderCurve: 'continuous' as const,
                }
              : { borderRadius: ringSize / 2 },
          ]}
        />
      ) : null}

      {face}

      {presence ? (
        <View
          /* A leaf View with a label but no text children contributes nothing
             unless it is an accessibility element. Only when this avatar is
             NOT itself the button, though: a nested element inside one is a
             second TalkBack stop for the same control, and the touchable
             folds the word into its own label instead (below). */
          accessible={!interactive}
          accessibilityLabel={PRESENCE_LABEL[presence]}
          style={[
            styles.presence,
            {
              borderColor: c.bg,
              backgroundColor: presence === 'online' ? c.online : presence === 'away' ? c.away : c.offline,
              /* Pin to the face's box corner, not the ring footprint's. */
              end: showRing ? (outer - px) / 2 : 0,
              bottom: showRing ? (outer - px) / 2 : 0,
            },
          ]}
        >
          {/* The cutout that makes the state readable without its colour. Drawn
              in `bg` — the same ink the dot's own border already uses — so this
              introduces no colour, only a shape. */}
          {presence === 'offline' ? (
            <View style={[styles.presenceHollow, { backgroundColor: c.bg }]} />
          ) : presence === 'away' ? (
            <View style={[styles.presenceBar, { backgroundColor: c.bg }]} />
          ) : null}
        </View>
      ) : null}

      {ring === 'live' ? (
        <View style={[styles.liveTag, { backgroundColor: c.liveDot, borderColor: c.bg }]}>
          {/* Pure #FFFFFF ink is sanctioned on liveDot plates only. */}
          <Text variant="micro" color="#FFFFFF" align="center">LIVE</Text>
        </View>
      ) : null}
    </View>
  )

  if (!interactive) return body
  return (
    <Touchable
      onPress={onPress}
      onLongPress={onLongPress}
      feedback="scale"
      noAutoHitSlop
      /* An explicit label on the touchable REPLACES whatever its children
         would have contributed, so the presence word has to be folded in here
         or it is lost on exactly the avatars a reader can act on. A caller's
         own `accessibilityLabel` still wins outright — it knows more than we
         do about what the button does. */
      accessibilityLabel={
        accessibilityLabel
        ?? [name ? `${name}'s profile` : 'Profile', presence ? PRESENCE_LABEL[presence] : '']
          .filter(Boolean).join(', ')
      }
    >
      {body}
    </Touchable>
  )
}

/* ---------------------------------------------------------
   AvatarStack — "12 others" rows: reactors, group members,
   live viewers. Overlaps by 40% and mirrors under RTL.
   --------------------------------------------------------- */

export interface AvatarStackProps {
  users: { id?: string | number; avatarUrl?: string | null; name?: string | null }[]
  size?: number
  max?: number
  style?: StyleProp<ViewStyle>
}

export function AvatarStack({ users, size = 24, max = 3, style }: AvatarStackProps) {
  const t = useTheme()
  const shown = users.slice(0, max)
  const overlap = size * 0.38
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center' }, style]}>
      {shown.map((u, i) => (
        <View
          key={String(u.id ?? i)}
          style={{
            marginStart: i === 0 ? 0 : -overlap,
            borderRadius: size,
            borderWidth: 1.5,
            borderColor: t.colors.bg,
            zIndex: shown.length - i,
          }}
        >
          <Avatar uri={u.avatarUrl} name={u.name} seed={u.id} size={size} />
        </View>
      ))}
      {users.length > max ? (
        <View
          style={{
            marginStart: -overlap,
            width: size,
            height: size,
            borderRadius: size,
            borderWidth: 1.5,
            borderColor: t.colors.bg,
            backgroundColor: t.colors.surfaceSunken,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text variant="micro" tone="muted" align="center">+{Math.min(99, users.length - max)}</Text>
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  ringAbs: { position: 'absolute' },
  /* 8pt role-hue dot inside a 2px bg ring (DESIGN.md §6). */
  presence: {
    position: 'absolute',
    width: 12, height: 12, borderRadius: 6, borderWidth: 2,
    alignItems: 'center', justifyContent: 'center',
  },
  /* Inside the 2pt border the dot is 8pt across, so a 4pt hole leaves a 2pt
     ring of colour — the thinnest stroke that still reads at this size. */
  presenceHollow: { width: 4, height: 4, borderRadius: 2 },
  /* Wider than the hole and thinner, so away cannot be mistaken for offline
     at a glance. */
  presenceBar: { width: 6, height: 2, borderRadius: 1 },
  /* One of the two sanctioned pills. `bottom: -1` compensates the live
     ring's 4pt inset inside the shared RING_SPAN footprint, keeping the
     pill's midline on the drawn ring. */
  liveTag: {
    position: 'absolute',
    bottom: -1,
    alignSelf: 'center',
    paddingHorizontal: space.xs2,
    paddingVertical: space.xxs,
    borderRadius: shape.pill,
    borderWidth: 2,
  },
})
