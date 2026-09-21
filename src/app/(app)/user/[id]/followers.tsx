/* =========================================================
   Followers — public, offset-paginated.

   `total` comes from the page envelope's totalElements, not
   from profile.followerCount: that column is documented as
   denormalized and unmaintained, and it is free to read 0 on
   an account with a thousand followers.

   On your OWN list the rows are managed: "Follow back" and
   "Remove" under every name (Remove is block-and-unblock —
   see removeFollower.ts for why and what it costs).
   ========================================================= */
import React from 'react'
import { useLocalSearchParams } from 'expo-router'
import { api } from '@/api'
import { useAsync } from '@/hooks/useAsync'
import { useAuth } from '@/context/AuthContext'
import { PeopleList } from '@/components/profile/PeopleList'

export default function FollowersScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { user } = useAuth()
  const targetId = String(id || '')
  const isMe = String(user?.id || '') === targetId

  /* Only for the header subtitle — the list itself never waits on it. */
  const target = useAsync<any>(
    () => api.users.get(targetId),
    { enabled: !!targetId && !isMe, deps: [targetId] },
  )
  const handle = isMe ? user?.handle : target.data?.handle

  return (
    <PeopleList
      title="Followers"
      noun="followers"
      subtitle={handle ? `@${handle}` : undefined}
      targetId={targetId}
      isMe={isMe}
      manage={isMe}
      followLabel={isMe ? 'Follow back' : 'Follow'}
      fetch={({ page, size }) => api.users.followers(targetId, { page, size })}
      emptyTitle="No followers yet"
      emptyMessage={isMe ? 'When people follow you, they show up here.' : undefined}
    />
  )
}
