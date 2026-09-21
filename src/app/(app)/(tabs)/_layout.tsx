/* =========================================================
   The five tabs.

   Home · Explore · Reels · Chat · You

   Composing is a floating action button rather than a sixth
   tab or a centre "+": this app has many things to create
   (post, reel, story, research, question, channel post), so the
   entry point has to open a chooser, and a chooser behind a
   tab reads as a broken tab. A FAB that opens a sheet is
   honest about being an action, not a destination.

   Notifications live in the Home header rather than a tab —
   the bell is the one surface users reach for by icon, and the
   badge rides the always-on SSE stream either way.
   ========================================================= */
import React from 'react'
import { Tabs } from 'expo-router/js-tabs'
import { TabBar } from '@/components/nav/TabBar'
import { useTheme } from '@/theme/ThemeProvider'

export default function TabsLayout() {
  const t = useTheme()

  return (
    <Tabs
      tabBar={props => <TabBar {...props} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: t.colors.bg },
        /* The bar is translucent and absolutely positioned, so scenes must
           run underneath it and pad their own list footers. */
        tabBarStyle: { position: 'absolute' },
        /* Visited tabs stay MOUNTED (their state survives) but a blurred
           subtree is frozen via react-freeze, so realtime churn — typing
           frames, unread bumps, inbox reorders — re-renders only the focused
           scene. Anything that must keep running off-tab already lives in the
           providers, and the scenes' own polling is focus-scoped. */
        freezeOnBlur: true,
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Home' }} />
      <Tabs.Screen name="explore" options={{ title: 'Explore' }} />
      <Tabs.Screen name="reels" options={{ title: 'Reels' }} />
      <Tabs.Screen name="chat" options={{ title: 'Chat' }} />
      <Tabs.Screen name="profile" options={{ title: 'You' }} />
    </Tabs>
  )
}
