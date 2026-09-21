/* =========================================================
   Types for useRealtime.js.

   tsconfig's `include` covers .ts and .tsx only, so a .js hook
   is resolved by import but never type-checked and contributes
   no declarations — every parameter arrives at the call site
   as an implicit any.

   The one that matters is `domain`. It indexes the DOMAIN map
   in src/api/realtime.js, and `openStream` returns a silent
   no-op for a key that is not in it. So 'research' instead of
   'researches', or 'post' instead of 'posts', type-checks
   clean, connects to nothing, and shows up as a comment thread
   that simply stops updating live — with no error anywhere.
   Pinning the literal union is what turns that into a build
   failure. Keep it in lockstep with DOMAIN.
   ========================================================= */

export type RealtimeDomain = 'posts' | 'questions' | 'researches'

export interface RealtimeHandlers {
  onEvent?: (e: any) => void
  onConnected?: (d: any) => void
  onError?: (e: any) => void
}

/**
 * Subscribe one entity's live stream for the lifetime of the component.
 * A null/undefined `id` does not subscribe — pass the id straight through
 * while it hydrates rather than guarding the hook behind a condition.
 */
export declare function useRealtime(
  domain: RealtimeDomain,
  id: string | null | undefined,
  handlers?: RealtimeHandlers,
): void
