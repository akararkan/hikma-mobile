/* =========================================================
   SearchResultRow — all eight hit types from the hit ALONE.

   No hydration call, ever. The expanded hit carries everything
   a row needs, and a list of twenty rows that each fetch their
   own subject is how a search screen ends up slower than the
   search itself.

   The per-type field meanings are the sharp edge here and they
   are not symmetric:

     authorUsername  the content author's handle — EXCEPT on
                     USER (the account's own username) and
                     CHANNEL (the channel @handle, not a person)
     authorName      the display name — EXCEPT on SOUND, where
                     it is the ARTIST
     titlePreview    post → text, question/research/channel/sound
                     → title, answer → body, user → display name

   `score` is ordering only and is never rendered.

   React.memo'd: this is the recycled cell of every search
   surface, and the ALL tab mixes eight structurally different
   leading elements — so the caller must also pass a
   useCallback-stable renderItem and a getItemType keyed on
   `contentType`, or the memo never gets a chance to hold.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { api, errorText } from '@/api'
import { useAuthGate } from '@/context/AuthContext'
import { useTheme } from '@/theme/ThemeProvider'
import { setback, space } from '@/theme/tokens'
import { Avatar, Button, Chip, Icon, Text, TouchableRow, toast } from '@/ui'
import { FollowButton } from './FollowButton'
import { canOpen } from './pushHit'
import { TYPE_ICON, TYPE_LABEL, typeSkin, type SearchHit } from './searchTypes'

export interface SearchResultRowProps {
  hit: SearchHit
  /** `compact` is the typeahead face: 32pt leading, one line, no control. */
  variant?: 'full' | 'compact'
  /** Name the type in the meta line for EVERY row — the merged ALL tab, where
   *  a post and a sound are otherwise told apart by tile colour alone. Typed
   *  tabs leave it off; there the label would be redundant chrome. */
  showType?: boolean
  onPress?: () => void
  onLongPress?: () => void
}

export const SearchResultRow = React.memo(function SearchResultRow({
  hit, variant = 'full', showType = false, onPress, onLongPress,
}: SearchResultRowProps) {
  const t = useTheme()
  const c = t.colors
  const compact = variant === 'compact'
  const type = hit.contentType
  const skin = typeSkin(c, type)
  const openable = canOpen(hit)

  const lead = compact ? 32 : 40
  const title = hit.titlePreview || fallbackTitle(type)
  const handle = hit.authorUsername ? `@${hit.authorUsername}` : ''

  const leading = (() => {
    if (type === 'USER' || type === 'POST') {
      return (
        <Avatar
          size={type === 'USER' && !compact ? 44 : lead}
          name={type === 'USER' ? title : hit.authorName || hit.authorUsername}
          seed={type === 'USER' ? hit.contentId : hit.authorUsername || hit.contentId}
        />
      )
    }
    if (type === 'CHANNEL') {
      return <Avatar square size={compact ? 32 : 44} name={title} seed={hit.contentId} />
    }
    /* Everything else is a glyph tile: these hits carry no media URL at all,
       so an <Image> here would only ever render a broken box. */
    const w = type === 'REEL' && !compact ? 40 : lead
    const h = type === 'REEL' && !compact ? 56 : lead
    return (
      <View
        style={[
          styles.tile,
          /* Setback, not a uniform box: the tile is a bounded plate and
             uniform corners on a plate are what quietly kills the language
             (DESIGN.md §8.1). Avatars above stay circles — faces are the one
             round thing. */
          { width: w, height: h, ...setback(t.shape.chip), backgroundColor: skin.bg },
        ]}
      >
        <Icon name={TYPE_ICON[type] ?? 'file'} size={compact ? 16 : 20} color={skin.fg} filled />
      </View>
    )
  })()

  const meta = (() => {
    switch (type) {
      case 'REEL': return ['Reel', handle, hit.time]
      case 'QUESTION': return ['Question', handle, hit.time]
      case 'ANSWER': return ['Answer', handle, hit.time]
      case 'RESEARCH': return ['Research', hit.authorName || handle, hit.time]
      case 'SOUND': return [showType ? 'Sound' : '', hit.authorName || 'Unknown artist']
      case 'CHANNEL': return [showType ? 'Channel' : '', handle]
      case 'USER': return [showType ? 'Person' : '', handle]
      default: return [showType ? TYPE_LABEL[type] ?? '' : '', handle, hit.time]
    }
  })().filter(Boolean).join(' · ')

  const trailing = compact ? null : (() => {
    if (type === 'USER') return <FollowButton userId={hit.contentId} name={title} />
    if (type === 'CHANNEL') return <SubscribePill channelId={hit.contentId} />
    if (type === 'SOUND') {
      return <Button label="Use" size="sm" variant="secondary" onPress={onPress} style={styles.trailingControl} />
    }
    return null
  })()

  const isIdentity = type === 'USER' || type === 'CHANNEL'

  return (
    <TouchableRow
      onPress={openable ? onPress : undefined}
      onLongPress={onLongPress}
      disabled={!openable}
      /* Type first: sighted users read it off the leading tile; a screen
         reader never sees the tile at all. */
      accessibilityLabel={[`${TYPE_LABEL[type] ?? 'Result'}.`, `${title}.`, meta].filter(Boolean).join(' ')}
    >
      <View
        style={[
          styles.row,
          {
            paddingHorizontal: t.layout.screenPadding,
            paddingVertical: compact ? 8 : 12,
            gap: space.md,
            /* An ANSWER hit with no parentId has nowhere to go. Dim it rather
               than crash on press — it is real content, just unreachable. */
            opacity: openable ? 1 : t.alpha.disabled,
          },
        ]}
      >
        {leading}

        <View style={styles.flex}>
          <View style={styles.titleLine}>
            <Text
              variant={isIdentity ? 'body' : compact ? 'subhead' : 'callout'}
              weight={isIdentity || type === 'RESEARCH' ? '600' : '500'}
              numberOfLines={compact ? 1 : isIdentity || type === 'SOUND' ? 1 : 2}
              style={styles.flex}
            >
              {title}
            </Text>
            {/* No verified mark here on purpose: the search index inlines NO
                viewer- or trust-specific fields, so a mark on this row would
                be a guess. The destination profile owns it. */}
            {type === 'REEL' && !compact ? <Chip label="Reel" tone="danger" size="sm" /> : null}
          </View>

          {meta ? (
            <Text variant="caption" tone="muted" numberOfLines={1} style={{ marginTop: space.xxs }}>{meta}</Text>
          ) : null}

          {/* An answer has no page of its own — say so before the tap, not after. */}
          {type === 'ANSWER' && !compact ? (
            <Text variant="caption" tone="faint" align="ui" style={{ marginTop: space.xxs }}>
              {openable ? 'Opens the question' : 'This answer’s question is no longer linked'}
            </Text>
          ) : null}
        </View>

        {trailing}
      </View>
    </TouchableRow>
  )
})

