/* =========================================================
   HLS-first source selection.

   The media pipeline now publishes an adaptive CMAF/fMP4 HLS
   master (`…/hls/master.m3u8`) beside the progressive MP4 it
   always made — additively: media `variants` maps MAY carry an
   `hls` key, and reel feed rows MAY carry `videoHlsUrl` next to
   the untouched `videoUrl`. expo-video plays HLS natively with
   automatic ABR, so a player should be handed the master when
   one exists and the MP4 it always got when one does not.

   These three functions are that preference, written once so a
   feed card, the reels pool and a story frame cannot drift on
   what "best" means. They select; they never rewrite — every
   url here is already absolutised by the adapter that made it
   (stories absolutise in storyVisual's mediaOf).
   ========================================================= */

/** True for an HLS playlist url — a `.m3u8` playlist, or anything under the
 *  pipeline's `/hls/` directory. What a player may not cache (the OS cache
 *  cannot accept HLS; the player manages its own segments). */
export function isHlsUrl(url: string | null | undefined): boolean {
  const s = String(url || '')
  return /\.m3u8([?#]|$)/i.test(s) || s.includes('/hls/')
}

/** The url a player should be handed for one media entry: the adaptive HLS
 *  master when the pipeline made one, else whatever url the adapter already
 *  selected. Legacy media carries no `variants` and falls straight through. */
export function bestPlayableUrl(
  media?: { url?: string | null; variants?: Record<string, string> | null } | null,
): string | null {
  return media?.variants?.hls || media?.url || null
}

/** A reel feed row's playable clip: `videoHlsUrl` is additive and REEL-only;
 *  `videoUrl` stays the progressive MP4 it has always been. */
export function feedVideoUrl(
  item?: { videoHlsUrl?: string | null; videoUrl?: string | null } | null,
): string | null {
  return item?.videoHlsUrl || item?.videoUrl || null
}
