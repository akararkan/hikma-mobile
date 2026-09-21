/* =========================================================
   The detail page's header block. Stateless on purpose — the
   screen owns the question object so an SSE counter and an
   optimistic toggle cannot land in two different copies.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { RichText } from '@/lib/richtext'
import { Avatar, Chip, NumericText, Text, Touchable, VerifiedMark, formatCount } from '@/ui'
import { BarAction } from './buttons'
import { StatusPills } from './StatusPills'
import type { QuestionView } from './types'

export interface QuestionHeroProps {
  question: QuestionView
  isAuthor: boolean
  isAdmin: boolean
  shares: number
  saveCooldown?: number
  canAnswer: boolean
  onSave: () => void
  onLongPressSave: () => void
  onShare: () => void
  onAnswer: () => void
  onMore: () => void
  onEdit: () => void
  onManage: () => void
  onAuthorPress: () => void
  onTagPress: (tag: string) => void
  onMentionPress: (handle: string) => void
}

export function QuestionHero(p: QuestionHeroProps) {
  const t = useTheme()
  const c = t.colors
  const q = p.question
  const a = q._author

  return (
    <View style={{ borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.separator }}>
      <View style={{ padding: t.layout.screenPadding }}>
        <View style={styles.authorRow}>
          <Avatar uri={a.profileImage} name={a.full} seed={a.id} size={40} onPress={p.onAuthorPress} />
          <Touchable onPress={p.onAuthorPress} feedback="dim" noAutoHitSlop style={styles.flex}>
            <View style={styles.nameRow}>
              <Text variant="headline" numberOfLines={1} align="ui" style={styles.shrink}>{a.full}</Text>
              {a.verified ? <VerifiedMark size={15} /> : null}
            </View>
            <Text variant="footnote" tone="muted" numberOfLines={1} align="ui" style={{ marginTop: space.xxs }}>
              @{a.handle} · {q.time}{q.formattedDate ? ` · ${q.formattedDate}` : ''}
            </Text>
          </Touchable>
        </View>

        <Text variant="title2" align="auto" style={{ marginTop: space.md }}>{q.title}</Text>

        {q.body ? (
          <View style={{ marginTop: space.sm2 }}>
            <RichText
              body={q.body}
              onPressMention={p.onMentionPress}
              onPressTag={p.onTagPress}
            />
          </View>
        ) : null}

        {q.tags.length ? (
          <View style={[styles.wrap, { marginTop: space.md }]}>
            {q.tags.map(tag => <Chip key={tag} label={`#${tag}`} tone="accent" onPress={() => p.onTagPress(tag)} />)}
          </View>
        ) : null}

        <View style={{ marginTop: space.md }}>
          <StatusPills question={q} size="md" />
        </View>

        <View style={[styles.wrap, { marginTop: space.md, gap: space.lg }]}>
          <Metric value={q.views} label="views" />
          <Metric value={q.answers} label={q.answers === 1 ? 'answer' : 'answers'} />
          <Metric value={q.saves} label={q.saves === 1 ? 'save' : 'saves'} />
          <Metric value={p.shares} label={p.shares === 1 ? 'share' : 'shares'} />
        </View>
      </View>

      <View style={[styles.bar, { borderTopColor: c.separator }]}>
        <BarAction icon="edit" label="Answer" onPress={p.onAnswer} disabled={!p.canAnswer} />
        <View style={[styles.barDivider, { backgroundColor: c.separator }]} />
        <BarAction
          icon="bookmark"
          label={q.saved ? 'Saved' : 'Save'}
          active={q.saved}
          onPress={p.onSave}
          onLongPress={p.onLongPressSave}
          disabled={(p.saveCooldown ?? 0) > 0}
        />
        <View style={[styles.barDivider, { backgroundColor: c.separator }]} />
        <BarAction icon="share" label="Share" onPress={p.onShare} />
        <View style={[styles.barDivider, { backgroundColor: c.separator }]} />
        <BarAction icon="more" label="More" onPress={p.onMore} />
      </View>

      {p.isAuthor || p.isAdmin ? (
        <View style={[styles.ownerRow, { borderTopColor: c.separator }]}>
          <Chip label="Edit" icon="edit" tone="neutral" onPress={p.onEdit} />
          <Chip label="Answer settings" icon="settings" tone="neutral" onPress={p.onManage} />
        </View>
      ) : null}
    </View>
  )
}

function Metric({ value, label }: { value: number; label: string }) {
  return (
    <View style={styles.metric}>
      <NumericText variant="footnote" weight="600" tone="secondary">{formatCount(value)}</NumericText>
      <Text variant="footnote" tone="muted">{label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  authorRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs2 },
  shrink: { flexShrink: 1 },
  flex: { flex: 1 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.xs2 },
  metric: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  bar: { flexDirection: 'row', alignItems: 'stretch', borderTopWidth: StyleSheet.hairlineWidth, minHeight: 48 },
  barDivider: { width: StyleSheet.hairlineWidth, marginVertical: space.sm2 },
  ownerRow: { flexDirection: 'row', gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.sm, borderTopWidth: StyleSheet.hairlineWidth },
})
