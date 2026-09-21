/* =========================================================
   The Explore sound sheet.

   `hitHref` sends a SOUND hit to `/explore?sound={id}` — the
   client already emits that link, so Explore has to honour the
   param or those hits dead-end. The sheet mounts over whatever
   state is showing and hydrates from `api.sounds.get`.

   The play control is rendered and disabled rather than hidden:
   `hooks/useReelAudio` is on the not-yet-ported list (WebAudio →
   expo-audio), so there is no shared player to drive it, and a
   button that silently does nothing is worse than one that says
   why.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import { api, errorText, isNotFound } from '@/api'
import { useAsync } from '@/hooks/useAsync'
import { avatarGradient } from '@/theme/colors'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  BrickCourse, Button, Icon, NumericText, Sheet, Skeleton, Text, formatCount,
} from '@/ui'
import { href } from './pushHit'
import { formatDuration, type Sound } from './searchTypes'

export interface SoundSheetProps {
  soundId: string | null
  onClose: () => void
}

export function SoundSheet({ soundId, onClose }: SoundSheetProps) {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()

  const { data, error, loading } = useAsync<Sound>(
    () => api.sounds.get(String(soundId)) as Promise<Sound>,
    { enabled: !!soundId, deps: [soundId] },
  )
  /* The hydrated row never carries useCount — only /usage does. Fetched in
     parallel; until it lands the sheet shows the duration alone rather than
     a confident '0 posts'. One extra GET per open — the sheet is singular. */
  const usage = useAsync<{ soundId: string; useCount: number }>(
    () => api.sounds.usage(String(soundId)) as Promise<{ soundId: string; useCount: number }>,
    { enabled: !!soundId, deps: [soundId] },
  )

  /* One flat hash hue, not a gradient — `avatarGradient` already returns a
     flat pair, and QELAT keeps decorative gradients out of the language
     entirely (DESIGN.md §5). The coverless plate gets the brick course
     instead, the same fallback the profile cover uses. */
  const [coverHue] = avatarGradient(soundId ?? '')

  return (
    <Sheet visible={!!soundId} onClose={onClose} bare scrollable={false} maxHeightRatio={0.62}>
      <View style={styles.body}>
        {loading ? (
          <View style={styles.head}>
            <Skeleton width={88} height={88} radius={12} />
            <View style={{ flex: 1, gap: space.sm2 }}>
              <Skeleton width="70%" height={16} />
              <Skeleton width="45%" height={13} />
              <Skeleton width="55%" height={12} />
            </View>
          </View>
        ) : error ? (
          <Text variant="callout" tone="muted" align="center" style={{ paddingVertical: 26 }}>
            {isNotFound(error) ? 'This sound is no longer available.' : errorText(error)}
          </Text>
        ) : data ? (
          <>
            <View style={styles.head}>
              <View style={[styles.cover, { borderRadius: 12 }]}>
                {data.cover ? (
                  <Image source={{ uri: data.cover }} style={StyleSheet.absoluteFill} contentFit="cover" transition={140} />
                ) : (
                  <View style={[StyleSheet.absoluteFill, { backgroundColor: coverHue }]}>
                    <BrickCourse />
                  </View>
                )}
                <View style={[styles.playDisc, { backgroundColor: c.overlayChip }]}>
                  <Icon name="play" size={18} color={c.overlayText} filled />
                </View>
              </View>

              <View style={styles.flex}>
                <Text variant="title3" numberOfLines={2}>{data.title || 'Untitled sound'}</Text>
                <Text variant="callout" tone="muted" numberOfLines={1} style={{ marginTop: space.xxs }}>
                  {data.artist || 'Unknown artist'}
                </Text>
                <NumericText variant="footnote" tone="faint" style={{ marginTop: space.xs2 }}>
                  {formatDuration(data.durationSeconds)}
                  {/* useAsync keeps stale data across dep changes, so on a
                     reopen the row may still belong to the PREVIOUS sound —
                     only show a count the payload says is ours. */}
                  {usage.data && String(usage.data.soundId) === String(soundId)
                    ? ` · ${formatCount(usage.data.useCount)} posts`
                    : ''}
                </NumericText>
              </View>
            </View>

            <Text variant="caption" tone="faint" align="ui" style={{ marginTop: space.sm2 }}>
              Preview playback isn’t available in this build yet — open the sound page to see what people made with it.
            </Text>

            <Button
              label="Use this sound"
              icon="music"
              size="lg"
              block
              style={{ marginTop: space.lg }}
              onPress={() => {
                onClose()
                /* Route params carry strings only, so the composer re-reads the
                   sound by id rather than being handed the object. The REEL
                   composer is the one that hydrates `soundId` from the route —
                   the generic /compose reads no sound param at all — and it is
                   the same target every other sound surface pushes. */
                router.push(href({ pathname: '/reels/compose', params: { soundId: data.id } }))
              }}
            />
            <Button
              label="Open sound page"
              variant="secondary"
              size="lg"
              block
              style={{ marginTop: space.sm2 }}
              onPress={() => { onClose(); router.push(href(`/sounds/${data.id}`)) }}
            />
          </>
        ) : null}
      </View>
    </Sheet>
  )
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: space.xl, paddingTop: space.xs2, paddingBottom: space.sm2 },
  head: { flexDirection: 'row', gap: space.md2, alignItems: 'center' },
  cover: { width: 88, height: 88, overflow: 'hidden' },
  playDisc: {
    position: 'absolute', top: 30, left: 30, width: 28, height: 28,
    borderRadius: 14, alignItems: 'center', justifyContent: 'center',
  },
  flex: { flex: 1 },
})
