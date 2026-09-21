/* =========================================================
   The creative stage's tools and trays — shared.

   These were born inside the reel editor and are now worn by
   the story composer too, because the two screens are the same
   act: somebody's media on a black stage, text and stickers
   laid over it, a docked tray to edit what is selected. Two
   copies of that would have drifted within a week — a font
   added here, a colour there — and an author who learns the
   reel editor would then have to learn the story one.

   THE TRAY IS THE SAFE-AREA FIX. A bare TextInput floated over
   a full-bleed stage is the single worst pattern on a phone:
   Android is edge-to-edge, so it sits under the gesture bar,
   and when the keyboard opens it goes under that too. Every
   tray here docks to the bottom through a KeyboardAvoidingView
   and pays `insets.bottom` itself, which is the whole contract
   in DESIGN.md §8.

   `showMotion` exists because motion is not always
   survivable: a reel's overlay travels as data and animates at
   playback, while a story's is flattened into pixels at
   publish. Offering a wiggle that cannot be kept would be a
   promise the composer breaks silently.
   ========================================================= */
import React from 'react'
import { ScrollView, StyleSheet, TextInput, View, useWindowDimensions } from 'react-native'
import Animated, { FadeIn, FadeOut, SlideInDown, SlideOutDown } from 'react-native-reanimated'
import { KeyboardAvoidingView } from 'react-native-keyboard-controller'
import { useComposerInsets } from '@/components/reels/ComposerChrome'
import type { OverlayItem } from '@/components/reels/ReelOverlayLayer'
import { overlayFaceStyle, overlayPlateStyle } from '@/components/reels/ReelOverlayLayer'
import { STAGE, TEXT_SHADOW_STRONG } from '@/components/reels/skin'
import { ALIGNS, COLORS, FONTS, MAX_TEXT, MOTIONS, colorIsDark } from '@/lib/reelOverlay'
import { useTheme } from '@/theme/ThemeProvider'
import { setback, shape, space } from '@/theme/tokens'
import { Chip, Icon, Text, Touchable, type IconName } from '@/ui'

/* Six unlabelled discs on top of somebody's face is a puzzle, not a toolbar —
   and the one thing an author needs on this screen is to know what each of
   them does before tapping it. The label carries the strong stage shadow
   because the rail's upper half sits over the clip, not over a scrim. */
export function Tool({
  icon, label, active, disabled, onPress,
}: { icon: IconName; label: string; active?: boolean; disabled?: boolean; onPress: () => void }) {
  return (
    <Touchable
      onPress={onPress}
      feedback="scale"
      noAutoHitSlop
      accessibilityLabel={label}
      style={[styles.toolWrap, disabled ? styles.toolOff : null]}
    >
      <View style={[styles.tool, active ? styles.toolActive : null]}>
        {/* FULL white, resting and active alike. These discs float over a live
            frame that can be a sunset sky, and 72% white inside a 32% black
            plate measured barely 2:1 against one — the state is carried by the
            plate and the filled glyph, never by dimming the ink. */}
        <Icon name={icon} size={19} color={STAGE.fg} filled={active} />
      </View>
      <Text
        variant="micro"
        color={STAGE.fg}
        align="center"
        numberOfLines={1}
        style={styles.toolLabel}
      >
        {label}
      </Text>
    </Touchable>
  )
}

export function TrayPanel({
  title, height, onClose, children,
}: { title: string; height: number; onClose: () => void; children: React.ReactNode }) {
  const t = useTheme()
  const insets = useComposerInsets()
  /* The tray ARRIVES rather than teleports — the backdrop breathes in and the
     sheet rides up from the dock, the same grammar as ui/Sheet. Reduced
     motion keeps the clean cut these mounts always had. */
  const anim = !t.prefs.reducedMotion
  return (
    <View style={StyleSheet.absoluteFill}>
      <Animated.View
        style={StyleSheet.absoluteFill}
        entering={anim ? FadeIn.duration(150) : undefined}
        exiting={anim ? FadeOut.duration(120) : undefined}
      >
        <Touchable onPress={onClose} feedback="none" noAutoHitSlop accessibilityLabel="Close" style={styles.trayBackdrop}>
          <View />
        </Touchable>
      </Animated.View>
      {/* The text tray AUTOFOCUSES an input, and this window does not resize
          (edge-to-edge on Android, a stage screen on iOS) — so without the
          avoider the keyboard opens straight over the thing it was opened to
          type into, and over every control under it. `padding` lifts the dock;
          `maxHeight` rather than a fixed height lets the tray give the keys
          the room they need and scroll what is left. Same idiom as ui/Sheet. */}
      <KeyboardAvoidingView behavior="padding" style={StyleSheet.absoluteFill} pointerEvents="box-none">
        <View style={styles.trayDock} pointerEvents="box-none">
          <Animated.View
            entering={anim ? SlideInDown.duration(220) : undefined}
            exiting={anim ? SlideOutDown.duration(180) : undefined}
            style={[styles.tray, { maxHeight: height, paddingBottom: insets.bottom }]}
          >
            <View style={styles.trayHead}>
              <Text variant="headline" color={STAGE.fg} align="center" style={{ flex: 1 }}>{title}</Text>
              <Touchable onPress={onClose} feedback="scale" accessibilityLabel="Done" style={styles.trayClose}>
                <Text variant="subhead" weight="700" color={STAGE.fg}>Done</Text>
              </Touchable>
            </View>
            {children}
          </Animated.View>
        </View>
      </KeyboardAvoidingView>
    </View>
  )
}

