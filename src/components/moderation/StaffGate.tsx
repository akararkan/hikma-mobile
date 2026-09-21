/* =========================================================
   The staff-console gate and its refusal surface.

   `useRoleGate` answers 'deny' FINALLY — a rights refusal is
   not a wrong address, so there is no retry, no "try again"
   and no route back into the wall. The affordance ideally was
   never rendered; this is the backstop for a deep link.

   Role intersections on /api/v1/admin/** are real and narrow:
   the chain rule demands ADMIN | MODERATOR | SUPPORT | ANALYST
   before any @PreAuthorize runs, and `model.versions` is
   ADMIN | ANALYST and NOT moderator — a moderator gets a 403
   there while being allowed everywhere else on that controller.
   Each screen therefore names its own set rather than sharing
   one constant that would quietly widen.
   ========================================================= */
import React from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { Button, Header, Icon, Screen, SkeletonList, Text } from '@/ui'

export const MOD_CONSOLE_ROLES = ['ADMIN', 'SUPER_ADMIN', 'MODERATOR']
export const MOD_ANALYTICS_ROLES = ['ADMIN', 'SUPER_ADMIN', 'MODERATOR', 'ANALYST']
export const MOD_MODEL_ROLES = ['ADMIN', 'SUPER_ADMIN', 'ANALYST']
export const MOD_ADMIN_ROLES = ['ADMIN', 'SUPER_ADMIN']

/** The whole screen when the gate says no. Client copy: the server never got
 *  a chance to answer, and a 403 body would say the same thing less kindly. */
export function StaffRefusal({
  title = 'Review queue',
  message = "You don't have access to the moderation console.",
}: { title?: string; message?: string }) {
  const t = useTheme()
  const router = useRouter()
  return (
    <Screen background="sunken">
      <Header back title={title} />
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xxxl, gap: space.sm }}>
        <View
          style={{
            width: 62,
            height: 62,
            borderRadius: 999,
            backgroundColor: t.colors.surfaceSunken,
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: space.sm,
          }}
        >
          <Icon name="lock" size={26} color={t.colors.textFaint} />
        </View>
        <Text variant="title3" align="center">Not available to you</Text>
        <Text variant="callout" tone="muted" align="center" style={{ maxWidth: 320, marginTop: space.xxs }}>
          {message}
        </Text>
        {/* No retry. The answer will not change on a second tap. */}
        <Button
          label="Go back"
          onPress={() => { if (router.canGoBack()) router.back() }}
          variant="tinted"
          style={{ marginTop: space.lg }}
        />
      </View>
    </Screen>
  )
}

/** The 'loading' arm — the gate resolves after the boot /users/me settles, and
 *  routing on an unknown role flashes the refusal at a moderator. */
export function StaffGateLoading({ title }: { title: string }) {
  return (
    <Screen background="sunken">
      <Header back title={title} />
      <SkeletonList count={5} />
    </Screen>
  )
}
