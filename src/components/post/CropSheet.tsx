/* =========================================================
   CropSheet — pan/pinch crop before upload.

   Direct manipulation, not handles: the WINDOW is the crop
   (pick an aspect, move the picture under it), which is the
   whole of what a phone composer needs and nothing a thumb
   cannot do. The output is a NEW cached file from
   expo-image-manipulator; the pristine uri is kept by the
   caller, so Cancel costs nothing and a second edit crops the
   ORIGINAL again instead of the crop.

   All crop maths run on the SETTLED shared values at
   Done-press — nothing here needs a worklet round trip. The
   stage sits on the opaque overlay ground (the media-viewer
   arrangement); chips are the sanctioned 8pt rectangles.
   ========================================================= */
import React from 'react'
import { Image as RNImage, Modal, StyleSheet, View, useWindowDimensions } from 'react-native'
import { Image } from 'expo-image'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated'
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { errorText } from '@/api'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { withAlpha } from '@/theme/colors'
import { Button, Chip, Spinner, Text, Touchable, toast } from '@/ui'

export interface CropResult { uri: string; width: number; height: number }

type AspectKey = 'original' | 'square' | 'portrait' | 'wide'
const ASPECTS: { key: AspectKey; label: string; ratio: number | null }[] = [
  { key: 'original', label: 'Original', ratio: null },
  { key: 'square', label: '1:1', ratio: 1 },
  { key: 'portrait', label: '4:5', ratio: 4 / 5 },
  { key: 'wide', label: '16:9', ratio: 16 / 9 },
]