/* The four one-tap sizes, in the same unit the pinch writes (a fraction of
   the media rect's width). Pinch on the stage stays the fine control; these
   are the reachable steps, and the lit chip is whichever preset the current
   size sits nearest — a pinched size still reads as "about L". */
const SIZES: { label: string; s: number }[] = [
  { label: 'S', s: 0.05 },
  { label: 'M', s: 0.085 },
  { label: 'L', s: 0.13 },
  { label: 'XL', s: 0.2 },
]

/* The plate modes, in table order of `bg`. */
const BG_MODES: { label: string; bg: 0 | 1 | 2 }[] = [
  { label: 'Plain', bg: 0 },
  { label: 'Plate', bg: 1 },
  { label: 'Wash', bg: 2 },
]

/** A font choice that SHOWS the font: the label is set in its own face, which
 *  is the entire difference between picking a typeface and picking a word.
 *  Exported — the story composer's TEXT stage wears the same chip. */
export function FontChip({ slot, selected, onPress }: { slot: number; selected: boolean; onPress: () => void }) {
  const f: any = FONTS[slot]
  return (
    <Touchable
      onPress={onPress}
      feedback="scale"
      noAutoHitSlop
      accessibilityLabel={`Font ${f.label}`}
      accessibilityState={{ selected }}
      style={[styles.fontChip, selected ? styles.fontChipOn : null]}
    >
      <Text
        variant="subhead"
        color={STAGE.fg}
        numberOfLines={1}
        style={overlayFaceStyle({ f: slot, text: f.label })}
      >
        {f.label}
      </Text>
    </Touchable>
  )
}

