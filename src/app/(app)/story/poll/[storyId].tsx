/* =========================================================
   REMOVED — post-publish poll editing is gone. A poll is set
   in the story composer or not at all, matching the web app:
   nothing in the UI links here any more. This stub only exists
   because tooling could not delete the file; it is safe to
   delete it (and this folder) by hand. Until then, any stale
   deep link lands on the story manager instead of an editor.
   ========================================================= */
import { Redirect } from 'expo-router'

export default function RemovedStoryPollRoute() {
  return <Redirect href={'/story/mine' as any} />
}
