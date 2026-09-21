/* =========================================================
   DM media viewer: the shared MessageMediaViewer with the
   conversation's own actions — forward, jump, delete for me.
   ========================================================= */
import React from 'react'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { api } from '@/api'
import { chatError } from '@/lib/chatErrors'
import { toast } from '@/ui'
import { MessageMediaViewer } from '@/components/chat/MessageMediaViewer'

export default function ViewerScreen() {
  const router = useRouter()
  const { id, messageId, index } = useLocalSearchParams<{ id: string; messageId: string; index?: string }>()
  const convId = String(id)

  return (
    <MessageMediaViewer
      messageId={String(messageId)}
      index={Number(index) || 0}
      extraActions={() => [
        {
          label: 'Forward',
          icon: 'forwardMsg',
          onPress: () => router.replace(`/chat/forward?messageId=${messageId}`),
        },
        {
          label: 'Jump to message',
          icon: 'chat',
          onPress: () => router.replace(`/chat/${convId}?jump=${messageId}`),
        },
        {
          label: 'Delete for me',
          icon: 'trash',
          destructive: true,
          onPress: async () => {
            try {
              await api.chat.messages.remove(messageId, 'me')
              router.back()
            } catch (e) { toast.error(chatError(e, 'Could not delete')) }
          },
        },
      ]}
    />
  )
}
