/* =========================================================
   Someone else's profile.

   The same view as the owner tab with `owner` false, except
   when the id IS the signed-in user: notification deep links
   and mentions can both land here pointing at yourself, and
   rendering the public read of your own profile would show a
   Follow button and zero profile views.
   ========================================================= */
import React from 'react'
import { useLocalSearchParams } from 'expo-router'
import { useAuth } from '@/context/AuthContext'
import { ProfileView } from '@/components/profile/ProfileView'

export default function UserProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { user } = useAuth()
  const targetId = String(id || '')
  const isMe = !!targetId && String(user?.id || '') === targetId

  return <ProfileView userId={targetId} owner={isMe} />
}
