/* =========================================================
   ResearchActionBar — the sticky bottom bar on a paper.

   Every optimistic toggle in the domain lives here, and each
   one has a different recovery because the endpoints answer
   differently:

     react    201 with an EMPTY body — the optimistic flip IS
              the state until the next get()
     unreact  200 with a fresh ResearchResponse — reconcile
     save     201/200 with a fresh ResearchResponse — reconcile
     cite     200 empty, deduped for 30 days, and the citer's
              own SSE event is actor-suppressed — so the share
              sheet re-reads get() rather than adding 1 here

   The published-only rule is the other half: reacting, saving,
   commenting and citing all answer 400 NOT_PUBLISHED on a
   draft. The bar is shaped around that instead of letting the
   user find out by tapping.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated'
import { adapters, api, codeOf, errorText, isConflict, isRateLimited } from '@/api'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { DoubleRule, Icon, NumericText, Sheet, Text, Touchable, fireHaptic, formatCount, toast, type IconName } from '@/ui'
import { SignInPrompt } from './states'
import { isBlockedInteraction } from './ResearchCard'
import { toggleSaveRemote } from './hooks'
import { useCooldown } from './hooks'
import type { Metrics, ResearchDetail, ResearchStatus } from './types'
import { to } from './nav'

export interface ActionBarPatch {
  liked?: boolean
  saved?: boolean
  metrics?: Metrics
}

export function ResearchActionBar({
  researchId, liked, saved, metrics, status, commentsEnabled, isOwner, signedIn,
  onChange, onOpenShare, onOpenSave, onOpenComments, onOpenCite,
}: {
  researchId: string
  liked: boolean
  saved: boolean
  metrics: Metrics
  status: ResearchStatus | string
  commentsEnabled: boolean
  isOwner: boolean
  signedIn: boolean
  onChange: (patch: ActionBarPatch) => void
  onOpenShare: () => void
  onOpenSave: () => void
  onOpenComments: () => void
  onOpenCite: () => void
}) {
  const t = useTheme()
  const c = t.colors
  const insets = useSafeAreaInsets()
  const router = useRouter()

  const [cooldown, startCooldown] = useCooldown()
  const [blocked, setBlocked] = React.useState<string | null>(null)
  const [notPublished, setNotPublished] = React.useState<string | null>(null)
  const [signInFor, setSignInFor] = React.useState<string | null>(null)

  const heart = useSharedValue(1)
  const heartStyle = useAnimatedStyle(() => ({ transform: [{ scale: heart.value }] }))
  const pop = () => {
    if (t.prefs.reducedMotion) return
    heart.value = withTiming(1.28, { duration: t.ms(110) }, () => {
      heart.value = withSpring(1, t.motion.spring)
    })
  }

  const published = String(status || '').toUpperCase() === 'PUBLISHED'

  const guard = (what: string): boolean => {
    if (!signedIn) { setSignInFor(what); return false }
    return true
  }

  const failed = (e: any) => {
    if (isRateLimited(e)) { startCooldown(e); return }
    if (isBlockedInteraction(e)) { setBlocked(errorText(e)); return }
    if (codeOf(e) === 'NOT_PUBLISHED') { setNotPublished(errorText(e)); return }
    toast.error(errorText(e))
  }

  const like = async () => {
    if (!guard('like this paper') || cooldown > 0) return
    const next = !liked
    onChange({ liked: next, metrics: { ...metrics, reactions: Math.max(0, metrics.reactions + (next ? 1 : -1)) } })
    if (next) { fireHaptic('light'); pop() }
    try {
      if (next) {
        await api.research.react(researchId)
        return
      }
      const mapped = adapters.researchDetailFrom(await api.research.unreact(researchId)) as ResearchDetail
      onChange({ liked: !!mapped.liked, metrics: { ...metrics, reactions: mapped.metrics.reactions } })
    } catch (e: any) {
      /* A 409 here means the server and the optimistic flip disagreed about the
         current state — one silent retry settles it before we blame the user. */
      if (isConflict(e)) {
        try {
          if (next) await api.research.react(researchId)
          else await api.research.unreact(researchId)
          return
        } catch { /* fall through to the revert */ }
      }
      onChange({ liked, metrics })
      failed(e)
    }
  }

  const save = async () => {
    if (!guard('save this paper') || cooldown > 0) return
    const next = !saved
    onChange({ saved: next, metrics: { ...metrics, saves: Math.max(0, metrics.saves + (next ? 1 : -1)) } })
    try {
      const patch = await toggleSaveRemote(researchId, next)
      onChange({ saved: patch.saved, metrics: { ...metrics, saves: patch.saves } })
      if (next) {
        toast.ok('Saved to Default', { label: 'Change collection', onPress: onOpenSave })
      }
    } catch (e: any) {
      onChange({ saved, metrics })
      failed(e)
    }
  }

  /* QELAT law 3: no blur anywhere. The dock is a solid `tabBarBg` plate and
     the separation is drawn — the DOUBLE RULE on its top edge, which is what
     replaces every piece of frosted chrome in the app (DESIGN.md §5.9). */
  const frame = [styles.bar, { paddingBottom: Math.max(insets.bottom, 8), backgroundColor: c.tabBarBg }]

  const body = (() => {
    if (notPublished) {
      return <Text variant="footnote" tone="muted" align="center" style={styles.note}>{notPublished}</Text>
    }
    if (!published) {
      if (!isOwner) return null
      return (
        <Touchable
          onPress={() => router.push(to(`/research/${researchId}/edit/publish`))}
          feedback="dim"
          style={styles.publishRow}
        >
          <Icon name="upload" size={18} color={c.accent} />
          <Text variant="subhead" weight="600" tone="accent" align="ui" style={styles.flex}>
            Publish to enable reactions, comments and downloads
          </Text>
          <Icon name="forward" size={16} color={c.accent} />
        </Touchable>
      )
    }
    return (
      <View style={styles.actions}>
        <BarAction
          icon="heart" filled={liked} label={formatCount(metrics.reactions)}
          color={liked ? c.like : c.textSecondary}
          onPress={like} disabled={cooldown > 0} cooldown={cooldown}
          accessibilityLabel={liked ? 'Unlike' : 'Like'}
          animatedStyle={heartStyle}
        />
        <BarAction
          icon="comment" label={formatCount(metrics.comments)}
          color={commentsEnabled ? c.textSecondary : c.textFaint}
          onPress={commentsEnabled ? onOpenComments : () => toast.info('Comments are turned off for this paper.')}
          accessibilityLabel="Comments"
        />
        <BarAction
          icon="bookmark" filled={saved} label={formatCount(metrics.saves)}
          color={saved ? c.accent : c.textSecondary}
          onPress={save} onLongPress={onOpenSave} disabled={cooldown > 0} cooldown={cooldown}
          accessibilityLabel={saved ? 'Remove from saved' : 'Save'}
        />
        <BarAction
          icon="cite" label={formatCount(metrics.citations)} color={c.textSecondary}
          onPress={() => { if (guard('cite this paper')) onOpenCite() }}
          accessibilityLabel="Cite"
        />
        <BarAction icon="share" color={c.textSecondary} onPress={onOpenShare} accessibilityLabel="Share" />
      </View>
    )
  })()

  if (!body) return null

  const content = (
    <>
      {blocked ? (
        <Text variant="caption" tone="muted" align="center" style={styles.blocked}>{blocked}</Text>
      ) : null}
      {body}
    </>
  )

  return (
    <>
      <View style={frame}>
        <DoubleRule style={styles.edge} />
        {content}
      </View>

      <Sheet visible={!!signInFor} onClose={() => setSignInFor(null)} bare maxHeightRatio={0.6} scrollable={false}>
        <SignInPrompt message={`Sign in to ${signInFor}.`} />
      </Sheet>
    </>
  )
}

