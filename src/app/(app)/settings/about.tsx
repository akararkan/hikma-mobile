/* =========================================================
   About.

   The version row is not decoration: `app.config()` carries
   `minSupportedVersion` and `forceUpdate`, and lib/version.js
   exists to compare the running client against them. This is
   where a user who has been told "update the app" can see what
   they are actually running.

   `/app/config` is permitAll, so the version read itself needs no
   session — but this screen sits under (app) and is reachable
   only when signed in. Enforcement of `forceUpdate` is NOT here:
   a notice a user has to go looking for cannot retire a build.
   That lives at the boot gate (src/components/system/UpdateGate).
   ========================================================= */
import React from 'react'
import { Linking, View } from 'react-native'
import { useRouter } from 'expo-router'
import * as Clipboard from 'expo-clipboard'
import { Image } from 'expo-image'
import { api, API_BASE } from '@/api'
import { APP_ENDONYMS, APP_NAME } from '@/lib/brand'
import { CLIENT_VERSION, CLIENT_BUILD, compareVersions } from '@/lib/version.js'
import { useAsync } from '@/hooks/useAsync'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  Callout, GroupFooter, GroupLabel, Header, ListRow, RowGroup,
  Screen, ScreenScroll, Text, Wordmark, toast,
} from '@/ui'

export default function AboutScreen() {
  const t = useTheme()
  const router = useRouter()
  const config = useAsync<any>(() => api.settings.app.config(), { deps: [] })

  const min = config.data?.minSupportedVersion
  const latest = config.data?.latestVersion
  const outdated = min ? compareVersions(CLIENT_VERSION, min) < 0 : false
  const behind = latest ? compareVersions(CLIENT_VERSION, latest) < 0 : false

  const versionLine = `${CLIENT_VERSION}${CLIENT_BUILD ? ` (${CLIENT_BUILD})` : ''}`

  return (
    <Screen background="sunken">
      <Header back title="About" />
      <ScreenScroll refreshing={config.refreshing} onRefresh={config.refresh}>
        <View style={{ alignItems: 'center', paddingVertical: 30, gap: space.xs2 }}>
          {/* THE MARK, not a monogram. This plate used to hold the three
              letters of the old name; a ten-letter one crushes to nothing at
              68pt, so it carries the app's own icon — which means it follows
              the brand automatically the day assets/images/icon.png changes. */}
          <View
            style={{
              width: 68, height: 68, borderRadius: 20,
              backgroundColor: t.colors.surface,
              borderWidth: t.rule.course,
              borderColor: t.colors.border,
              overflow: 'hidden',
            }}
          >
            <Image
              source={require('../../../../assets/images/icon.png')}
              style={{ width: 68, height: 68 }}
              contentFit="contain"
              accessibilityLabel={APP_NAME}
            />
          </View>
          <Wordmark size={19} style={{ marginTop: space.sm2 }} />
          <Text variant="footnote" tone="muted" align="center">{APP_ENDONYMS.join('  ·  ')}</Text>
          <Text variant="footnote" tone="muted" align="center">
            A place for Islamic research, questions and community.
          </Text>
        </View>

        {outdated ? (
          <View style={{ paddingHorizontal: t.layout.screenPadding, paddingBottom: space.xs }}>
            {/* `storeUrl` is not in the documented config shape, so the
                button appears only where a deployment actually sends one —
                and the copy still says what to do when it does not. */}
            <Callout
              tone="danger"
              title="This version is no longer supported"
              actionLabel={config.data?.storeUrl ? 'Update now' : undefined}
              onAction={config.data?.storeUrl ? () => void Linking.openURL(config.data.storeUrl) : undefined}
            >
              {config.data?.storeUrl
                ? 'Some things will stop working until you update.'
                : 'Some things will stop working until you update Hikmah Web from wherever you installed it.'}
            </Callout>
          </View>
        ) : behind ? (
          <View style={{ paddingHorizontal: t.layout.screenPadding, paddingBottom: space.xs }}>
            <Callout tone="info" title={`Version ${latest} is available`}>
              You're on {CLIENT_VERSION}.
            </Callout>
          </View>
        ) : null}

        <GroupLabel>This app</GroupLabel>
        <RowGroup>
          <ListRow
            title="Version"
            icon="info"
            iconTone="neutral"
            accessory={{ kind: 'value', text: versionLine, chevron: false }}
            onPress={async () => {
              await Clipboard.setStringAsync(`Hikmah Web ${versionLine} · ${API_BASE}`)
              toast.ok('Version details copied')
            }}
          />
          {latest ? (
            <ListRow
              title="Latest available"
              icon="upload"
              iconTone="neutral"
              accessory={{ kind: 'value', text: String(latest), chevron: false }}
            />
          ) : null}
          {min ? (
            <ListRow
              title="Minimum supported"
              icon="warning"
              iconTone={outdated ? 'danger' : 'neutral'}
              accessory={{ kind: 'value', text: String(min), chevron: false }}
            />
          ) : null}
        </RowGroup>
        <GroupFooter>Long-press the version row to copy it into a support message.</GroupFooter>

        <GroupLabel>Legal</GroupLabel>
        <RowGroup>
          <ListRow
            title="Terms, privacy & guidelines"
            icon="book"
            iconTone="neutral"
            accessory={{ kind: 'chevron' }}
            onPress={() => router.push('/settings/policies')}
          />
        </RowGroup>

        <GroupFooter>
          Connected to {API_BASE.replace(/^https?:\/\//, '')}
        </GroupFooter>
      </ScreenScroll>
    </Screen>
  )
}
