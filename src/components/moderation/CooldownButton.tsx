/* =========================================================
   CooldownButton — the 429 contract in one control.

   Pairs with `useCooldown()`: the catch block calls
   `startCooldown(e)` (a no-op unless the error really is a
   429), and this button counts the server's own hint down and
   stays disabled until it reaches zero.

   Two things it deliberately does NOT do:

     · auto-retry. A rate limit answered by a timer is how one
       throttled client becomes a thundering herd.
     · clear anything. The draft, the selection and every field
       survive the wait — the user did nothing wrong.

   http.js already flashes a toast for EVERY 429, so a screen
   pairs this button with an INLINE strip and never toasts the
   same failure twice.
   ========================================================= */
import React from 'react'
import type { StyleProp, ViewStyle } from 'react-native'
import { Button, type ButtonSize } from '@/ui'

export interface CooldownButtonProps {
  label: string
  /** Seconds left, straight from `useCooldown()`. */
  cooldown: number
  pending?: boolean
  disabled?: boolean
  onPress: () => void
  tone?: 'primary' | 'destructive' | 'secondary'
  size?: ButtonSize
  block?: boolean
  icon?: React.ComponentProps<typeof Button>['icon']
  style?: StyleProp<ViewStyle>
}

export function CooldownButton({
  label, cooldown, pending = false, disabled = false, onPress,
  tone = 'primary', size = 'lg', block = true, icon, style,
}: CooldownButtonProps) {
  const waiting = cooldown > 0
  return (
    <Button
      label={waiting ? `Wait ${cooldown}s` : label}
      onPress={onPress}
      variant={tone === 'destructive' ? 'danger' : tone === 'secondary' ? 'secondary' : 'primary'}
      size={size}
      block={block}
      icon={waiting ? 'hourglass' : icon}
      loading={pending}
      disabled={disabled || pending || waiting}
      style={style}
    />
  )
}
