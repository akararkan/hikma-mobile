/* =========================================================
   RelationshipSheet — the overflow menu on a person.

   The copy in here is load-bearing and every line of it comes
   from documented behaviour:

     · blocking tears down the follow edges BOTH ways and
       unblocking does NOT restore them;
     · restricting is silent — the other account is never told,
       so nothing here may imply that it was;
     · mute lives in settings-privacy, not the social graph, so
       a block does not imply a mute and unblocking does not
       unmute.
   ========================================================= */
import React from 'react'
import { Share } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import { api, errorText } from '@/api'
import { WEB_ORIGIN } from '@/platform/env'
import { ActionSheet, ConfirmSheet, fireHaptic, toast, useSheetState } from '@/ui'
import { applySocialStatus, setMutedLocally, type SocialStatus } from './useSocialStatus'
import { ReportSheet } from './ReportSheet'

export interface RelationshipSheetProps {
  visible: boolean
  onClose: () => void
  user: { id: string; full?: string; handle?: string }
  status: SocialStatus | null
  /** Null until the muted-id list has been read. */
  muted: boolean | null
  onChange?: (next: SocialStatus) => void
  /** Extra actions the host screen owns — "Add to close friends", etc. */
  extra?: { label: string; icon?: any; onPress: () => void }[]
}

/** The shareable https link for a profile. Falls back to the handle alone when
 *  no web origin is configured — better a bare handle than a dead link. */
export function profileLink(handle?: string | null, id?: string) {
  const path = handle ? `/u/${handle}` : `/user/${id ?? ''}`
  return WEB_ORIGIN ? `${String(WEB_ORIGIN).replace(/\/$/, '')}${path}` : `@${handle || id || ''}`
}

export function RelationshipSheet({
  visible, onClose, user, status, muted, onChange, extra = [],
}: RelationshipSheetProps) {
  const block = useSheetState()
  const unblock = useSheetState()
  const restrict = useSheetState()
  const report = useSheetState()
  const [busy, setBusy] = React.useState(false)

  const name = user.handle ? `@${user.handle}` : (user.full || 'this account')
  const link = profileLink(user.handle, user.id)

  const run = React.useCallback(async (fn: () => Promise<any>, after?: (res: any) => void) => {
    if (busy) return
    setBusy(true)
    try {
      const res = await fn()
      after?.(res)
      fireHaptic('success')
    } catch (e: any) {
      fireHaptic('error')
      toast.error(errorText(e))
    } finally {
      setBusy(false)
    }
  }, [busy])

  const adopt = (res: any, fallback: Partial<SocialStatus>) => {
    onChange?.(applySocialStatus(user.id, res?.updatedStatus ?? fallback))
  }

  /* Mute is 204-both-ways and idempotent, so it flips locally first and only
     rolls back if the write actually fails. */
  const toggleMute = async () => {
    const next = !muted
    setMutedLocally(user.id, next)
    toast.ok(next ? `You will not see posts from ${name}` : `Unmuted ${name}`)
    try {
      if (next) await api.settings.privacy.muted.mute(user.id)
      else await api.settings.privacy.muted.unmute(user.id)
    } catch (e: any) {
      setMutedLocally(user.id, !next)
      toast.error(errorText(e))
    }
  }

  return (
    <>
      <ActionSheet
        visible={visible}
        onClose={onClose}
        title={user.full}
        subtitle={user.handle ? `@${user.handle}` : undefined}
        actions={[
          {
            label: 'Share profile',
            icon: 'share',
            onPress: () => { void Share.share({ message: link }) },
          },
          {
            label: 'Copy link',
            icon: 'copy',
            onPress: async () => { await Clipboard.setStringAsync(link); toast.ok('Link copied') },
          },
          ...extra,
          {
            label: muted ? 'Unmute' : 'Mute',
            icon: 'mutedBell',
            subtitle: muted ? undefined : 'You stop seeing their posts. They are not told.',
            disabled: muted === null,
            onPress: () => { void toggleMute() },
          },
          {
            label: status?.isRestricting ? 'Remove restriction' : 'Restrict',
            icon: 'eyeOff',
            subtitle: status?.isRestricting ? undefined : 'Limit them quietly. They are never told.',
            /* A block supersedes restrict — the server refuses to restrict an
               already-blocked account (400 RESTRICT_ALREADY_BLOCKED), so the
               action leaves the sheet while a block exists. */
            hidden: !status || (status.isBlocking && !status.isRestricting),
            onPress: () => {
              if (status?.isRestricting) {
                void run(() => api.users.unrestrict(user.id), res => adopt(res, { isRestricting: false }))
              } else {
                restrict.open()
              }
            },
          },
          {
            label: status?.isBlocking ? 'Unblock' : 'Block',
            icon: 'block',
            destructive: !status?.isBlocking,
            hidden: !status,
            onPress: () => (status?.isBlocking ? unblock.open() : block.open()),
          },
          {
            label: 'Report',
            icon: 'flag',
            destructive: true,
            onPress: () => report.open(),
          },
        ]}
      />

      <ConfirmSheet
        visible={block.visible}
        onClose={block.close}
        title={`Block ${name}?`}
        message={`They will not be able to follow you or see your posts, and any follows between you are removed. Unblocking later does not bring those follows back.`}
        confirmLabel="Block"
        icon="block"
        destructive
        loading={busy}
        onConfirm={() => {
          block.close()
          void run(() => api.users.block(user.id), res =>
            /* A block supersedes a restriction and tears down both follow
               edges, so nothing local may survive the response. */
            adopt(res, { isBlocking: true, isFollowing: false, isRestricting: false }))
        }}
      />

      <ConfirmSheet
        visible={unblock.visible}
        onClose={unblock.close}
        title={`Unblock ${name}?`}
        message="They will be able to follow you and see your posts again. The follows you had before the block are not restored."
        confirmLabel="Unblock"
        icon="unlock"
        loading={busy}
        onConfirm={() => {
          unblock.close()
          void run(() => api.users.unblock(user.id), res => adopt(res, { isBlocking: false }))
        }}
      />

      <ConfirmSheet
        visible={restrict.visible}
        onClose={restrict.close}
        title={`Restrict ${name}?`}
        message="Their interactions with you are limited quietly. They are not notified, and they can still follow you."
        confirmLabel="Restrict"
        icon="eyeOff"
        loading={busy}
        onConfirm={() => {
          restrict.close()
          void run(() => api.users.restrict(user.id), res => adopt(res, { isRestricting: true }))
        }}
      />

      <ReportSheet
        visible={report.visible}
        onClose={report.close}
        targetType="USER"
        targetId={user.id}
        subject={name}
      />
    </>
  )
}
