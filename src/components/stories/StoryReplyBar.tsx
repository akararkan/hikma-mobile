/* =========================================================
   StoryReplyBar — the composer on someone else's story.

   IMPORTANT: there is NO story-reply and NO story-reaction
   endpoint. Both paths send an ordinary direct message. Since
   2026-08-23 the reply carries the story's deep link under the
   text (lib/shareLinks grammar), so the RECIPIENT's bubble
   unfurls a story card — real context on the wire, not a
   fabricated quote. Reactions stay bare emoji.
   ========================================================= */
import React from 'react'
import { StyleSheet, TextInput, View } from 'react-native'
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated'
import { api, errorText } from '@/api'
import { shareMessageBody } from '@/lib/shareLinks'
import { useTheme } from '@/theme/ThemeProvider'
import { Icon, Text, Touchable, fireHaptic, toast } from '@/ui'
import { setback, shape, space } from '@/theme/tokens'
import { ink } from './night'

export const QUICK_REACTIONS = ['❤️', '🔥', '👏', '😮', '😢', '😂', '🤲', '💯'] as const

export interface StoryReplyBarProps {
  author: { id: string; full: string } | null
  onSend: (text: string) => void | Promise<void>
  onReact: (emoji: string) => void | Promise<void>
  onFocusChange?: (focused: boolean) => void
  /** Bump to open the composer from outside — the viewer's swipe-up. */
  focusSignal?: number
  disabled?: boolean
}

export function StoryReplyBar({ author, onSend, onReact, onFocusChange, focusSignal = 0, disabled }: StoryReplyBarProps) {
  const t = useTheme()
  const [text, setText] = React.useState('')
  const [focused, setFocused] = React.useState(false)
  const input = React.useRef<TextInput>(null)

  const focus = (v: boolean) => { setFocused(v); onFocusChange?.(v) }

  const first = React.useRef(true)
  React.useEffect(() => {
    if (first.current) { first.current = false; return }
    input.current?.focus()
  }, [focusSignal])

  const send = () => {
    const body = text.trim()
    if (!body) return
    setText('')
    fireHaptic('light')
    void onSend(body)
  }

  return (
    <View style={{ gap: space.md2 }}>
      {focused ? (
        <Animated.View style={styles.reactions}>
          {QUICK_REACTIONS.map(e => (
            <EmojiButton key={e} emoji={e} onPress={() => onReact(e)} />
          ))}
        </Animated.View>
      ) : null}

      {focused && author ? (
        <Text variant="caption" color={ink.muted} align="ui" style={{ paddingHorizontal: space.xs2 }}>
          Replying to {author.full}’s story — they’ll get it as a message.
        </Text>
      ) : null}

      <View style={styles.row}>
        <View style={[styles.pill, { borderColor: focused ? ink.full : ink.soft }]}>
          <TextInput
            ref={input}
            value={text}
            onChangeText={setText}
            onFocus={() => focus(true)}
            onBlur={() => focus(false)}
            placeholder="Send message"
            placeholderTextColor={ink.soft}
            style={[styles.input, { color: ink.full }]}
            selectionColor={t.colors.accent}
            returnKeyType="send"
            onSubmitEditing={send}
            editable={!disabled}
            maxLength={2000}
          />
        </View>
        <Touchable
          onPress={send}
          disabled={disabled || !text.trim()}
          feedback="scale"
          noAutoHitSlop
          accessibilityLabel="Send message"
          style={styles.sendBtn}
        >
          <Icon name="share" size={22} color={text.trim() ? ink.full : ink.soft} />
        </Touchable>
      </View>
    </View>
  )
}

function EmojiButton({ emoji, onPress }: { emoji: string; onPress: () => void }) {
  const t = useTheme()
  const scale = useSharedValue(1)
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }))
  return (
    <Touchable
      onPress={() => {
        fireHaptic('light')
        scale.value = t.prefs.reducedMotion
          ? 1
          : withSequence(withSpring(1.35, t.motion.spring), withTiming(1, { duration: t.ms(160) }))
        onPress()
      }}
      feedback="none"
      accessibilityLabel={`React ${emoji}`}
      style={styles.emojiHit}
    >
      <Animated.View style={anim}>
        <Text align="center" style={styles.emoji}>{emoji}</Text>
      </Animated.View>
    </Touchable>
  )
}

/* ---------------------------------------------------------
   The send half. One conversation per author per session —
   createDirect is idempotent server-side but a round trip per
   emoji is a round trip nobody asked for.
   --------------------------------------------------------- */

export function useStoryDM() {
  const cache = React.useRef(new Map<string, string>())

  /* `contextUrl` is the story's own deep link (lib/shareLinks grammar). With
     it, the reply travels as caption + link — so the RECIPIENT's bubble
     unfurls a story card above the text instead of receiving a context-free
     message. Without it, behaviour is the old bare TEXT. */
  return React.useCallback(async (authorId: string, body: string, contextUrl?: string) => {
    if (!authorId || !body) return
    try {
      let convId = cache.current.get(String(authorId))
      if (!convId) {
        const convo = await api.chat.conversations.createDirect(authorId)
        convId = String(convo?.id || '')
        if (!convId) throw new Error('No conversation')
        cache.current.set(String(authorId), convId)
      }
      const wire = contextUrl ? shareMessageBody(contextUrl, body) : body
      await api.chat.messages.send(convId, { clientNonce: api.chat.newNonce(), type: 'TEXT', body: wire } as any)
      toast.ok('Sent')
    } catch (e: any) {
      /* A failed reply is worth saying out loud: the user watched it leave. */
      toast.error(errorText(e))
    }
  }, [])
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  /* A composer well, so it wears the field setback with a drawn outline —
     named `pill` from before QELAT. */
  pill: {
    flex: 1,
    height: 44,
    ...setback(shape.buttonLg),
    borderCurve: 'continuous',
    borderWidth: 1,
    justifyContent: 'center',
  },
  input: { fontSize: 15, paddingHorizontal: space.lg, paddingVertical: 0, height: 44 },
  sendBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  reactions: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: space.xs },
  emojiHit: { width: 38, height: 44, alignItems: 'center', justifyContent: 'center' },
  emoji: { fontSize: 30, lineHeight: 38 },
})
