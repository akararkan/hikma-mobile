/* =========================================================
   Every path this domain navigates to, in one file.

   expo-router's typedRoutes builds its Href union from the
   routes that existed when `.expo/types` was last written, so
   a screen added in this pass is not in that union yet and
   every `router.push('/qna/…')` would be a type error until
   the dev server regenerates it. One cast here beats fifteen
   scattered ones, and it keeps the path strings themselves in
   a single greppable place — which matters because
   `/qna/[id]` is the CANONICAL deep-link target that
   notifications, mentions and activity rewrite
   `/questions/{id}` into, and must not be renamed.
   ========================================================= */
import type { Href } from 'expo-router'

const href = (path: string) => path as unknown as Href

export const qnaHref = {
  home: () => href('/qna'),
  ask: () => href('/qna/ask'),
  search: () => href('/qna/search'),
  saved: () => href('/qna/saved'),
  collection: (name: string) => href(`/qna/saved/${encodeURIComponent(name)}`),
  /* Arabic and Kurdish tags are common and deliberately distinct from their
     Latin transliterations, so the segment is always encoded. */
  tag: (tag: string) => href(`/qna/tag/${encodeURIComponent(tag)}`),

  question: (id: string, opts: { answer?: string; focus?: boolean } = {}) => {
    const q = new URLSearchParams()
    if (opts.answer) q.set('answer', opts.answer)
    if (opts.focus) q.set('focus', '1')
    const s = q.toString()
    return href(`/qna/${id}${s ? `?${s}` : ''}`)
  },

  compose: (id: string, opts: { parentAnswerId?: string; replyToAnswerId?: string; replyToHandle?: string; attach?: 'media' | 'voice' } = {}) => {
    const q = new URLSearchParams()
    if (opts.parentAnswerId) q.set('parentAnswerId', opts.parentAnswerId)
    if (opts.replyToAnswerId) q.set('replyToAnswerId', opts.replyToAnswerId)
    if (opts.replyToHandle) q.set('replyToHandle', opts.replyToHandle)
    if (opts.attach) q.set('attach', opts.attach)
    const s = q.toString()
    return href(`/qna/${id}/compose${s ? `?${s}` : ''}`)
  },

  edit: (id: string) => href(`/qna/${id}/edit`),
  manage: (id: string) => href(`/qna/${id}/manage`),
  thread: (id: string, answerId: string) => href(`/qna/${id}/thread/${answerId}`),
  editAnswer: (id: string, answerId: string, parentAnswerId?: string | null) =>
    href(`/qna/${id}/edit-answer/${answerId}${parentAnswerId ? `?parentAnswerId=${parentAnswerId}` : ''}`),
  sources: (id: string, answerId: string) => href(`/qna/${id}/sources/${answerId}`),
  files: (id: string, answerId: string) => href(`/qna/${id}/files/${answerId}`),

  /* Owned by other domains — listed here so a rename shows up as one diff. */
  user: (userId: string) => href(`/u/${userId}`),
  /* Mentions carry a handle, not an id; /u/ accepts either. */
  userByHandle: (handle: string) => href(`/u/${handle}`),
  post: (postId: string) => href(`/posts/${postId}`),
  research: (id: string) => href(`/research/${id}`),
  /* Global search has no route of its own — it is the Explore tab's own state
     machine, which reads `?q` on arrival. */
  globalSearch: () => href('/explore'),
  signIn: () => href('/sign-in'),
}
