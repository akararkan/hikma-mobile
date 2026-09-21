/* =========================================================
   Your own profile.

   The owner read (`meProfile`) is the only one that populates
   profileViews and returns non-public links and contacts, and
   it is uncached server-side — which is why this screen, and
   not the public read, is what refetches after an edit.
   ========================================================= */
import React from 'react'
import { ProfileView } from '@/components/profile/ProfileView'

export default function MyProfileTab() {
  return <ProfileView owner tabRetap />
}
