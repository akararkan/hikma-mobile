/* Row shapes as the api adapters hand them over. Written down here rather than
   inferred because the api modules are JS: without these every screen in the
   domain would silently be operating on `any`. Keep them in step with
   notifFrom() / activityFrom() / reelViewFrom() by hand. */

export interface Actor {
  id: string
  full: string
  handle: string
  initials: string
  avc: readonly [string, string] | string
  profileImage: string | null
  verified: boolean
  role: string
}

/** api/notifications.js → notifFrom() */
export interface NotifRow {
  id: string
  type: string | null
  category: string | null
  title: string
  body: string
  _actor: Actor
  aggregateCount: number
  lastActorId: string | null
  lastActorUsername: string
  resourceId: string | null
  resourceType: string | null
  /** null means "deliberately un-navigable" — never fall back to home. */
  deepLink: string | null
  unread: boolean
  readAt: string | null
  time: string
  createdAt: string
}

/** api/activity.js → activityFrom() */
export interface ActivityItem {
  id: string
  type: string | null
  label: string
  subtitle: string
  time: string
  date: string
  createdAt: string
  deepLink: string | null
  /** What the action touched — thumbnail/avatar/first-line, per activity.md §1. */
  preview: {
    thumb: string | null
    avatar: string | null
    text: string | null
    name: string | null
  }
}

/** api/reels.js → reelViewFrom() */
export interface ReelWatch {
  /** The watch-entry id — the DELETE key. */
  id: string
  /** The post id — the NAVIGATION key. Mixing these up lands on a 404 reel. */
  reelId: string
  watchedSeconds: number
  title: string
  mediaUrl: string | null
  thumb: string | null
  durationSeconds: number | null
  _author: Actor
  time: string
}
