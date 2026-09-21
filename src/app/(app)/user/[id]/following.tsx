/* =========================================================
   Following — the mirror of the followers list.

   One difference that is not cosmetic: on your OWN list the
   follow control confirms before unfollowing. An accidental
   tap while scrolling a list of four hundred accounts is not
   recoverable without finding that account again.
   ========================================================= */
import React from 'react'
import { View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { api } from '@/api'
import { useAsync } from '@/hooks/useAsync'
import { useAuth } from '@/context/AuthContext'
import { useTheme } from '@/theme/ThemeProvider'
import { Divider, ListRow } from '@/ui'
import { PeopleList } from '@/components/profile/PeopleList'

export default function FollowingScreen() {
  const t = useTheme()
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const { user } = useAuth()
  const targetId = String(id || '')
  const isMe = String(user?.id || '') === targetId

  const target = useAsync<any>(
    () => api.users.get(targetId),
    { enabled: !!targetId && !isMe, deps: [targetId] },
  )
  const handle = isMe ? user?.handle : target.data?.handle

  return (
    <PeopleList
      title="Following"
      noun="following"
      subtitle={handle ? `@${handle}` : undefined}
      targetId={targetId}
      isMe={isMe}
      confirmUnfollow={isMe}
      fetch={({ page, size }) => api.users.following(targetId, { page, size })}
      emptyTitle="Not following anyone yet"
      emptyMessage={isMe ? 'Follow a few people and your feed fills up.' : undefined}
      leading={isMe ? (
        <View>
          <ListRow
            title="Find people to follow"
            icon="search"
            iconTone="accent"
            accessory={{ kind: 'chevron' }}
            onPress={() => router.push('/search/people')}
          />
          <Divider inset={t.layout.screenPadding} />
        </View>
      ) : null}
    />
  )
}
