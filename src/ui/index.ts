/* =========================================================
   The design system's public surface.

   Screens import from '@/ui' and nothing else. Keeping the
   individual files out of the import graph is what lets a
   primitive be split or renamed without touching 200 screens.
   ========================================================= */

export { Icon, DisclosureIcon, BackIcon, type IconName, type IconProps } from './Icon'

export {
  Text, Display, Title1, Title2, Title3, Headline, Body, BodyStrong,
  Callout as CalloutText, Subhead, Footnote, Caption, Micro, NumericText,
  setFontsReady, isArabicScript,
  type TextProps, type TextTone,
} from './Text'

export {
  BrickCourse, SealBand, GulMedallion, WarpRule, WeftDash, SelectionDiamond,
  Crenellation, SealRing, ZigguratCrown, DoubleRule, Selvedge,
} from './ornaments'

export {
  Touchable, TouchableRow, fireHaptic,
  type TouchableProps, type PressFeedback, type HapticKind,
} from './Touchable'

export {
  Button, IconButton,
  type ButtonProps, type ButtonVariant, type ButtonSize, type IconButtonProps,
} from './Button'

export {
  Card, Divider, SectionGap, Section, GroupLabel, GroupFooter, Callout,
  type CardProps, type SectionProps, type CalloutProps, type CalloutTone,
} from './Surface'

export { Avatar, AvatarStack, type AvatarProps, type AvatarSize, type StoryRing, type Presence } from './Avatar'

export { Wordmark, type WordmarkProps, type WordmarkTone, type WordmarkLang, type WordmarkOrigin } from './Wordmark'

export { Field, SearchField, type FieldProps, type SearchFieldProps } from './Field'

export {
  Chip, ChipRail, Badge, VerifiedMark, ScholarMark, RoleBadge, LiveTag, formatCount,
  type ChipProps, type ChipTone,
} from './Chip'

export {
  Skeleton, SkeletonRow, SkeletonCard, SkeletonList, Spinner,
  EmptyState, ErrorState, InlineError, ListFooter,
  type EmptyStateProps, type ErrorStateProps, type SkeletonProps,
} from './State'

export {
  ListRow, RowGroup, ActionRow,
  type ListRowProps, type RowAccessory,
} from './ListRow'

export {
  Sheet, ActionSheet, ConfirmSheet, useSheetState,
  type SheetProps, type SheetAction,
} from './Sheet'

export { ToastHost, showToast, toast, type ToastTone } from './Toast'

export {
  Screen, Header, SegmentedControl, ScreenScroll,
  type ScreenProps, type HeaderProps, type HeaderAction, type SegmentedControlProps,
} from './Screen'
