/* =========================================================
   Whether BootGate owes the door its full reveal.

   The animated lockup (mark travels, word writes, rosette draws) is a
   FIRST-DOOR moment, not a loading screen — it earns its keep once, on the
   install, and again the next time someone has to walk back through the
   door because their session died. An ordinary close-and-reopen with a
   still-live session gets none of it: BootGate resolves the redirect the
   instant the gate is known, same fast path a notification-tap launch
   already takes (see index.tsx's `openedWithIntent`).
   ========================================================= */
import { storage } from '@/platform/storage'

const KEY = 'boot:brand:played'

/** True once this device has used up its brand moment. */
export function hasPlayedBootBrand(): boolean {
  return storage.getItem(KEY) === '1'
}

/** Called once BootGate's reveal has actually finished playing. */
export function markBootBrandPlayed(): void {
  storage.setItem(KEY, '1')
}

/** A session that dies on its own — AUTH_EXPIRED — hands the brand moment
 *  back. The device's NEXT cold start is, in the way that matters here, a
 *  new arrival at the door. */
export function resetBootBrand(): void {
  storage.removeItem(KEY)
}
