/* =========================================================
   useTabBarClearance — how far a tab scene's list must pad
   past the bar it scrolls underneath.

   The tab bar is translucent and absolutely positioned
   (`(tabs)/_layout.tsx`: "scenes must run underneath it and pad
   their own list footers"), so every tab scene owes its own
   bottom padding. Each one was guessing:

     Home      insets.bottom + 60
     Chat      insets.bottom + 60
     Explore   insets.bottom + 76

   None of those is the bar. TabBar renders at
   `tabBarHeight + max(insets.bottom, 8)` — 64 + 34 = 98pt on a
   home-indicator phone, 64 + 8 = 72pt without one. So
   `insets.bottom + 60` clears 94 of 98 on an iPhone 15 and 60
   of 72 on a phone with no indicator: the last row sits 4pt
   under the bar in the first case and 12pt under it in the
   second, which is why it reads as "fine on my phone".
   Explore's 76 over-clears by the same amounts in the other
   direction, leaving a strip of dead paper.

   One derivation, from the same two tokens the bar itself uses.
   `extra` is breathing room ABOVE the bar, not the bar.
   ========================================================= */
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { layout } from '@/theme/tokens'

export function useTabBarClearance(extra: number = layout.listGap): number {
  const insets = useSafeAreaInsets()
  return layout.tabBarHeight + Math.max(insets.bottom, layout.tabBarMinInset) + extra
}
