/* =========================================================
   The group permission matrix, computed BEFORE render.

   Every one of these questions has a server-side answer that
   comes back as a 403, and every 403 the user could have been
   spared is a bug: an action sheet that offers "Remove from
   group" to someone who cannot remove anyone has already
   failed, whatever the toast says afterwards.

   So the whole matrix lives here, the sheets ask it, and a
   permission 403 becomes unreachable rather than merely
   handled.

   The rules, from chat/api-reference.md:
     · an ADMIN can never act on the OWNER or on another ADMIN
     · DEMOTE and TRANSFER are OWNER-only
     · PROMOTE is OWNER always, ADMIN only when adminsCanPromote
     · the owner cannot leave while members remain
     · a CHANNEL is a group with an admins-only send mode
   ========================================================= */

export type Role = 'OWNER' | 'ADMIN' | 'MEMBER'
export type Scope = 'ALL_MEMBERS' | 'ADMINS_ONLY'

const roleOf = (v: any): Role => {
  const r = String(v || 'MEMBER').toUpperCase()
  return r === 'OWNER' || r === 'ADMIN' ? r : 'MEMBER'
}

export const isAdmin = (convo: any) => roleOf(convo?.myRole) !== 'MEMBER'
export const isOwner = (convo: any) => roleOf(convo?.myRole) === 'OWNER'
export const isRestricted = (convo: any) => String(convo?.myStatus || '') === 'RESTRICTED'

/** A scoped group setting. Absent means the permissive default. */
function allows(convo: any, key: string, fallback: Scope = 'ALL_MEMBERS'): boolean {
  const scope = String(convo?.settings?.[key] || fallback).toUpperCase()
  return scope === 'ADMINS_ONLY' ? isAdmin(convo) : true
}

export const canSend = (convo: any) => {
  if (!convo) return false
  if (isRestricted(convo)) return false
  if (!convo.isGroup) return true
  return allows(convo, 'sendMode')
}

export const canAddMembers = (convo: any) => !!convo?.isGroup && allows(convo, 'whoCanAddMembers')
export const canEditInfo = (convo: any) => !!convo?.isGroup && allows(convo, 'whoCanEditInfo', 'ADMINS_ONLY')
export const canPin = (convo: any) => (convo?.isGroup ? allows(convo, 'whoCanPin', 'ADMINS_ONLY') : true)
export const canChangeSettings = (convo: any) => !!convo?.isGroup && isAdmin(convo)
export const canManageInvites = (convo: any) => !!convo?.isGroup && isAdmin(convo)

/** Slow mode throttles NON-ADMINS only, so the number alone never says whether
 *  the composer should count down. */
export const slowModeFor = (convo: any): number =>
  (!convo?.isGroup || isAdmin(convo)) ? 0 : Number(convo?.slowModeSeconds) || 0

/** Why the composer is dead, in the words the strip will show. `null` = live. */
export function composerBlockReason(convo: any): string | null {
  if (!convo) return null
  if (isRestricted(convo)) return 'You are restricted in this group — you can read but not post.'
  if (convo.isGroup && !allows(convo, 'sendMode')) {
    return convo.isChannel
      ? 'Only admins can post in this channel.'
      : 'Only admins can send messages here.'
  }
  return null
}

/* ---------------------------------------------------------
   Per-member actions on the roster.
   --------------------------------------------------------- */

export interface MemberRights {
  promote: boolean
  demote: boolean
  restrict: boolean
  unrestrict: boolean
  remove: boolean
  transfer: boolean
}

const NONE: MemberRights = {
  promote: false, demote: false, restrict: false, unrestrict: false, remove: false, transfer: false,
}

