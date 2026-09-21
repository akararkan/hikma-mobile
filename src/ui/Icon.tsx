/* =========================================================
   Icon — one name per concept, not one name per icon set.

   Screens say `<Icon name="reels" />`. The mapping to a glyph
   lives here, so swapping icon sets (or moving to SF Symbols
   on iOS) is one file, and a concept can never render as two
   different glyphs on two different screens.

   Filled vs outline is a prop rather than two names because
   every tab bar needs the pair and keeping them adjacent is
   what stops them drifting apart.
   ========================================================= */
import React from 'react'
import Ionicons from '@expo/vector-icons/Ionicons'
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons'
import Feather from '@expo/vector-icons/Feather'
import { useTheme } from '@/theme/ThemeProvider'
import type { StyleProp, TextStyle } from 'react-native'

type Family = 'ion' | 'mci' | 'feather'
type Glyph = [Family, string, string?]   // [family, outline, filled?]

/* Concept → glyph. Keep alphabetical inside each block. */
const GLYPHS = {
  /* --- navigation / tabs --- */
  home: ['ion', 'home-outline', 'home'],
  explore: ['ion', 'compass-outline', 'compass'],
  search: ['ion', 'search-outline', 'search'],
  reels: ['ion', 'play-circle-outline', 'play-circle'],
  chat: ['ion', 'chatbubbles-outline', 'chatbubbles'],
  bell: ['ion', 'notifications-outline', 'notifications'],
  profile: ['ion', 'person-circle-outline', 'person-circle'],
  library: ['ion', 'library-outline', 'library'],
  research: ['ion', 'document-text-outline', 'document-text'],
  qna: ['ion', 'help-circle-outline', 'help-circle'],
  channels: ['ion', 'megaphone-outline', 'megaphone'],

  /* --- actions --- */
  add: ['ion', 'add', 'add'],
  addCircle: ['ion', 'add-circle-outline', 'add-circle'],
  back: ['ion', 'chevron-back', 'chevron-back'],
  forward: ['ion', 'chevron-forward', 'chevron-forward'],
  up: ['ion', 'chevron-up', 'chevron-up'],
  down: ['ion', 'chevron-down', 'chevron-down'],
  close: ['ion', 'close', 'close'],
  check: ['ion', 'checkmark', 'checkmark'],
  checkCircle: ['ion', 'checkmark-circle-outline', 'checkmark-circle'],
  more: ['ion', 'ellipsis-horizontal', 'ellipsis-horizontal'],
  moreVertical: ['ion', 'ellipsis-vertical', 'ellipsis-vertical'],
  edit: ['ion', 'create-outline', 'create'],
  trash: ['ion', 'trash-outline', 'trash'],
  copy: ['ion', 'copy-outline', 'copy'],
  send: ['ion', 'send', 'send'],
  refresh: ['ion', 'refresh', 'refresh'],
  filter: ['ion', 'options-outline', 'options'],
  sort: ['mci', 'sort-variant', 'sort-variant'],
  external: ['ion', 'open-outline', 'open'],
  download: ['ion', 'download-outline', 'download'],
  upload: ['ion', 'cloud-upload-outline', 'cloud-upload'],
  qr: ['ion', 'qr-code-outline', 'qr-code'],
  scan: ['ion', 'scan-outline', 'scan'],
  link: ['ion', 'link-outline', 'link'],
  minus: ['ion', 'remove', 'remove'],

  /* --- engagement --- */
  heart: ['ion', 'heart-outline', 'heart'],
  comment: ['ion', 'chatbubble-outline', 'chatbubble'],
  share: ['ion', 'paper-plane-outline', 'paper-plane'],
  bookmark: ['ion', 'bookmark-outline', 'bookmark'],
  repost: ['ion', 'repeat', 'repeat'],
  eye: ['ion', 'eye-outline', 'eye'],
  eyeOff: ['ion', 'eye-off-outline', 'eye-off'],
  cite: ['mci', 'format-quote-close', 'format-quote-close'],
  quote: ['mci', 'format-quote-open', 'format-quote-open'],
  upvote: ['ion', 'arrow-up-circle-outline', 'arrow-up-circle'],

  /* --- media --- */
  image: ['ion', 'image-outline', 'image'],
  camera: ['ion', 'camera-outline', 'camera'],
  video: ['ion', 'videocam-outline', 'videocam'],
  videoOff: ['ion', 'videocam-off-outline', 'videocam-off'],
  mic: ['ion', 'mic-outline', 'mic'],
  micOff: ['ion', 'mic-off-outline', 'mic-off'],
  play: ['ion', 'play', 'play'],
  pause: ['ion', 'pause', 'pause'],
  volume: ['ion', 'volume-high', 'volume-high'],
  mute: ['ion', 'volume-mute', 'volume-mute'],
  music: ['ion', 'musical-notes-outline', 'musical-notes'],
  attachment: ['ion', 'attach-outline', 'attach'],
  file: ['ion', 'document-outline', 'document'],
  gallery: ['ion', 'images-outline', 'images'],
  gif: ['mci', 'file-gif-box', 'file-gif-box'],
  sticker: ['mci', 'sticker-emoji', 'sticker-emoji'],
  emoji: ['ion', 'happy-outline', 'happy'],
  crop: ['ion', 'crop-outline', 'crop'],

  /* --- chat --- */
  call: ['ion', 'call-outline', 'call'],
  callEnd: ['mci', 'phone-hangup', 'phone-hangup'],
  videoCall: ['ion', 'videocam-outline', 'videocam'],
  pin: ['ion', 'pin-outline', 'pin'],
  unpin: ['mci', 'pin-off-outline', 'pin-off'],
  archive: ['ion', 'archive-outline', 'archive'],
  mutedBell: ['ion', 'notifications-off-outline', 'notifications-off'],
  reply: ['ion', 'arrow-undo-outline', 'arrow-undo'],
  forwardMsg: ['ion', 'arrow-redo-outline', 'arrow-redo'],
  tickSingle: ['ion', 'checkmark', 'checkmark'],
  tickDouble: ['ion', 'checkmark-done', 'checkmark-done'],
  clock: ['ion', 'time-outline', 'time'],
  speaker: ['ion', 'volume-high-outline', 'volume-high'],
  keyboard: ['ion', 'keypad-outline', 'keypad'],
  poll: ['ion', 'bar-chart-outline', 'bar-chart'],
  broadcast: ['mci', 'broadcast', 'broadcast'],

  /* --- people --- */
  person: ['ion', 'person-outline', 'person'],
  people: ['ion', 'people-outline', 'people'],
  personAdd: ['ion', 'person-add-outline', 'person-add'],
  personRemove: ['ion', 'person-remove-outline', 'person-remove'],
  contacts: ['ion', 'book-outline', 'book'],
  verified: ['mci', 'check-decagram-outline', 'check-decagram'],
  /* The scholar seal is an octagonal SEAL, not a school-hat — gold outranks
     blue and the mark must read as an impression (DESIGN.md §6 marks). */
  scholar: ['mci', 'seal', 'seal'],
  crown: ['mci', 'crown-outline', 'crown'],
  shield: ['ion', 'shield-checkmark-outline', 'shield-checkmark'],
  block: ['mci', 'block-helper', 'block-helper'],

  /* --- status / system --- */
  warning: ['ion', 'warning-outline', 'warning'],
  error: ['ion', 'alert-circle-outline', 'alert-circle'],
  info: ['ion', 'information-circle-outline', 'information-circle'],
  success: ['ion', 'checkmark-circle-outline', 'checkmark-circle'],
  offline: ['ion', 'cloud-offline-outline', 'cloud-offline'],
  lock: ['ion', 'lock-closed-outline', 'lock-closed'],
  unlock: ['ion', 'lock-open-outline', 'lock-open'],
  key: ['ion', 'key-outline', 'key'],
  flag: ['ion', 'flag-outline', 'flag'],
  hourglass: ['ion', 'hourglass-outline', 'hourglass'],
  sparkle: ['mci', 'shimmer', 'shimmer'],
  fire: ['mci', 'fire', 'fire'],
  trending: ['ion', 'trending-up', 'trending-up'],
  globe: ['ion', 'globe-outline', 'globe'],
  moon: ['ion', 'moon-outline', 'moon'],
  sun: ['ion', 'sunny-outline', 'sunny'],
  settings: ['ion', 'settings-outline', 'settings'],
  logout: ['ion', 'log-out-outline', 'log-out'],
  help: ['ion', 'help-buoy-outline', 'help-buoy'],
  language: ['ion', 'language-outline', 'language'],
  palette: ['ion', 'color-palette-outline', 'color-palette'],
  storage: ['mci', 'harddisk', 'harddisk'],
  history: ['ion', 'time-outline', 'time'],
  devices: ['ion', 'phone-portrait-outline', 'phone-portrait'],
  mail: ['ion', 'mail-outline', 'mail'],
  phone: ['ion', 'call-outline', 'call'],
  calendar: ['ion', 'calendar-outline', 'calendar'],
  location: ['ion', 'location-outline', 'location'],
  tag: ['ion', 'pricetag-outline', 'pricetag'],
  at: ['ion', 'at-outline', 'at'],
  hash: ['feather', 'hash', 'hash'],
  live: ['mci', 'access-point', 'access-point'],
  gift: ['ion', 'gift-outline', 'gift'],
  star: ['ion', 'star-outline', 'star'],
  bolt: ['ion', 'flash-outline', 'flash'],
  book: ['ion', 'book-outline', 'book'],
  grid: ['ion', 'grid-outline', 'grid'],
  list: ['ion', 'list-outline', 'list'],
  stats: ['ion', 'stats-chart-outline', 'stats-chart'],
  robot: ['mci', 'robot-outline', 'robot'],
  gavel: ['mci', 'gavel', 'gavel'],
} as const satisfies Record<string, Glyph>

