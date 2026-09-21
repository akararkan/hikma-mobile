/* =========================================================
   Chat's shape-specific state primitives.

   `@/ui` already owns EmptyState / ErrorState / Skeleton. What
   it cannot own is the SHAPE of a chat skeleton: an inbox row
   and a bubble run look nothing like a settings list, and a
   shimmer with the wrong silhouette reads as a broken layout
   rather than as loading.

   ChatErrorState is a thin wrapper with one rule of its own —
   the 404 family renders as a quiet "no longer available"
   panel with no retry, because retrying a deleted conversation
   only produces the same 404.
   ========================================================= */
import React from 'react'
import { StyleSheet, View, useWindowDimensions } from 'react-native'
import { isNetworkError, isNotFound } from '@/api'
import { chatError } from '@/lib/chatErrors'
import { useTheme } from '@/theme/ThemeProvider'
import { layout, space } from '@/theme/tokens'
import { Button, EmptyState, Icon, Skeleton, Text } from '@/ui'

/* ---------------------------------------------------------
   Inbox / archived skeletons.
   --------------------------------------------------------- */

export function ConversationSkeleton({ count = 8 }: { count?: number }) {
  return (
    <View>
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={styles.convoRow}>
          <Skeleton circle width={52} height={52} />
          <View style={styles.convoText}>
            <Skeleton width="60%" height={13} />
            <Skeleton width="85%" height={11} />
          </View>
        </View>
      ))}
    </View>
  )
}

export function RequestSkeleton({ count = 4 }: { count?: number }) {
  return (
    <View>
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={styles.requestRow}>
          <View style={styles.rowTop}>
            <Skeleton circle width={48} height={48} />
            <View style={styles.convoText}>
              <Skeleton width="52%" height={13} />
              <Skeleton width="76%" height={11} />
            </View>
          </View>
          {/* No radius override: Skeleton's own setback is the ghost shape, and
              the buttons these stand in for are setback plates, not pills. */}
          <View style={styles.buttonGhosts}>
            <Skeleton height={34} style={styles.flex} />
            <Skeleton height={34} style={styles.flex} />
          </View>
        </View>
      ))}
    </View>
  )
}

/* ---------------------------------------------------------
   Thread skeleton — alternating bubbles, because a thread that
   loads into a centred spinner then jumps to a full log reads
   as two different screens.
   --------------------------------------------------------- */

const BUBBLE_WIDTHS = ['62%', '45%', '70%', '52%', '66%', '48%'] as const

export function ThreadSkeleton() {
  return (
    <View style={styles.thread}>
      {BUBBLE_WIDTHS.map((w, i) => (
        <View key={i} style={{ alignItems: i % 2 ? 'flex-end' : 'flex-start' }}>
          <Skeleton width={w} height={i % 3 === 0 ? 54 : 34} radius={18} />
        </View>
      ))}
    </View>
  )
}

export function MessageCardSkeleton({ count = 3 }: { count?: number }) {
  const t = useTheme()
  return (
    <View style={{ padding: t.layout.screenPadding, gap: space.md }}>
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} height={104} radius={t.radius.card} />
      ))}
    </View>
  )
}

export function MediaGridSkeleton({ count = 12 }: { count?: number }) {
  const { width } = useWindowDimensions()
  /* Square cells three to a row, so the shimmer has the gallery's silhouette
     rather than a generic list's. */
  const cell = Math.floor((width - 6) / 3)
  return (
    <View style={styles.grid}>
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={styles.gridCell}>
          <Skeleton width={cell} height={cell} radius={0} />
        </View>
      ))}
    </View>
  )
}

/* ---------------------------------------------------------
   The connection strip.

   Two different sentences for two different truths: a failed
   request means the phone is offline and the list is a cache;
   a dropped socket means the data is real but no longer live.
   Collapsing them into one "offline" bar tells half the users
   something false.
   --------------------------------------------------------- */

export function ConnectionBar({ connected, offline }: { connected: boolean; offline?: boolean }) {
  const t = useTheme()
  if (connected && !offline) return null
  const warn = !!offline
  return (
    <View
      style={[
        styles.strip,
        { backgroundColor: warn ? t.colors.warningSoft : t.colors.surfaceSunken },
      ]}
    >
      <Icon name={warn ? 'offline' : 'refresh'} size={13} color={warn ? t.colors.warningText : t.colors.textMuted} />
      <Text variant="caption" tone={warn ? 'warning' : 'muted'} align="ui">
        {warn ? 'Offline — showing your last synced chats' : 'Reconnecting…'}
      </Text>
    </View>
  )
}

/* ---------------------------------------------------------
   Errors.
   --------------------------------------------------------- */

export function ChatErrorState({
  error, onRetry, title, back,
}: { error: any; onRetry?: () => void; title?: string; back?: () => void }) {
  const t = useTheme()
  const gone = isNotFound(error)

  /* The 404 family is not a failure the user caused and not one they can
     retry — it is an answer. Rendering it in the red error frame with a Try
     again button invites a second identical 404. */
  if (gone) {
    return (
      <EmptyState
        icon="chat"
        title="This conversation is no longer available"
        message="It may have been deleted, or you may no longer be a member."
        actionLabel={back ? 'Back to chats' : undefined}
        onAction={back}
      />
    )
  }

  return (
    <View style={[styles.errorBox, { padding: t.layout.screenPadding }]}>
      <View style={[styles.errorIcon, { backgroundColor: isNetworkError(error) ? t.colors.surfaceSunken : t.colors.dangerSoft }]}>
        <Icon
          name={isNetworkError(error) ? 'offline' : 'error'}
          size={26}
          color={isNetworkError(error) ? t.colors.textFaint : t.colors.danger}
        />
      </View>
      <Text variant="title3" align="center">{title || 'Could not load this'}</Text>
      <Text variant="callout" tone="muted" align="center" style={styles.errorBody}>
        {chatError(error, 'Something went wrong. Please try again.')}
      </Text>
      {onRetry ? <Button label="Try again" icon="refresh" variant="tinted" onPress={onRetry} style={{ marginTop: space.md2 }} /> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  /* Must match ConversationRow exactly, or the skeleton is a different list
     than the one that replaces it and the whole rail jumps on load. */
  convoRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.md, height: layout.rowHeight },
  convoText: { flex: 1, gap: space.sm },
  requestRow: { paddingHorizontal: space.lg, paddingVertical: space.md2, gap: space.md },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  buttonGhosts: { flexDirection: 'row', gap: space.sm2 },
  flex: { flex: 1 },
  thread: { padding: space.lg, gap: space.sm2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  gridCell: { padding: space.xxs },
  strip: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xs2, height: 28 },
  errorBox: { alignItems: 'center', justifyContent: 'center', paddingVertical: 48, gap: space.xs2 },
  /* Icon-only medallion — a sanctioned circle, not a lozenge. */
  errorIcon: { width: 62, height: 62, borderRadius: 999, alignItems: 'center', justifyContent: 'center', marginBottom: space.sm2 },
  errorBody: { maxWidth: 320, marginTop: space.xxs },
})
