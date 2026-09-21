/* =========================================================
   `/posts/{id}` → `/post/{id}`.

   Not a stylistic redirect: `/posts/{id}` is the path the
   BACKEND emits. `notifications.js` derives it for every
   Post-resource row, `activity.js` returns it from `hrefOf`,
   and `search.js` builds it in `hitHref`. Those strings arrive
   from the server and cannot be changed from here, so the app
   has to answer at that address.

   The canonical screen stays singular, because that is where
   the post detail, its edit screen, its share sheet and its
   media viewer all live. This is the doorway, not a second
   implementation.
   ========================================================= */
import React from 'react'
import { Redirect, useLocalSearchParams } from 'expo-router'

export default function PostsAlias() {
  const { id, ...rest } = useLocalSearchParams<{ id: string }>()
  if (!id) return <Redirect href="/(app)/(tabs)" />
  return <Redirect href={{ pathname: '/post/[id]', params: { id, ...rest } } as any} />
}
