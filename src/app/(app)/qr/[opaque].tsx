/* =========================================================
   QR result.

   The deep-link target for every scanned or shared Hikmah Web code —
   `qrAppLink` produces `/qr/{token}` and `extractQrToken` parses
   it back, so this route existing is what keeps those links
   from being dead.

   One rule dominates the error handling: a token that resolves
   to nobody and a real user with QR sharing switched off return
   the SAME 404, deliberately, so the response cannot be used to
   probe someone's discovery settings. This screen must not
   undo that by telling the two apart — there is one message for
   both, and no retry button, because retrying will produce the
   identical answer.
   ========================================================= */
import React from 'react'
import { View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { api, isNotFound } from '@/api'
import { extractQrToken } from '@/lib/qrToken.js'
import { FollowButton } from '@/components/search/FollowButton'
import { useAsync } from '@/hooks/useAsync'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  Avatar, Button, Card, EmptyState, ErrorState, Header, Screen, ScreenScroll,
  Skeleton, Text, VerifiedMark, formatCount,
} from '@/ui'

export default function QrResultScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const { opaque } = useLocalSearchParams<{ opaque: string }>()

  /* A deep link can arrive with the whole URL in the segment, so it goes
     through the same parser the scanner uses rather than a second one. */
  const token = React.useMemo(() => extractQrToken(opaque) || String(opaque || ''), [opaque])

  const user = useAsync<any>(
    () => api.settings.discovery.resolveQr(token),
    { enabled: !!token, deps: [token] },
  )

  const close = () => {
    if (router.canGoBack()) router.back()
    else router.replace('/settings/scan')
  }

  /* One message for both 404 variants — see the header. */
  if (user.error && isNotFound(user.error)) {
    return (
      <Screen background="sunken">
        <Header closeButton back={close} title="Code" />
        <EmptyState
          icon="qr"
          title="This code doesn't work any more"
          message="It may have been replaced, or the account it points to isn't sharing a code."
          actionLabel="Scan another"
          onAction={() => router.replace('/settings/scan')}
          secondaryLabel="Close"
          onSecondary={close}
        />
      </Screen>
    )
  }

  return (
    <Screen background="sunken">
      <Header closeButton back={close} title="Scanned code" />
      <ScreenScroll contentContainerStyle={{ padding: t.layout.screenPadding }}>
        {user.loading ? (
          <Card variant="outlined" padding={0} style={{ overflow: 'hidden' }}>
            <Skeleton height={96} radius={0} />
            <View style={{ padding: space.lg, gap: space.sm2, marginTop: -space.xxxl }}>
              <Skeleton circle width={80} height={80} />
              <Skeleton width="52%" height={18} />
              <Skeleton width="34%" height={13} />
              <Skeleton width="88%" height={13} />
            </View>
          </Card>
        ) : user.error ? (
          <ErrorState error={user.error} onRetry={user.reload} />
        ) : !user.data ? (
          <EmptyState
            icon="qr"
            title="This code doesn't work any more"
            message="It may have been replaced, or the account it points to isn't sharing a code."
            actionLabel="Scan another"
            onAction={() => router.replace('/settings/scan')}
          />
        ) : (
          <>
            <Card variant="outlined" padding={0} style={{ overflow: 'hidden' }}>
              <View style={{ height: 96, backgroundColor: c.accentSoft }} />

              <View style={{ paddingHorizontal: space.lg, paddingBottom: space.lg, marginTop: -44 }}>
                <View style={{ borderWidth: 4, borderColor: c.surface, borderRadius: 999, alignSelf: 'flex-start' }}>
                  <Avatar
                    uri={user.data.profileImage}
                    name={user.data.full}
                    seed={user.data.id}
                    size={80}
                  />
                </View>

                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs2, marginTop: space.sm2 }}>
                  <Text variant="title2" align="ui" numberOfLines={1} style={{ flexShrink: 1 }}>
                    {user.data.full}
                  </Text>
                  {user.data.verified ? <VerifiedMark size={18} /> : null}
                </View>
                <Text variant="callout" tone="muted" align="ui" numberOfLines={1}>
                  @{user.data.handle}
                </Text>

                {user.data.bio ? (
                  <Text variant="callout" align="auto" numberOfLines={3} style={{ marginTop: space.sm2 }}>
                    {user.data.bio}
                  </Text>
                ) : null}

                <View style={{ flexDirection: 'row', gap: space.xxl, marginTop: space.md2 }}>
                  <View>
                    <Text variant="bodyStrong" align="ui">{formatCount(user.data.followers)}</Text>
                    <Text variant="caption" tone="muted" align="ui">Followers</Text>
                  </View>
                  <View>
                    <Text variant="bodyStrong" align="ui">{formatCount(user.data.following)}</Text>
                    <Text variant="caption" tone="muted" align="ui">Following</Text>
                  </View>
                </View>
              </View>
            </Card>

            <View style={{ gap: space.sm2, marginTop: space.lg2 }}>
              <Button
                label="View profile"
                variant="primary"
                size="lg"
                block
                onPress={() => router.replace(`/user/${user.data.id}`)}
              />
              {/* The pill reads its own state from social-status — the view
                  user's `isFollowing` is false on every non-profile row. */}
              <View style={{ alignSelf: 'stretch', alignItems: 'center' }}>
                <FollowButton userId={String(user.data.id)} name={user.data.full} size="md" />
              </View>
              <Button
                label="Scan another"
                variant="ghost"
                size="md"
                block
                onPress={() => router.replace('/settings/scan')}
              />
            </View>
          </>
        )}
      </ScreenScroll>
    </Screen>
  )
}
