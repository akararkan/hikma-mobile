/* =========================================================
   Channel media viewer: a tap on a picture or a clip in a
   channel post opens it full-bleed, with the same pinch, pan
   and drag-to-dismiss as a DM attachment.

   The top bar names the CHANNEL, not the admin who posted —
   channel posts read as the channel's voice. A channel with
   protectedContent on removes save and share, the same rule
   the album's file chips already follow.
   ========================================================= */
import React from 'react'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { MessageMediaViewer } from '@/components/chat/MessageMediaViewer'
import { chRoute } from '@/components/channels/routes'

const visual = (m: any) => m.kind !== 'FILE' && m.kind !== 'VOICE'

export default function ChannelViewerScreen() {
  const router = useRouter()
  const { id, messageId, index, title, protected: prot } = useLocalSearchParams<{
    id: string; messageId: string; index?: string; title?: string; protected?: string
  }>()
  const channelId = String(id)
  const postId = String(messageId)

  return (
    <MessageMediaViewer
      messageId={postId}
      index={Number(index) || 0}
      title={m => title || m?.sender?.full || 'Channel'}
      canSave={prot !== '1'}
      /* MediaAlbum's grid indexes every non-FILE, non-VOICE attachment: a GIF
         is an image to expo-image and a round video note is a video. */
      isPageable={visual}
      extraActions={() => [
        ...(prot !== '1' ? [{
          label: 'Forward',
          icon: 'forwardMsg',
          onPress: () => router.replace(`/chat/forward?messageId=${postId}`),
        }] : []),
        {
          label: 'Open post',
          icon: 'chat',
          onPress: () => router.replace(chRoute.post(channelId, postId) as any),
        },
      ]}
    />
  )
}
