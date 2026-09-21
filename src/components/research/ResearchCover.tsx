/* =========================================================
   ResearchCover — the only thing in the app allowed to read
   `card.cover`.

   The adapter sets that field to a web CSS background
   shorthand (`center/cover no-repeat url("…")`, or a
   radial-gradient when there is no cover) because the web
   client dropped it straight into a style attribute. React
   Native cannot render either, so the URI comes out with a
   regex and everything else falls back to a tinted plate
   carrying the paper's IRC identifier — which is a better
   empty state than a grey rectangle anyway: the id is the one
   thing every paper has.
   ========================================================= */
import React from 'react'
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import { Image } from 'expo-image'
import { LinearGradient } from 'expo-linear-gradient'
import { useTheme } from '@/theme/ThemeProvider'
import { withAlpha } from '@/theme/colors'
import { Icon, Text } from '@/ui'

const URL_IN_CSS = /url\("([^"]+)"\)/

export function coverUri(cover: string | null | undefined): string | null {
  if (!cover) return null
  const m = URL_IN_CSS.exec(cover)
  return m ? m[1] : null
}

export interface ResearchCoverProps {
  cover?: string | null
  /** Bypasses the CSS string — mediaFiles rows carry a plain URI. */
  uri?: string | null
  irc?: string
  ratio?: number
  radius?: number
  /** Darken the bottom third so overlaid chrome stays legible. */
  scrim?: boolean
  style?: StyleProp<ViewStyle>
  children?: React.ReactNode
}

function ResearchCoverBase({
  cover, uri, irc, ratio = 16 / 9, radius, scrim = false, style, children,
}: ResearchCoverProps) {
  const t = useTheme()
  const c = t.colors
  const src = uri ?? coverUri(cover)

  /* `failed` is useState, and FlashList hands a recycled row's mounted
     instance to the NEXT paper — so a plate that failed once would stay
     fallen back forever. Reset in the render phase when the source moves
     (the same idiom PostMedia uses), not in an effect: an effect paints the
     wrong plate for one frame. */
  const [failed, setFailed] = React.useState<string | null>(null)
  const [seenSrc, setSeenSrc] = React.useState(src)
  if (seenSrc !== src) { setSeenSrc(src); setFailed(null) }
  const broke = failed !== null && failed === src

  return (
    <View
      style={[
        {
          aspectRatio: ratio,
          borderRadius: radius ?? t.radius.md,
          overflow: 'hidden',
          backgroundColor: c.surfaceSunken,
        },
        style,
      ]}
    >
      {src && !broke ? (
        <Image
          source={{ uri: src }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          /* The square variant is the dashboard's 56pt thumb: on a recycled
             row a cross-fade nobody sees completed is pure churn, so only the
             large plates keep it. */
          transition={ratio === 1 ? 0 : 160}
          cachePolicy="memory-disk"
          recyclingKey={src}
          onError={() => setFailed(src)}
        />
      ) : (
        <LinearGradient
          colors={[withAlpha(c.accent, 0.26), withAlpha(c.scholar, 0.14), c.surfaceSunken]}
          start={{ x: 0.25, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[StyleSheet.absoluteFill, styles.center]}
        >
          {irc ? (
            <Text
              variant="caption"
              color={withAlpha(c.text, 0.28)}
              align="center"
              numberOfLines={1}
              mono
              style={{ letterSpacing: 1.2 }}
            >
              {irc}
            </Text>
          ) : (
            <Icon name="research" size={26} color={withAlpha(c.text, 0.22)} />
          )}
        </LinearGradient>
      )}

      {scrim ? (
        <LinearGradient
          colors={['transparent', withAlpha(c.overlayBg, 0.75)]}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
      ) : null}

      {children}
    </View>
  )
}

/* Memoized because every research list row mounts one: with the card's own
   memo above it, a parent render that moved nothing stops at the card, and a
   card render that moved only its metrics stops here. */
export const ResearchCover = React.memo(ResearchCoverBase)

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
})