export function TextTray({
  item, onChange, onClose, reduceMotion, showMotion = true, title = 'Text',
}: {
  item: OverlayItem | undefined
  onChange: (next: Partial<OverlayItem>) => void
  onClose: () => void
  reduceMotion: boolean
  /** A story flattens its overlay into pixels, so it has no motion to offer. */
  showMotion?: boolean
  title?: string
}) {
  const t = useTheme()
  const { height } = useWindowDimensions()
  if (!item) return null

  /* WHAT YOU TYPE IS WHAT LANDS. The preview draws through the SAME two
     helpers the viewer layer and the editor stage use (ReelOverlayLayer), so
     picking a face, a colour or a plate changes the field exactly as it will
     change the frame — the preview cannot drift from the render. */
  const align = item.a === 1 ? 'center' : item.a === 2
    ? (t.isRTL ? 'left' : 'right')
    : (t.isRTL ? 'right' : 'left')
  const plate = overlayPlateStyle(item, 26)
  /* Navy ink with no plate is invisible on the tray's dark sheet — the STAGE
     behind it may be a bright sky. The faint wash is tray furniture, not part
     of the item: it never leaves this field. */
  const inkAid = !item.bg && colorIsDark(COLORS[item.c] ?? COLORS[0])
  const nearestSize = SIZES.reduce(
    (best, cand, i) => (Math.abs(cand.s - item.s) < Math.abs(SIZES[best].s - item.s) ? i : best),
    0,
  )

  return (
    <TrayPanel title={title} height={height * 0.62} onClose={onClose}>
      {/* flexShrink, because RN defaults it to 0: inside a maxHeight tray the
          scroller would otherwise keep its full content height and spill its
          last rows off the bottom of the screen instead of scrolling them. */}
      <ScrollView style={styles.trayScroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <TextInput
          value={item.text}
          /* Hard stop at MAX_TEXT: cleanItem would truncate silently, and text
             that vanishes on save is worse than a counter that stops. */
          onChangeText={v => onChange({ text: v.slice(0, MAX_TEXT) })}
          placeholder="Type something"
          placeholderTextColor={STAGE.fgFaint}
          selectionColor={t.colors.cta}
          multiline
          autoFocus
          style={[
            styles.textInput,
            {
              color: COLORS[item.c] ?? COLORS[0],
              textAlign: align,
            },
            overlayFaceStyle(item),
            plate ? [styles.textInputPill, plate] : null,
            inkAid ? styles.inkAid : null,
          ]}
        />
        <Text variant="caption" color={STAGE.fgFaint} align="center">{item.text.length}/{MAX_TEXT}</Text>

        {/* Faces — every loaded family, each label set in itself. */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.fontRow}>
          {FONTS.map((f: any, i: number) => (
            <FontChip key={f.id} slot={i} selected={item.f === i} onPress={() => onChange({ f: i })} />
          ))}
        </ScrollView>

        {/* Size steps and alignment share a row — both are "where and how big". */}
        <View style={styles.trayRow}>
          {SIZES.map((sz, i) => (
            <Chip
              key={sz.label}
              label={sz.label}
              selected={nearestSize === i}
              onPress={() => onChange({ s: sz.s })}
              size="sm"
            />
          ))}
          <View style={styles.spacer} />
          {ALIGNS.map((a: string, i: number) => (
            <Chip
              key={a}
              label={a === 'start' ? 'L' : a === 'center' ? 'C' : 'R'}
              selected={item.a === i}
              onPress={() => onChange({ a: i })}
              size="sm"
            />
          ))}
        </View>

        <View style={styles.swatches}>
          {COLORS.map((c: string, i: number) => (
            <Touchable
              key={c}
              onPress={() => onChange({ c: i })}
              feedback="scale"
              noAutoHitSlop
              accessibilityLabel={`Colour ${i + 1}`}
              /* The faint resting ring is what keeps the white and the navy
                 swatch visible against the dark sheet; selection brightens it
                 to full. */
              style={[
                styles.swatch,
                { backgroundColor: c, borderColor: item.c === i ? STAGE.fg : STAGE.hairline },
              ]}
            />
          ))}
        </View>

        <View style={styles.trayRow}>
          {BG_MODES.map(mode => (
            <Chip
              key={mode.label}
              label={mode.label}
              selected={item.bg === mode.bg}
              onPress={() => onChange({ bg: mode.bg })}
              size="sm"
            />
          ))}
        </View>

        <Text variant="caption" color={STAGE.fgFaint} align="ui" style={styles.gestureHint}>
          On the stage: drag to move, pinch to resize, twist to rotate, drag down to delete.
        </Text>

        {showMotion ? (
          <>
            {reduceMotion ? (
              <Text variant="caption" color={STAGE.fgFaint} align="ui" style={styles.motionNote}>
                Motion is off in your accessibility settings — these preview as a single frame.
              </Text>
            ) : null}

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.motionRow}>
              {MOTIONS.map((m: any, i: number) => (
                <Chip key={m.id} label={m.label} selected={item.m === i} onPress={() => onChange({ m: i })} size="sm" />
              ))}
            </ScrollView>
          </>
        ) : null}
      </ScrollView>
    </TrayPanel>
  )
}

