/* =========================================================
   The membership CTA.

   There are THREE membership states, not two: `subscribed`,
   `pendingJoinRequest`, and neither. A channel with
   `settings.joinByRequest` reads "Request to join" up front and
   lands on "Requested" — flipping it to "Subscribed" and then
   correcting itself a moment later is worse than being slow.

   A 403 here is final (a private channel, a frozen channel), so
   the control disables itself for the session rather than
   inviting the user to hit the same wall again.
   ========================================================= */
import React from 'react'
import { api, errorText, isNotFound } from '@/api'
import { Button, toast, type ButtonSize, type ButtonVariant } from '@/ui'

export interface SubscribeButtonProps {
  channel: any
  size?: ButtonSize
  block?: boolean
  /** Fires with the fresh channelFrom (or a locally patched copy). */
  onChanged?: (channel: any) => void
  /** Tapping while subscribed opens the membership menu instead of leaving. */
  onOpenMembership?: () => void
  variant?: ButtonVariant
}

export function SubscribeButton({
  channel, size = 'md', block, onChanged, onOpenMembership, variant,
}: SubscribeButtonProps) {
  const [busy, setBusy] = React.useState(false)
  const [refused, setRefused] = React.useState(false)

  const subscribed = !!channel?.subscribed
  const pending = !!channel?.pendingJoinRequest
  const byRequest = !!channel?.settings?.joinByRequest

  const label = subscribed ? 'Subscribed' : pending ? 'Requested' : byRequest ? 'Request to join' : 'Subscribe'

  const run = async () => {
    if (subscribed) { onOpenMembership?.(); return }
    if (pending || refused) return
    setBusy(true)
    /* Optimistic to the state the server is going to pick, so a slow network
       does not make the tap feel lost. */
    onChanged?.({ ...channel, ...(byRequest ? { pendingJoinRequest: true } : { subscribed: true }) })
    try {
      const fresh = await api.channels.subscribe(channel.id)
      onChanged?.(fresh)
    } catch (e: any) {
      onChanged?.(channel)
      if (e?.status === 403) setRefused(true)
      toast.error(errorText(e))
      /* 404 family (the backend answers CONVERSATION_NOT_FOUND) — the channel
         is gone, so re-offering the same tap would only repeat the answer. */
      if (isNotFound(e)) setRefused(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button
      label={refused ? 'Private' : label}
      onPress={run}
      loading={busy}
      disabled={pending || refused}
      variant={variant ?? (subscribed ? 'secondary' : 'primary')}
      size={size}
      block={block}
      icon={subscribed ? 'check' : undefined}
    />
  )
}
