/* =========================================================
   Channel destinations.

   expo-router builds its `Href` union from `.expo/types/router.d.ts`,
   which Metro regenerates by walking the file tree. A route file
   added since the last dev-server run therefore exists on disk but
   not yet in the checker's union, so every destination is built here
   and the gap costs one cast instead of ninety.

   The channel id is also the conversation id, and a post id is a
   Snowflake STRING — both are interpolated verbatim, never coerced.
   ========================================================= */
import type { Href } from 'expo-router'

const to = (path: string) => path as Href

const query = (params: Record<string, string | number | undefined | null>) => {
  const parts: string[] = []
  for (const [k, v] of Object.entries(params)) {
    if (v == null || v === '') continue
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
  }
  return parts.length ? `?${parts.join('&')}` : ''
}

export const chRoute = {
  index: () => to('/channels'),
  create: () => to('/channels/new'),
  channel: (id: string) => to(`/channels/${id}`),
  info: (id: string) => to(`/channels/${id}/info`),
  edit: (id: string) => to(`/channels/${id}/edit`),
  stats: (id: string) => to(`/channels/${id}/stats`),
  media: (id: string, kind?: string) => to(`/channels/${id}/media${query({ kind })}`),
  search: (id: string) => to(`/channels/${id}/search`),
  pinned: (id: string) => to(`/channels/${id}/pinned`),
  scheduled: (id: string) => to(`/channels/${id}/scheduled`),
  subscribers: (id: string) => to(`/channels/${id}/subscribers`),
  addPeople: (id: string) => to(`/channels/${id}/add-people`),
  invites: (id: string) => to(`/channels/${id}/invites`),
  requests: (id: string) => to(`/channels/${id}/requests`),
  discussion: (id: string) => to(`/channels/${id}/discussion`),
  admins: (id: string) => to(`/channels/${id}/admins`),
  addAdmin: (id: string) => to(`/channels/${id}/admins/add`),
  adminRights: (id: string, userId: string) => to(`/channels/${id}/admins/${userId}`),
  post: (id: string, postId: string) => to(`/channels/${id}/post/${postId}`),
  /* Full-bleed viewer for one post's pictures and clips. `protected` mirrors
     the channel's protectedContent setting so the viewer can drop save/share
     without a second channel read. */
  viewer: (id: string, postId: string, opts: { index?: number; title?: string; protected?: boolean } = {}) =>
    to(`/channels/${id}/viewer${query({ messageId: postId, index: opts.index, title: opts.title, protected: opts.protected ? 1 : undefined })}`),
  tag: (id: string, tag: string) => to(`/channels/${id}/tag/${encodeURIComponent(tag)}`),
  compose: (id: string, opts: { editId?: string; preset?: 'poll' | 'photo' | 'schedule'; body?: string } = {}) =>
    to(`/channels/${id}/compose${query(opts)}`),
  handle: (handle: string) => to(`/c/${encodeURIComponent(handle)}`),

  /* Outside the domain, but reached from it. */
  user: (userId: string) => to(`/u/${userId}`),
  chat: (convId: string) => to(`/chat/${convId}`),
}
