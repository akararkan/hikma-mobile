/* =========================================================
   Privacy.

   The backend resolves visibility from a map of 23 FieldKeys,
   and `PUT /settings/privacy/{field}` answers with the FULL
   refreshed map. That response is the point: the resolver can
   change other fields as a consequence of the one you set
   (CUSTOM without a list is not CUSTOM), so the screen adopts
   the returned map wholesale rather than patching the one row
   it touched.

   CUSTOM is offered only when the account has at least one
   list. Offering it otherwise produces a setting that reads as
   "custom" and behaves as "nobody", which is the worst
   possible answer to a privacy question.
   ========================================================= */
import React from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { api, errorText, PRIVACY_GROUPS, VISIBILITY_LABELS, VISIBILITY_LEVELS } from '@/api'
import { useAsync } from '@/hooks/useAsync'
import { useTheme } from '@/theme/ThemeProvider'
import {
  ActionSheet, ErrorState, GroupFooter, GroupLabel, Header, ListRow, RowGroup,
  Screen, ScreenScroll, SkeletonList, useSheetState, toast,
} from '@/ui'

export default function PrivacySettings() {
  const t = useTheme()
  const router = useRouter()

  const map = useAsync<Record<string, string>>(() => api.settings.privacy.map(), { deps: [] })
  const lists = useAsync<any[]>(() => api.settings.privacy.lists.all(), { deps: [] })
  const keywords = useAsync<any[]>(() => api.settings.privacy.keywords.all(), { deps: [] })
  const blocks = useAsync<any>(() => api.settings.blocks.list({ page: 0, size: 1 }), { deps: [] })
  const muted = useAsync<string[]>(() => api.settings.privacy.muted.ids(), { deps: [] })

  const picker = useSheetState<{ field: string; label: string }>()
  const [saving, setSaving] = React.useState<string | null>(null)

  const hasLists = (lists.data?.length ?? 0) > 0

  const setField = async (field: string, visibility: string) => {
    setSaving(field)
    const previous = map.data
    /* Optimistic, because a visibility tap should register instantly — the
       authoritative map replaces it a moment later either way. */
    map.setData(prev => (prev ? { ...prev, [field]: visibility } : prev))
    try {
      const fresh = await api.settings.privacy.setField(field, visibility)
      if (fresh && typeof fresh === 'object') map.setData(fresh as any)
    } catch (e) {
      map.setData(previous ?? null)
      toast.error(errorText(e, 'Could not change that setting.'))
    } finally {
      setSaving(null)
    }
  }

  if (map.loading) {
    return (
      <Screen background="sunken">
        <Header back title="Privacy" />
        <SkeletonList count={9} />
      </Screen>
    )
  }

  if (map.error) {
    return (
      <Screen background="sunken">
        <Header back title="Privacy" />
        <ErrorState error={map.error} onRetry={map.reload} />
      </Screen>
    )
  }

  const current = map.data || {}

  return (
    <Screen background="sunken">
      <Header back title="Privacy" />
      <ScreenScroll refreshing={map.refreshing} onRefresh={map.refresh}>
        {PRIVACY_GROUPS.map(group => (
          <View key={group.label}>
            <GroupLabel>{group.label}</GroupLabel>
            <RowGroup inset={t.layout.screenPadding}>
              {(group.keys as string[][]).map(([key, label]) => (
                <ListRow
                  key={key}
                  title={label}
                  disabled={saving === key}
                  accessory={{
                    kind: 'value',
                    text: (VISIBILITY_LABELS as Record<string, string>)[current[key]] ?? 'Everyone',
                  }}
                  onPress={() => picker.open({ field: key, label })}
                />
              ))}
            </RowGroup>
          </View>
        ))}

        <GroupLabel>Lists</GroupLabel>
        <RowGroup>
          <ListRow
            title="Custom lists"
            subtitle="Group people so a setting can apply to just them"
            icon="people"
            iconTone="accent"
            accessory={{ kind: 'value', text: hasLists ? `${lists.data!.length}` : 'None' }}
            onPress={() => router.push('/settings/privacy/lists')}
          />
        </RowGroup>
        {!hasLists ? (
          <GroupFooter>
            Create a list to unlock the “Custom lists” option above.
          </GroupFooter>
        ) : null}

        <GroupLabel>Filtering</GroupLabel>
        <RowGroup>
          <ListRow
            title="Hidden keywords"
            subtitle="Posts and comments containing these are hidden from you"
            icon="eyeOff"
            iconTone="warning"
            accessory={{ kind: 'value', text: String(keywords.data?.length ?? 0) }}
            onPress={() => router.push('/settings/privacy/keywords')}
          />
          <ListRow
            title="Muted accounts"
            subtitle="You still follow them; you just stop seeing them"
            icon="mutedBell"
            iconTone="neutral"
            accessory={{ kind: 'value', text: String(muted.data?.length ?? 0) }}
            onPress={() => router.push('/settings/privacy/muted')}
          />
          <ListRow
            title="Restricted accounts"
            subtitle="They can still follow you; their comments stay hidden"
            icon="eyeOff"
            iconTone="warning"
            accessory={{ kind: 'chevron' }}
            onPress={() => router.push('/settings/privacy/restricted')}
          />
          <ListRow
            title="Blocked accounts"
            subtitle="They can't see you, message you, or find you"
            icon="block"
            iconTone="danger"
            accessory={{ kind: 'value', text: String((blocks.data as any)?.total ?? 0) }}
            onPress={() => router.push('/settings/privacy/blocked')}
          />
        </RowGroup>
        <GroupFooter>
          Blocking is mutual and silent: the other person is never told, and
          neither of you appears in the other's search results.
        </GroupFooter>
      </ScreenScroll>

      <ActionSheet
        visible={picker.visible}
        onClose={picker.close}
        title={picker.payload?.label}
        subtitle="Who can see this?"
        actions={VISIBILITY_LEVELS.map((level: string) => ({
          label: (VISIBILITY_LABELS as Record<string, string>)[level] ?? level,
          icon: level === 'ONLY_ME' ? 'lock' as const
            : level === 'EVERYONE' ? 'globe' as const
              : level === 'CLOSE_FRIENDS' ? 'star' as const
                : 'people' as const,
          /* CUSTOM without a list resolves to nobody — do not offer a setting
             whose label and behaviour disagree. */
          hidden: level === 'CUSTOM' && !hasLists,
          subtitle: picker.payload && current[picker.payload.field] === level ? 'Current' : undefined,
          onPress: () => { if (picker.payload) void setField(picker.payload.field, level) },
        }))}
      />
    </Screen>
  )
}
