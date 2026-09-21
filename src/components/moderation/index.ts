/* =========================================================
   The moderation domain's own surface.

   The author-facing pieces (ModerationBadge, ModerationNotice,
   ModerationRefusalNotice, useHeldWatch, reportHref) live in
   src/components/system/Moderation.tsx and are re-exported here
   so a screen never has to know which half of the contract a
   given piece belongs to.
   ========================================================= */
export { RedactedText } from './RedactedText'
export { ScoreBar, type ScoreBarProps } from './ScoreBar'
export { CooldownButton, type CooldownButtonProps } from './CooldownButton'
export { ModerationSystemRow, MODERATION_NOTIF_HREF, type ModerationSystemRowProps } from './ModerationSystemRow'
export {
  StaffRefusal, StaffGateLoading,
  MOD_CONSOLE_ROLES, MOD_ANALYTICS_ROLES, MOD_MODEL_ROLES, MOD_ADMIN_ROLES,
} from './StaffGate'
export { withStepUpAction, isCancelled } from './stepUp'
export {
  OutcomePill, REPORT_TARGET_NOUNS, targetNoun, reasonLabel, outcomeTone,
} from './ReportBits'
export {
  Mono, MonoChip, Pill, StatusPill, VerdictPill, VersionStatusPill,
  Tile, MetaRow, ErrorStrip, WarningBanner, Panel, HealthDot,
  fmtDate, fmtDateTime, fmtMs, fmtDeadline,
} from './parts'

export {
  ModerationBadge, ModerationNotice, ModerationRefusalNotice, useHeldWatch, reportHref,
  type HeldState, type ReportTarget,
} from '@/components/system/Moderation'