/** Skeleton shaped like the row above, so the swap is not a jump. */
export function SearchResultSkeletonList({ count = 6 }: { count?: number }) {
  const t = useTheme()
  return (
    <View>
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={[styles.row, { paddingHorizontal: t.layout.screenPadding, paddingVertical: space.md, gap: space.md }]}>
          <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: t.colors.skeleton }} />
          <View style={{ flex: 1, gap: space.sm }}>
            <View style={{ width: '60%', height: 12, borderRadius: 6, backgroundColor: t.colors.skeleton }} />
            <View style={{ width: '35%', height: 12, borderRadius: 6, backgroundColor: t.colors.skeleton }} />
          </View>
        </View>
      ))}
    </View>
  )
}

/* ---------------------------------------------------------
   The channel pill has THREE states, not two — and a search
   hit carries no viewer-specific fields at all, so the row
   cannot know which one it is until the user acts. It starts
   as "Subscribe" and reconciles from the object the write
   returns: a join-by-request channel answers with
   pendingJoinRequest, not subscribed.
   --------------------------------------------------------- */

function SubscribePill({ channelId }: { channelId: string }) {
  const gate = useAuthGate()
  const [state, setState] = React.useState<'idle' | 'busy' | 'subscribed' | 'requested'>('idle')

  /* Row recycling hands this instance a different channel; reset or the pill
     claims a subscription the viewer never made. */
  React.useEffect(() => { setState('idle') }, [channelId])

  if (gate !== 'allow') return null

  const label = state === 'requested' ? 'Requested' : state === 'subscribed' ? 'Subscribed' : 'Subscribe'

  return (
    <Button
      label={label}
      size="sm"
      variant={state === 'idle' || state === 'busy' ? 'primary' : 'secondary'}
      loading={state === 'busy'}
      disabled={state !== 'idle'}
      style={styles.trailingControl}
      onPress={async () => {
        setState('busy')
        try {
          const row: any = await api.channels.subscribe(channelId)
          setState(row?.pendingJoinRequest ? 'requested' : 'subscribed')
        } catch (e: any) {
          setState('idle')
          toast.error(errorText(e))
        }
      }}
    />
  )
}

function fallbackTitle(type: string): string {
  return `Untitled ${(TYPE_LABEL[type] ?? 'item').toLowerCase()}`
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
  titleLine: { flexDirection: 'row', alignItems: 'center', gap: space.xs2 },
  tile: { alignItems: 'center', justifyContent: 'center', borderCurve: 'continuous' },
  /* Not a pill — the Button primitive owns the setback; this only stops the
     control from shrinking to its label and jittering the row. */
  trailingControl: { minWidth: 88, justifyContent: 'center' },
})