export function CropSheet({
  visible, uri, onClose, onDone,
}: {
  visible: boolean
  uri: string | null
  onClose: () => void
  onDone: (result: CropResult) => void
}) {
  const t = useTheme()
  const c = t.colors
  const { width: winW, height: winH } = useWindowDimensions()
  const insets = useSafeAreaInsets()

  const [dims, setDims] = React.useState<{ w: number; h: number } | null>(null)
  const [aspect, setAspect] = React.useState<AspectKey>('original')
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    if (!visible || !uri) return
    setDims(null)
    setAspect('original')
    RNImage.getSize(
      uri,
      (w, h) => setDims({ w, h }),
      () => { toast.error('Could not read this image.'); onClose() },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, uri])

  const ratio = aspect === 'original'
    ? (dims ? dims.w / dims.h : 1)
    : (ASPECTS.find(a => a.key === aspect)!.ratio as number)

  /* The window: as large as the stage allows at the chosen aspect. */
  const maxW = winW - 32
  const maxH = winH * 0.55
  const boxW = Math.min(maxW, maxH * ratio)
  const boxH = boxW / ratio
  /* Cover scale — the image can never show a gap inside the window. */
  const s0 = dims ? Math.max(boxW / dims.w, boxH / dims.h) : 1

  const scale = useSharedValue(1)
  const savedScale = useSharedValue(1)
  const tx = useSharedValue(0)
  const ty = useSharedValue(0)
  const savedX = useSharedValue(0)
  const savedY = useSharedValue(0)

  /* Every aspect change (and every open) starts from the honest fit. */
  React.useEffect(() => {
    scale.value = 1; savedScale.value = 1
    tx.value = 0; ty.value = 0; savedX.value = 0; savedY.value = 0
  }, [visible, aspect, dims, scale, savedScale, tx, ty, savedX, savedY])

  const imgW = dims ? dims.w * s0 : 0
  const imgH = dims ? dims.h * s0 : 0

  const pinch = Gesture.Pinch()
    .onUpdate(e => { scale.value = Math.max(1, Math.min(4, savedScale.value * e.scale)) })
    .onEnd(() => {
      savedScale.value = scale.value
      /* Re-clamp the pan for the new zoom so no gap is left showing. */
      const maxX = Math.max(0, (imgW * scale.value - boxW) / 2)
      const maxY = Math.max(0, (imgH * scale.value - boxH) / 2)
      tx.value = withSpring(Math.max(-maxX, Math.min(maxX, tx.value)), t.motion.spring)
      ty.value = withSpring(Math.max(-maxY, Math.min(maxY, ty.value)), t.motion.spring)
      savedX.value = Math.max(-maxX, Math.min(maxX, tx.value))
      savedY.value = Math.max(-maxY, Math.min(maxY, ty.value))
    })

  const pan = Gesture.Pan()
    .onUpdate(e => {
      const maxX = Math.max(0, (imgW * scale.value - boxW) / 2)
      const maxY = Math.max(0, (imgH * scale.value - boxH) / 2)
      tx.value = Math.max(-maxX, Math.min(maxX, savedX.value + e.translationX))
      ty.value = Math.max(-maxY, Math.min(maxY, savedY.value + e.translationY))
    })
    .onEnd(() => { savedX.value = tx.value; savedY.value = ty.value })

  const gesture = Gesture.Simultaneous(pinch, pan)

  const anim = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }))

  const doCrop = React.useCallback(async () => {
    if (!uri || !dims || busy) return
    setBusy(true)
    try {
      /* Settled shared values read synchronously — the box center maps to
         image coordinates through the display scale. */
      const S = s0 * scale.value
      const cropW = Math.min(dims.w, boxW / S)
      const cropH = Math.min(dims.h, boxH / S)
      const cx = dims.w / 2 - tx.value / S
      const cy = dims.h / 2 - ty.value / S
      const originX = Math.max(0, Math.min(dims.w - cropW, cx - cropW / 2))
      const originY = Math.max(0, Math.min(dims.h - cropH, cy - cropH / 2))

      const ctx = ImageManipulator.manipulate(uri)
      ctx.crop({
        originX: Math.round(originX),
        originY: Math.round(originY),
        width: Math.max(1, Math.round(cropW)),
        height: Math.max(1, Math.round(cropH)),
      })
      const img = await ctx.renderAsync()
      const out = await img.saveAsync({ format: SaveFormat.JPEG, compress: 0.92 })
      onDone({ uri: out.uri, width: out.width, height: out.height })
    } catch (e) {
      toast.error(errorText(e))
    } finally {
      setBusy(false)
    }
  }, [uri, dims, busy, s0, boxW, boxH, scale, tx, ty, onDone])

  if (!visible || !uri) return null

  /* The one genuinely opaque surface — the media-viewer arrangement. */
  const stage = withAlpha(c.overlayBg, 1)

  return (
    <Modal visible transparent={false} animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={[styles.root, { backgroundColor: stage, paddingTop: insets.top + 8, paddingBottom: insets.bottom + 12 }]}>
        <View style={styles.header}>
          <Button label="Cancel" variant="ghost" size="sm" onPress={onClose} disabled={busy} />
          <Text variant="headline" color={c.overlayText}>Crop</Text>
          <Button label="Done" size="sm" onPress={() => { void doCrop() }} loading={busy} />
        </View>

        <View style={styles.stage}>
          {dims ? (
            <GestureDetector gesture={gesture}>
              <View style={[styles.window, { width: boxW, height: boxH, borderColor: c.overlayTextMuted }]} collapsable={false}>
                <Animated.View style={anim}>
                  <Image
                    source={{ uri }}
                    style={{ width: imgW, height: imgH }}
                    contentFit="cover"
                    cachePolicy="memory-disk"
                  />
                </Animated.View>
              </View>
            </GestureDetector>
          ) : (
            <Spinner color={c.overlayText} />
          )}
        </View>

        <View style={styles.aspects}>
          {ASPECTS.map(a => (
            <Chip
              key={a.key}
              label={a.label}
              selected={aspect === a.key}
              onPress={() => setAspect(a.key)}
              size="sm"
            />
          ))}
        </View>
        <Text variant="caption" color={c.overlayTextMuted} align="center">
          Pinch to zoom, drag to frame
        </Text>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: space.md,
  },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  window: {
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  aspects: { flexDirection: 'row', justifyContent: 'center', gap: space.sm, paddingVertical: space.md },
})
