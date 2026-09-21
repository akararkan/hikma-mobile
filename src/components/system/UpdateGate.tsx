/* =========================================================
   The client version gate.

   about-policy.md §19 calls GET /api/v1/app/config "the only
   reliable way to retire a client that has a security defect —
   the client version-gates itself against it before login". The
   app read the config on the About screen and printed a banner,
   which is a notice, not a gate: a retired build kept working.

   Two severities, and they are the config's own two fields:

     forceUpdate  → a wall. No dismiss, no route past it. This is
                    the security-defect case, and it has to hold
                    for a signed-IN user too, which is why the
                    gate lives at the boot node both branches
                    pass through rather than in (auth).
     outdated     → a warning the reader can put away. Remembered
                    for the session so a cold boot does not nag.

   FAILS OPEN, always. A config read that errors, times out, or
   is still in flight lets the app through untouched — the one
   thing worse than an out-of-date client is a client that cannot
   start because it could not reach the server to ask.
   ========================================================= */
import React from 'react'
import { Linking, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { api } from '@/api'
import { useAsync } from '@/hooks/useAsync'
import { CLIENT_VERSION, compareVersions } from '@/lib/version.js'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { Button, Callout, Icon, Screen, Text } from '@/ui'

export interface UpdateVerdict {
  /** A wall: nothing may render behind it. */
  blocking: boolean
  /** Behind the floor, but the operator has not made it mandatory. */
  outdated: boolean
  latest: string | null
  storeUrl: string | null
}

/** Read the gate. Never throws, never blocks: an unavailable config resolves
 *  to "nothing to say". */
export function useUpdateVerdict(): UpdateVerdict & { ready: boolean } {
  const config = useAsync<any>(() => api.settings.app.config(), { deps: [] })
  const data = config.data

  const min = data?.minSupportedVersion
  const outdated = min ? compareVersions(CLIENT_VERSION, min) < 0 : false
  return {
    ready: !!data,
    outdated,
    blocking: outdated && data?.forceUpdate === true,
    latest: data?.latestVersion || null,
    /* Undocumented and absent in practice, but harmless to prefer when a
       deployment does send one — otherwise the button is simply not offered
       rather than opening nothing. */
    storeUrl: data?.storeUrl || null,
  }
}

/** The wall. Rendered INSTEAD of the app, so it takes the whole screen. */
export function UpdateWall({ latest, storeUrl }: { latest: string | null; storeUrl: string | null }) {
  const t = useTheme()
  const c = t.colors
  const insets = useSafeAreaInsets()

  return (
    <Screen background="sunken">
      <View style={[styles.center, { padding: t.layout.screenPadding }]}>
        <View style={[styles.medallion, { backgroundColor: c.dangerSoft }]}>
          <Icon name="warning" size={30} color={c.danger} />
        </View>
        <Text variant="title2" align="center" style={styles.title}>Time to update</Text>
        <Text variant="callout" tone="secondary" align="center" style={styles.body}>
          {latest
            ? `This version of Hikmah Web can no longer connect safely. Version ${latest} is available.`
            : 'This version of Hikmah Web can no longer connect safely. Please install the latest version to carry on.'}
        </Text>
        <Text variant="footnote" tone="faint" align="center" style={styles.body}>
          You are on {CLIENT_VERSION}.
        </Text>
      </View>

      {/* Bottom-anchored, so it owns the inset — Android is edge-to-edge. */}
      <View style={{ paddingHorizontal: t.layout.screenPadding, paddingBottom: insets.bottom + 16 }}>
        {storeUrl ? (
          <Button
            label="Update now"
            variant="primary"
            size="lg"
            block
            onPress={() => { void Linking.openURL(storeUrl).catch(() => {}) }}
          />
        ) : (
          /* No store url configured: say how to get out rather than offering a
             button that opens nothing. */
          <Callout tone="info">
            Update Hikmah Web from wherever you installed it, then open the app again.
          </Callout>
        )}
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  medallion: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  title: { marginTop: space.lg2 },
  body: { marginTop: space.sm, maxWidth: 320 },
})