export function GlyphTray({
  title, columns, entries, onPick, onClose,
}: {
  title: string
  columns: number
  entries: { glyph: string; label: string; motion: number }[]
  onPick: (e: { glyph: string; label: string; motion: number }) => void
  onClose: () => void
}) {
  const { height, width } = useWindowDimensions()
  const cell = Math.floor((width - 32) / columns)
  return (
    <TrayPanel title={title} height={height * 0.5} onClose={onClose}>
      <ScrollView style={styles.trayScroll} contentContainerStyle={styles.glyphGrid} showsVerticalScrollIndicator={false}>
        {entries.map((e, i) => (
          <Touchable
            key={`${e.glyph}-${i}`}
            onPress={() => onPick(e)}
            feedback="scale"
            noAutoHitSlop
            accessibilityLabel={e.label}
            style={[styles.glyphCell, { width: cell }]}
          >
            <Text variant="title1" align="center" color={STAGE.fg} style={styles.glyph}>{e.glyph}</Text>
            {columns <= 4 ? (
              <Text variant="micro" color={STAGE.fgFaint} align="center" numberOfLines={1}>{e.label}</Text>
            ) : null}
          </Touchable>
        ))}
      </ScrollView>
    </TrayPanel>
  )
}
const styles = StyleSheet.create({
  /* Wide enough for the longest label at this tracking (STICKERS), clipped
     rather than trusted: a label that bleeds past the wrap runs off the screen
     edge instead of ellipsing. */
  toolWrap: { width: 72, alignItems: 'center', gap: space.xs, overflow: 'hidden' },
  tool: {
    width: 44,
    height: 44,
    borderRadius: 22,
    /* glassStrong, not glass: the rail's whole job is to stay readable over a
       frame the author chose, and half of those frames are bright. */
    backgroundColor: STAGE.glassStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /* An attached sound, a recorded voiceover, an open poll — a STATE, and a
     filled glyph alone is too quiet to read against a moving clip. */
  toolActive: {
    backgroundColor: STAGE.glassStrong,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: STAGE.hairline,
  },
  toolLabel: { letterSpacing: 0.2, ...TEXT_SHADOW_STRONG },
  toolOff: { opacity: 0.4 },
  trayBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  /* The tray is docked by the layout, not by absolute coordinates — that is
     what lets the keyboard avoider move it. */
  trayDock: { flex: 1, justifyContent: 'flex-end' },
  tray: {
    backgroundColor: STAGE.sheet,
    borderTopLeftRadius: shape.sheet.top,
    borderTopRightRadius: shape.sheet.top,
    borderCurve: 'continuous',
    paddingHorizontal: space.lg,
  },
  trayScroll: { flexShrink: 1 },
  trayHead: { flexDirection: 'row', alignItems: 'center', height: 48 },
  trayClose: { paddingHorizontal: space.sm2, height: 44, justifyContent: 'center' },
  textInput: {
    minHeight: 70,
    maxHeight: 130,
    fontSize: 26,
    lineHeight: 32,
    paddingVertical: space.sm,
  },
  /* The plate hugs the words on the stage, so it hugs them here too rather
     than washing the whole field; colour/padding/radius come from the shared
     overlayPlateStyle so the preview matches the frame. */
  textInputPill: {
    alignSelf: 'center',
    minWidth: 120,
    borderCurve: 'continuous',
  },
  /* Tray furniture only (see `inkAid` above): a whisper of light behind dark
     ink so navy is pickable on the dark sheet. Never rendered on the stage. */
  inkAid: {
    alignSelf: 'center',
    minWidth: 120,
    paddingHorizontal: space.md2,
    borderRadius: 12,
    borderCurve: 'continuous',
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  fontRow: { gap: space.sm, paddingVertical: space.md, paddingEnd: space.lg },
  fontChip: {
    height: 34,
    paddingHorizontal: space.md2,
    borderRadius: 17,
    backgroundColor: STAGE.glassStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fontChipOn: { borderWidth: 1, borderColor: STAGE.fg },
  gestureHint: { paddingBottom: space.md },
  trayRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.md, flexWrap: 'wrap' },
  spacer: { flex: 1 },
  swatches: { flexDirection: 'row', gap: space.sm2, paddingBottom: space.xs2, flexWrap: 'wrap' },
  swatch: { width: 28, height: 28, borderRadius: 14, borderWidth: 2 },
  motionRow: { gap: space.sm, paddingVertical: space.md, paddingEnd: space.lg },
  motionNote: { paddingTop: space.sm2 },
  glyphGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingBottom: space.xl },
  glyphCell: { alignItems: 'center', paddingVertical: space.sm2, gap: space.xxs },
  glyph: { fontSize: 34, lineHeight: 42 },
  captionInput: { minHeight: 64, maxHeight: 150, fontSize: 17, lineHeight: 24, paddingVertical: space.sm },
  captionNote: { paddingTop: space.sm2, paddingBottom: space.xl },
})

/* A tray whose only job is a caption. It is the same dock as the text tray —
   which is the point: the caption used to be a naked TextInput floating over
   the stage at a hand-computed `bottom`, so on Android it sat under the
   gesture bar and the keyboard opened straight over it. */
export function CaptionTray({
  value, onChange, onClose, max = 600, placeholder = 'Add a caption…',
}: {
  value: string
  onChange: (v: string) => void
  onClose: () => void
  max?: number
  placeholder?: string
}) {
  const t = useTheme()
  const { height } = useWindowDimensions()
  return (
    <TrayPanel title="Caption" height={height * 0.5} onClose={onClose}>
      <ScrollView style={styles.trayScroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <TextInput
          value={value}
          onChangeText={v => onChange(v.slice(0, max))}
          placeholder={placeholder}
          placeholderTextColor={STAGE.fgFaint}
          selectionColor={t.colors.cta}
          multiline
          autoFocus
          style={[styles.captionInput, { color: STAGE.fg }]}
        />
        <Text variant="caption" color={STAGE.fgFaint} align="ui">{value.length}/{max}</Text>
        <Text variant="caption" color={STAGE.fgFaint} align="ui" style={styles.captionNote}>
          The caption travels with the story and is read out by search — the
          words you place ON the frame are part of the picture.
        </Text>
      </ScrollView>
    </TrayPanel>
  )
}