function BarAction({
  icon, label, color, filled, onPress, onLongPress, disabled, cooldown, accessibilityLabel, animatedStyle,
}: {
  icon: IconName
  label?: string
  color: string
  filled?: boolean
  onPress: () => void
  onLongPress?: () => void
  disabled?: boolean
  cooldown?: number
  accessibilityLabel: string
  animatedStyle?: any
}) {
  return (
    <Touchable
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled}
      feedback="scale"
      noAutoHitSlop
      accessibilityLabel={accessibilityLabel}
      style={styles.action}
    >
      <Animated.View style={animatedStyle}>
        <Icon name={icon} size={22} color={color} filled={filled} />
      </Animated.View>
      {disabled && cooldown ? (
        <Text variant="micro" tone="faint">{cooldown}s</Text>
      ) : label ? (
        <NumericText variant="caption" tone="muted">{label}</NumericText>
      ) : null}
    </Touchable>
  )
}

const styles = StyleSheet.create({
  bar: { paddingTop: space.sm },
  /* The rule sits ON the plate's top edge, so the bar carries no border of
     its own — one course would fight the double rule's two. */
  edge: { position: 'absolute', top: 0, start: 0, end: 0 },
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', paddingHorizontal: space.sm },
  action: { alignItems: 'center', gap: space.xs, minWidth: 54, paddingVertical: space.xs },
  publishRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm2, paddingHorizontal: space.lg, paddingVertical: space.sm2 },
  note: { paddingHorizontal: space.lg, paddingVertical: space.md2 },
  blocked: { paddingHorizontal: space.lg, paddingBottom: space.xs2 },
  flex: { flex: 1 },
})