export type IconName = keyof typeof GLYPHS

export interface IconProps {
  name: IconName
  size?: number
  color?: string
  /** Use the filled variant. Tab bars pass the active state here. */
  filled?: boolean
  /** The glyph's own name for assistive tech. Pass it ONLY when the icon
   *  carries meaning nothing beside it says — a lone status mark in a row of
   *  text. Inside a Touchable the press target already owns the label and a
   *  second one gets read twice. */
  label?: string
  style?: StyleProp<TextStyle>
}

export function Icon({ name, size = 22, color, filled = false, label, style }: IconProps) {
  const t = useTheme()
  const [family, outline, solid] = GLYPHS[name] as Glyph
  const glyph = filled ? (solid ?? outline) : outline
  /* QELAT default inks (DESIGN.md §6): a bare icon is PASSIVE and reads as
     textMuted; interactive icons pass accentText at the call site.

     DECORATIVE BY DEFAULT. @expo/vector-icons renders a bare RN <Text>, and
     Text is an accessibility element on both platforms — so every icon that
     is NOT inside a Touchable (a third of them: offline strips, inline error
     rows, empty states) becomes its own VoiceOver/TalkBack stop announcing a
     Private Use Area codepoint, i.e. silence. The glyph is chrome unless the
     call site says otherwise, so it hides itself and the handful that carry
     meaning opt in with `label`. */
  const props = {
    name: glyph as any,
    size,
    color: color ?? t.colors.textMuted,
    style,
    accessible: !!label,
    accessibilityRole: label ? ('image' as const) : undefined,
    accessibilityLabel: label,
    importantForAccessibility: label ? ('yes' as const) : ('no' as const),
  }
  if (family === 'mci') return <MaterialCommunityIcons {...props} />
  if (family === 'feather') return <Feather {...props} />
  return <Ionicons {...props} />
}

/** Chevron that points "forward" in the current reading direction — the
 *  disclosure arrow on every settings row and list item. */
export function DisclosureIcon({ size = 18, color }: { size?: number; color?: string }) {
  const t = useTheme()
  return <Icon name={t.isRTL ? 'back' : 'forward'} size={size} color={color ?? t.colors.textFaint} />
}

/** Back affordance that mirrors with the direction. Interactive, so its
 *  default ink is accentText — lapis is the interactive colour on clay. */
export function BackIcon({ size = 26, color }: { size?: number; color?: string }) {
  const t = useTheme()
  return <Icon name={t.isRTL ? 'forward' : 'back'} size={size} color={color ?? t.colors.accentText} />
}