export function memberRights(convo: any, member: any, myId: string | null | undefined): MemberRights {
  if (!convo?.isGroup || !member) return NONE
  const me = roleOf(convo.myRole)
  if (me === 'MEMBER') return NONE
  /* Acting on yourself is Leave, which lives on the info screen. */
  if (myId && String(member.userId) === String(myId)) return NONE

  const target = roleOf(member.role)
  /* The one asymmetry that matters: an admin is powerless against the owner
     and against their peers, and only the owner can change that. */
  if (me === 'ADMIN' && target !== 'MEMBER') return NONE
  if (target === 'OWNER') return NONE

  const restricted = String(member.status || '') === 'RESTRICTED'
  const adminsCanPromote = convo.settings?.adminsCanPromote !== false

  return {
    promote: target === 'MEMBER' && (me === 'OWNER' || adminsCanPromote),
    demote: target === 'ADMIN' && me === 'OWNER',
    /* The owner can restrict anyone below them, admins included —
       GroupPermissions: RESTRICT_MEMBER → owner, or admin on a plain member.
       (An admin target reaches here only when me === OWNER; the guards above
       already returned NONE for admin-on-admin.) */
    restrict: !restricted,
    unrestrict: restricted,
    remove: true,
    /* Matches the server's transfer filter exactly: the target must be
       ACTIVE — a restricted member 404s as a transfer target. */
    transfer: me === 'OWNER' && !restricted,
  }
}

/* ---------------------------------------------------------
   Per-message actions.
   --------------------------------------------------------- */

export interface MessageRights {
  reply: boolean
  react: boolean
  copy: boolean
  forward: boolean
  star: boolean
  pin: boolean
  edit: boolean
  deleteForMe: boolean
  deleteForEveryone: boolean
  info: boolean
}

export function messageRights(convo: any, message: any, myId: string | null | undefined): MessageRights {
  const mine = !!myId && String(message?.senderId) === String(myId)
  const system = !!message?.isSystem
  const dead = !!message?.deleted
  const pending = !message?.id || String(message.id).startsWith('t')

  if (system) {
    return {
      reply: false, react: false, copy: false, forward: false, star: false,
      pin: false, edit: false, deleteForMe: false, deleteForEveryone: false, info: false,
    }
  }

  /* A channel with protectedContent set refuses every forward server-side, so
     the affordance is removed rather than left to fail. */
  const protectedContent = !!convo?.isChannel && !!convo?.settings?.protectedContent
  const reactionsOff = !!convo?.isChannel && convo?.settings?.reactionsEnabled === false

  return {
    reply: !dead && !pending && canSend(convo),
    react: !dead && !pending && !reactionsOff,
    copy: !dead && !!message?.body,
    forward: !dead && !pending && !protectedContent,
    star: !dead && !pending,
    pin: !dead && !pending && canPin(convo),
    edit: mine && !dead && !pending && message?.type === 'TEXT',
    deleteForMe: !pending,
    deleteForEveryone: !dead && !pending && (mine || (!!convo?.isGroup && isAdmin(convo))),
    info: !!convo?.isGroup && mine && !dead && !pending,
  }
}

/**
 * The confirm copy for conversations.remove — which means four different
 * things depending on who is asking. There is no NOT_OWNER branch server-side,
 * so choosing the wrong words here is the only way the user finds out.
 */
export function deleteConversationCopy(convo: any): { title: string; message: string; label: string } {
  if (convo?.isChannel) {
    return isOwner(convo)
      ? {
        title: 'Delete this channel?',
        message: 'This deletes the channel for everyone. The posts are retained but nobody can open it again.',
        label: 'Delete channel',
      }
      : { title: 'Leave this channel?', message: 'You will stop receiving its posts.', label: 'Leave' }
  }
  if (convo?.isGroup && isOwner(convo)) {
    return {
      title: 'Delete this group?',
      message: 'This deletes the group for everyone. The message history is retained but nobody can open it again.',
      label: 'Delete group',
    }
  }
  return {
    title: 'Delete this chat?',
    message: 'This removes it from your inbox. Everyone else keeps their copy.',
    label: 'Delete chat',
  }
}
