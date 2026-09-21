/* =========================================================
   Story audience — one map, four consumers.

   The composer's picker, the viewer's header glyph, the
   manager grid's corner badge and the insights header all name
   the same four values, and the only way they stay in step is
   for none of them to spell the words itself.
   ========================================================= */
import type { IconName } from '@/ui'
import type { StoryVisibility } from './storyVisual'

export const VISIBILITIES: StoryVisibility[] = ['PUBLIC', 'FOLLOWERS_ONLY', 'CLOSE_FRIENDS', 'ONLY_ME']

export const VISIBILITY_LABEL: Record<string, string> = {
  PUBLIC: 'Everyone',
  FOLLOWERS_ONLY: 'Followers',
  CLOSE_FRIENDS: 'Close friends',
  ONLY_ME: 'Only me',
}

export const VISIBILITY_GLYPH: Record<string, IconName> = {
  PUBLIC: 'globe',
  FOLLOWERS_ONLY: 'people',
  CLOSE_FRIENDS: 'star',
  ONLY_ME: 'lock',
}

export const VISIBILITY_HINT: Record<string, string> = {
  PUBLIC: 'Anyone, including people signed out',
  FOLLOWERS_ONLY: 'People who follow you',
  CLOSE_FRIENDS: 'Only the people on your close-friends list',
  ONLY_ME: 'Nobody but you',
}

/** Only these three lifetimes may ever be offered: any other integer is
 *  silently coerced to 24 server-side, so a "12 hours" chip would be a promise
 *  the UI could never detect being broken. */
export const LIFETIMES: (8 | 16 | 24)[] = [8, 16, 24]
export const LIFETIME_LABEL: Record<number, string> = { 8: '8 hours', 16: '16 hours', 24: '24 hours' }
