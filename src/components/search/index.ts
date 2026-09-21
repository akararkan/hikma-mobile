/* =========================================================
   The search/discovery domain's public surface.

   Composers reach for MentionAutocomplete and TagChipInput;
   Explore, the tag pages and the people picker share the rest.
   ========================================================= */
export {
  TYPE_ICON, TYPE_LABEL, TAB_LABEL, typeSkin, contentHref, formatDuration,
  searchTags, searchStream, tagContent, listActivity, streamActivity, searchUsers,
  resolveEmail, looksLikeEmail,
  type SearchType, type TabKey, type TagScope, type SearchHit, type SearchEnvelope,
  type TrendingTag, type TagSuggestion, type TagContentItem, type TagContentPage,
  type Sound, type PeopleRow, type ActivityRow,
} from './searchTypes'

export { usePushHit, canOpen, href, type PushHitOptions } from './pushHit'
export { emitPick, onPick, usePickResult, PICKER_EVENT } from './pickerBus'
export { recentSearches, type Recent, type RecentKind } from './recentSearches'
export { useTransientRetry } from './useTransientRetry'
export { useDebouncedQuery, type DebouncedQuery, type DebouncedQueryOptions } from './useDebouncedQuery'

export { SearchResultRow, SearchResultSkeletonList, type SearchResultRowProps } from './SearchResultRow'
export { SearchTypeTabs, SEARCH_TABS, type SearchTypeTabsProps } from './SearchTypeTabs'
export { SearchDegradedBanner } from './SearchDegradedBanner'
export { TrendingTagRail, TRENDING_STALE_MS } from './TrendingTagRail'
export { ScopeTagRail, type ScopeTagRailProps } from './ScopeTagRail'
export { TagContentRow } from './TagContentRow'
export { FollowButton, type FollowButtonProps } from './FollowButton'
export { SoundSheet } from './SoundSheet'
export { TagChipInput, type TagChipInputProps } from './TagChipInput'
export {
  MentionAutocomplete, useMentionSuggest, detectMention, FOLLOWERS_SENTINEL_ID,
  type MentionUser, type MentionAutocompleteProps, type Selection,
} from './MentionAutocomplete'
export {
  MentionHighlightedText, type ParsedTokens, type ParsedToken,
} from './MentionHighlightedText'
