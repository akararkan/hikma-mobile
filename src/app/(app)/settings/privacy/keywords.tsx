/* =========================================================
   Hidden keywords.

   `add` answers with the EXISTING row when the keyword is
   already there rather than erroring, so a duplicate is not a
   failure — it just should not appear twice in the list. The
   dedupe is by id for that reason.

   Matching is the server's business and it is deliberately
   loose (substring, case-insensitive), so the footer says so:
   a user who adds "art" and stops seeing "party" needs to know
   why before they conclude the feature is broken.

   Scroll shape: keyExtractor lives at module scope and the row
   is a memoized component fed an item-first `onRemove`, so the
   one renderItem identity serves every row — FlashList's
   ViewHolder memo compares renderItem BY IDENTITY, and an
   inline arrow there re-renders every mounted cell.
   ========================================================= */
import React from 'react'
import { View } from 'react-native'
import { FlashList } from '@shopify/flash-list'
import { api, errorText } from '@/api'
import { useAction, useAsync, useEvent } from '@/hooks/useAsync'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  EmptyState, ErrorState, Field, GroupFooter, Header, Icon, Screen,
  SkeletonRow, Text, Touchable, toast,
} from '@/ui'

const keyExtractor = (r: any) => String(r.id)

/* Reads the theme itself rather than closing over the screen's `c`, so the
   row's memo survives a screen render. */
const KeywordRow = React.memo(function KeywordRow(
  { item, onRemove }: { item: any; onRemove: (row: any) => void },
) {
  const t = useTheme()
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
        paddingHorizontal: t.layout.screenPadding,
        paddingVertical: space.md,
      }}
    >
      <Icon name="hash" size={16} color={t.colors.textFaint} />
      <Text variant="body" align="auto" style={{ flex: 1 }} numberOfLines={2}>{item.keyword}</Text>
      <Touchable
        onPress={() => onRemove(item)}
        feedback="scale"
        haptic="light"
        accessibilityLabel={`Remove ${item.keyword}`}
        style={{ padding: space.xs2 }}
      >
        <Icon name="close" size={17} color={t.colors.textMuted} />
      </Touchable>
    </View>
  )
})

export default function KeywordsScreen() {
  const t = useTheme()
  const [draft, setDraft] = React.useState('')

  const list = useAsync<any[]>(() => api.settings.privacy.keywords.all(), { deps: [] })

  const add = useAction(async () => {
    const word = draft.trim()
    if (!word) return
    const row: any = await api.settings.privacy.keywords.add(word)
    setDraft('')
    /* A duplicate returns the existing row — merge by id so it cannot appear
       twice, and so the field still clears (which reads as "already there"). */
    list.setData(prev => {
      const next = (prev ?? []).filter(r => String(r.id) !== String(row?.id))
      return row ? [row, ...next] : next
    })
  }, { onError: e => toast.error(errorText(e, 'Could not add that keyword.')) })

  /* Identity-stable but always fresh, so every row shares this one function
     instead of minting a closure per cell. */
  const remove = useEvent(async (row: any) => {
    const previous = list.data
    list.setData(prev => (prev ?? []).filter(r => String(r.id) !== String(row.id)))
    try { await api.settings.privacy.keywords.remove(row.id) }
    catch (e) { list.setData(previous ?? null); toast.error(errorText(e, 'Could not remove that keyword.')) }
  })

  const renderItem = React.useCallback(
    ({ item }: { item: any }) => <KeywordRow item={item} onRemove={remove} />,
    [remove],
  )

  return (
    <Screen>
      <Header back title="Hidden keywords" />

      <View style={{ padding: t.layout.screenPadding, gap: space.sm2 }}>
        <Field
          value={draft}
          onChangeText={setDraft}
          placeholder="Add a word or phrase"
          icon="eyeOff"
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={60}
          returnKeyType="done"
          onSubmitEditing={() => void add.run()}
          action={draft.trim()
            ? { icon: 'add', onPress: () => void add.run(), label: 'Add keyword' }
            : null}
        />
      </View>

      {list.loading ? (
        <View>{Array.from({ length: 4 }, (_, i) => <SkeletonRow key={i} avatarSize={22} lines={1} />)}</View>
      ) : list.error ? (
        <ErrorState error={list.error} onRetry={list.reload} />
      ) : (
        <FlashList
          data={list.data ?? []}
          keyExtractor={keyExtractor}
          refreshing={list.refreshing}
          onRefresh={list.refresh}
          ListEmptyComponent={
            <EmptyState
              icon="eyeOff"
              title="No hidden keywords"
              message="Add a word and posts, comments and replies containing it stop appearing in your feeds."
              compact
            />
          }
          ListFooterComponent={
            (list.data?.length ?? 0) > 0 ? (
              <GroupFooter>
                Matching is not word-aware: “art” also hides “party”. Keep keywords
                specific. This only affects what YOU see — nobody is told.
              </GroupFooter>
            ) : null
          }
          renderItem={renderItem}
        />
      )}
    </Screen>
  )
}
