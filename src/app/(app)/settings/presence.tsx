/* =========================================================
   Presence.

   Two policies, not one: who can see that you are online right
   now, and who can see when you were last here. They are
   separate on the wire and separate here, because people
   reason about them differently — "don't show a green dot" is
   not the same wish as "don't tell people I read this at 3am".

   Both are RECIPROCAL. Hiding your last-seen hides everyone
   else's from you, and saying so before the tap is the whole
   difference between a setting and a surprise.
   ========================================================= */
import React from 'react'
import { api, errorText, PRESENCE_POLICIES } from '@/api'
import { useAsync } from '@/hooks/useAsync'
import {
  Callout, ErrorState, GroupFooter, GroupLabel, Header, ListRow, RowGroup,
  Screen, ScreenScroll, SkeletonList, toast,
} from '@/ui'
import { View } from 'react-native'
import { useTheme } from '@/theme/ThemeProvider'

export default function PresenceSettings() {
  const t = useTheme()
  const block = useAsync<any>(() => api.settings.presence.get(), { deps: [] })
  const [saving, setSaving] = React.useState(false)

  const write = async (patch: Record<string, string>) => {
    setSaving(true)
    const previous = block.data
    block.setData((prev: any) => ({ ...(prev || {}), ...patch }))
    try {
      /* PUT is merge-style: a null field is left unchanged, so sending only
         what changed is both correct and cheaper. */
      const fresh = await api.settings.presence.update(patch)
      if (fresh && typeof fresh === 'object') block.setData(fresh)
    } catch (e) {
      block.setData(previous ?? null)
      toast.error(errorText(e, 'Could not change that setting.'))
    } finally {
      setSaving(false)
    }
  }

  if (block.loading) {
    return <Screen background="sunken"><Header back title="Presence" /><SkeletonList count={5} /></Screen>
  }
  if (block.error) {
    return <Screen background="sunken"><Header back title="Presence" /><ErrorState error={block.error} onRetry={block.reload} /></Screen>
  }

  const data = block.data || {}

  return (
    <Screen background="sunken">
      <Header back title="Presence" />
      <ScreenScroll refreshing={block.refreshing} onRefresh={block.refresh}>
        <View style={{ padding: t.layout.screenPadding, paddingBottom: 0 }}>
          <Callout tone="neutral" icon="eye">
            These settings work both ways. If you hide when you were last active,
            you stop seeing it for other people too.
          </Callout>
        </View>

        <GroupLabel>Online status</GroupLabel>
        <RowGroup>
          {(PRESENCE_POLICIES as [string, string][]).map(([value, label]) => (
            <ListRow
              key={value}
              title={label}
              disabled={saving}
              accessory={{ kind: 'radio', checked: String(data.onlineStatusPolicy || 'EVERYONE') === value }}
              onPress={() => void write({ onlineStatusPolicy: value })}
            />
          ))}
        </RowGroup>
        <GroupFooter>Who sees the green dot next to your name while you're using Hikmah Web.</GroupFooter>

        <GroupLabel>Last seen</GroupLabel>
        <RowGroup>
          {(PRESENCE_POLICIES as [string, string][]).map(([value, label]) => (
            <ListRow
              key={value}
              title={label}
              disabled={saving}
              accessory={{ kind: 'radio', checked: String(data.lastSeenPolicy || 'EVERYONE') === value }}
              onPress={() => void write({ lastSeenPolicy: value })}
            />
          ))}
        </RowGroup>
        <GroupFooter>
          Who sees “last seen 2 hours ago”. Choosing Nobody also hides it from you.
        </GroupFooter>
      </ScreenScroll>
    </Screen>
  )
}
