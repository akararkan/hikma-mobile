/* =========================================================
   Publishing — the lifecycle console.

   The one thing this screen exists to get right: `publish` can
   answer 200 with the paper STILL DRAFT. That is a moderation
   HOLD, not a success, and nothing will ever tell us it
   cleared — there is no moderation event on any stream. So a
   hold swaps the hero for ModerationNotice and re-reads itself
   on the documented back-off, escalating to "under review" at
   the entity ceiling.

   The screen also subscribes to the paper's stream so a
   SCHEDULED auto-publish landing while it is open flips the
   status live.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import DateTimePicker from '@react-native-community/datetimepicker'
import { adapters, api, codeOf, errorText, isConflict, isNotFound } from '@/api'
import { heldPublish, isUnderReview, moderationText, recheckDelays } from '@/lib/moderation'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  Button, Callout, ConfirmSheet, Divider, Field, Header, Icon, Screen, ScreenScroll, Sheet,
  Skeleton, Text, Touchable, toast, useSheetState,
} from '@/ui'
import { ModerationNotice, ErrorPanel, GoneState, RefusalState } from '@/components/research/states'
import { StatusPill, isScheduled, statusTone } from '@/components/research/StatusPill'
import { useHoldRecheck, useResearchDetail } from '@/components/research/hooks'
import { formatDate, formatDateTime } from '@/components/research/format'
import { to } from '@/components/research/nav'
import type { ResearchDetail } from '@/components/research/types'

type Lifecycle = 'publish' | 'unpublish' | 'archive' | 'retract' | 'unretract'

export default function PublishingScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const { detail, error, loading, reload, patch, held, setHeld } = useResearchDetail(id, { subscribe: true, recordView: false })

  const [busy, setBusy] = React.useState<Lifecycle | null>(null)
  const [notice, setNotice] = React.useState<{ tone: 'warning' | 'danger'; text: string } | null>(null)
  const [checklistError, setChecklistError] = React.useState<Record<string, string>>({})
  const [scheduleAt, setScheduleAt] = React.useState<Date | null>(null)
  const [scheduleError, setScheduleError] = React.useState<string | null>(null)

  const confirm = useSheetState<{ action: Lifecycle; title: string; message: string; destructive?: boolean }>()
  const scheduleSheet = useSheetState()
  const deleteSheet = useSheetState()
  const [confirmTitle, setConfirmTitle] = React.useState('')

  useHoldRecheck(!!held, recheckDelays('RESEARCH'), () => { void reload() }, () => setHeld('review'))

  React.useEffect(() => {
    if (held && detail?.status === 'PUBLISHED') { setHeld(null); toast.ok('Published') }
  }, [held, detail?.status, setHeld])

  const apply = async (action: Lifecycle) => {
    setBusy(action)
    setNotice(null)
    setChecklistError({})
    try {
      const raw = await api.research[action](id)
      const fresh = adapters.researchDetailFrom(raw) as ResearchDetail
      patch(() => fresh)
      /* unretract IS publish on the wire (see api/research.js) — a republished
         retracted paper re-runs the moderation gate and can come back held. */
      if ((action === 'publish' || action === 'unretract') && heldPublish(raw)) { setHeld('checking'); return }
      toast.ok(
        action === 'publish' ? 'Published'
          : action === 'unpublish' ? 'Back to draft'
            : action === 'archive' ? 'Archived'
              : action === 'retract' ? 'Retracted' : 'Republished',
      )
    } catch (e: any) {
      const code = codeOf(e)
      if (isUnderReview(e)) { setNotice({ tone: 'warning', text: moderationText(e) }); return }
      if (code === 'MISSING_TITLE') { setChecklistError({ title: errorText(e) }); return }
      if (code === 'MISSING_ABSTRACT') { setChecklistError({ abstract: errorText(e) }); return }
      if (['ALREADY_PUBLISHED', 'ALREADY_ARCHIVED', 'NOT_PUBLISHED'].includes(code)) {
        /* The state moved under us — the server is right; re-read and say so
           once rather than parking an error panel. */
        toast.info(errorText(e))
        void reload()
        return
      }
      if (isConflict(e)) { void reload(); return }
      setNotice({ tone: 'danger', text: errorText(e) })
    } finally {
      setBusy(null)
      confirm.close()
    }
  }

  const schedule = async () => {
    if (!scheduleAt) return
    if (scheduleAt.getTime() <= Date.now()) {
      setScheduleError('Scheduled publish time must be in the future.')
      return
    }
    try {
      const raw = await api.research.update(id, { scheduledPublishAt: scheduleAt.toISOString() })
      patch(() => adapters.researchDetailFrom(raw) as ResearchDetail)
      scheduleSheet.close()
      toast.ok(`Scheduled for ${formatDateTime(scheduleAt.toISOString())}`)
    } catch (e: any) {
      setScheduleError(errorText(e))
    }
  }

  const remove = async () => {
    try {
      await api.research.remove(id)
      deleteSheet.close()
      toast.ok('Paper deleted.')
      router.dismissAll()
    } catch (e: any) {
      toast.error(errorText(e))
    }
  }

  if (error && isNotFound(error)) {
    return <Screen><Header back title="Publishing" /><GoneState onAction={() => router.replace(to('/research'))} /></Screen>
  }
  if (error?.status === 403) {
    return (
      <Screen>
        <Header back title="Publishing" />
        <RefusalState title="You do not own this paper." body="Only the corresponding researcher can publish it." />
      </Screen>
    )
  }
  if (loading || !detail) {
    return (
      <Screen>
        <Header back title="Publishing" />
        <View style={{ padding: space.lg, gap: space.md2 }}>
          <Skeleton height={120} radius={16} />
          {[0, 1, 2, 3, 4, 5].map(i => <Skeleton key={i} height={34} radius={10} />)}
          <Skeleton height={56} radius={14} />
        </View>
      </Screen>
    )
  }

  const status = detail.status
  const scheduled = isScheduled(status, detail.scheduledPublishAt)
  const tone = statusTone(status, scheduled)
  const heroBg =
    tone === 'success' ? c.successSoft
      : tone === 'danger' ? c.dangerSoft
        : tone === 'warning' ? c.warningSoft
          : c.surfaceSunken

  const dateLine =
    scheduled ? `Scheduled for ${formatDateTime(detail.scheduledPublishAt)}`
      : status === 'PUBLISHED' ? `Published ${formatDate(detail.publishedAt || detail.createdAt)}`
        : status === 'ARCHIVED' ? 'Archived — readable by link only'
          : status === 'RETRACTED' ? 'Retracted — readable for citation integrity'
            : 'Not published yet'

  const meaning =
    status === 'PUBLISHED' ? 'Listed in feeds and search, and open to reactions, comments and downloads.'
      : status === 'ARCHIVED' ? 'Hidden from feeds and search. Anyone with the link can still read it.'
        : status === 'RETRACTED' ? 'Readers see a retraction banner. The paper and its citations stay resolvable.'
          : scheduled ? 'It publishes itself within about a minute of the scheduled time.'
            : 'Only you can see this paper.'

  const checklist = [
    { key: 'title', label: 'Title', ok: !!detail.title.trim(), required: true },
    { key: 'abstract', label: 'Abstract', ok: !!detail.abstractSource.trim(), required: true },
    { key: 'tags', label: 'At least one tag', ok: (detail.tags?.length ?? 0) > 0, required: true },
    { key: 'body', label: 'Body', ok: !!(detail.description?.trim() || detail.descriptionHtml?.trim()), required: true },
    { key: 'cover', label: 'Cover image', ok: !!detail.coverImageUrl, required: false },
    { key: 'files', label: 'Files', ok: detail.mediaFiles.length > 0, required: false },
  ]

  const ask = (action: Lifecycle, title: string, message: string, destructive = false) =>
    confirm.open({ action, title, message, destructive })

  return (
    <Screen background="sunken">
      <Header back title="Publishing" />

      <ScreenScroll contentContainerStyle={{ padding: space.lg, paddingBottom: 60, gap: space.lg }}>
        {held ? (
          <ModerationNotice state={held} onRecheck={() => { void reload() }} />
        ) : (
          <View style={[styles.hero, { backgroundColor: heroBg }]}>
            <StatusPill status={status} scheduledPublishAt={detail.scheduledPublishAt} size="md" />
            <Text variant="title3" align="ui" style={{ marginTop: space.sm2 }}>{dateLine}</Text>
            <Text variant="footnote" tone="muted" align="ui" style={{ marginTop: space.xs }}>{meaning}</Text>
          </View>
        )}

        {notice ? <Callout tone={notice.tone}>{notice.text}</Callout> : null}

        <View style={[styles.card, { backgroundColor: c.surface }]}>
          <Text variant="title3" align="ui" style={{ marginBottom: space.sm2 }}>Readiness</Text>
          {checklist.map(item => (
            <Touchable
              key={item.key}
              onPress={() => router.push(to(`/research/${id}/edit`))}
              feedback="dim"
              noAutoHitSlop
              style={styles.checkRow}
            >
              <Icon
                name={item.ok ? 'checkCircle' : item.required ? 'close' : 'info'}
                size={18}
                color={item.ok ? c.success : item.required ? c.danger : c.textFaint}
                filled={item.ok}
              />
              <Text variant="subhead" align="ui" style={styles.flex}>{item.label}</Text>
              <Text variant="caption" tone={item.ok ? 'success' : item.required ? 'danger' : 'faint'}>
                {item.ok ? 'Ready' : item.required ? 'Required' : 'Recommended'}
              </Text>
            </Touchable>
          ))}
          {Object.values(checklistError).map((message, i) => (
            <Text key={i} variant="footnote" tone="danger" align="ui" style={{ marginTop: space.sm }}>{message}</Text>
          ))}
          {Object.keys(checklistError).length ? (
            <Button
              label="Fix in editor"
              variant="tinted"
              size="sm"
              onPress={() => router.push(to(`/research/${id}/edit`))}
              style={{ marginTop: space.sm2, alignSelf: 'flex-start' }}
            />
          ) : null}
        </View>

        <View style={[styles.card, { backgroundColor: c.surface, padding: 0 }]}>
          {status === 'DRAFT' ? (
            <>
              <ActionRowItem
                icon="upload"
                label="Publish now"
                note="Goes live, gets indexed, and notifies your followers."
                accent
                loading={busy === 'publish'}
                onPress={() => void apply('publish')}
              />
              <Divider inset={56} />
              <ActionRowItem
                icon="clock"
                label={scheduled ? 'Change the schedule' : 'Schedule…'}
                note="Auto-publishes at the time you pick."
                onPress={() => {
                  setScheduleAt(detail.scheduledPublishAt ? new Date(detail.scheduledPublishAt) : new Date(Date.now() + 3600_000))
                  setScheduleError(null)
                  scheduleSheet.open()
                }}
              />
            </>
          ) : null}

          {status === 'PUBLISHED' ? (
            <>
              <ActionRowItem
                icon="eyeOff"
                label="Unpublish"
                note="Back to draft. Your IRC id and share link are kept."
                loading={busy === 'unpublish'}
                onPress={() => ask('unpublish', 'Unpublish this paper?', 'It returns to draft and disappears from feeds and search. The IRC id and share link survive.')}
              />
              <Divider inset={56} />
              <ActionRowItem
                icon="archive"
                label="Archive"
                note="Hidden from feeds and search, still readable by link."
                loading={busy === 'archive'}
                onPress={() => ask('archive', 'Archive this paper?', 'It leaves feeds and search but anyone with the link can still read it.')}
              />
              <Divider inset={56} />
              <ActionRowItem
                icon="warning"
                label="Retract"
                note="Readers will see a RETRACTED banner. Use this for withdrawn work."
                destructive
                loading={busy === 'retract'}
                onPress={() => ask(
                  'retract',
                  'Retract this paper?',
                  'Every reader will see a RETRACTED banner above it. The paper stays readable so existing citations keep resolving.',
                  true,
                )}
              />
            </>
          ) : null}

          {status === 'ARCHIVED' ? (
            <ActionRowItem
              icon="upload"
              label="Publish again"
              note="Archived papers stay readable by link; this puts it back in feeds and search."
              accent
              loading={busy === 'publish'}
              onPress={() => void apply('publish')}
            />
          ) : null}

          {status === 'RETRACTED' ? (
            <ActionRowItem
              icon="refresh"
              label="Un-retract"
              note="Removes the retraction banner and republishes."
              accent
              loading={busy === 'unretract'}
              onPress={() => void apply('unretract')}
            />
          ) : null}
        </View>

        {scheduled ? (
          <Text variant="caption" tone="muted" align="ui">
            A schedule cannot be cleared by sending an empty value — the API only applies non-null fields. Publish now, or
            pick a different date, to change it.
          </Text>
        ) : null}

        <Divider />

        <View style={{ marginTop: space.sm }}>
          <ActionRowItem
            icon="trash"
            label="Delete permanently"
            note="Removes the paper, its files, comments, reactions and citation record. This cannot be undone — retract instead if you only want to withdraw it."
            destructive
            onPress={() => { setConfirmTitle(''); deleteSheet.open() }}
          />
        </View>

        {error ? <ErrorPanel error={error} onRetry={reload} compact /> : null}
      </ScreenScroll>

      <ConfirmSheet
        visible={confirm.visible}
        onClose={confirm.close}
        title={confirm.payload?.title || ''}
        message={confirm.payload?.message}
        confirmLabel={confirm.payload?.destructive ? 'Retract' : 'Continue'}
        destructive={confirm.payload?.destructive}
        loading={!!busy}
        onConfirm={() => { if (confirm.payload) void apply(confirm.payload.action) }}
      />

      <Sheet
        visible={scheduleSheet.visible}
        onClose={scheduleSheet.close}
        title="Schedule publication"
        footer={<Button label="Schedule" block size="lg" onPress={schedule} />}
      >
        <View style={{ padding: space.lg, gap: space.sm2 }}>
          <DateTimePicker
            value={scheduleAt ?? new Date(Date.now() + 3600_000)}
            mode="datetime"
            minimumDate={new Date(Date.now() + 60_000)}
            onChange={(_e, date) => { if (date) { setScheduleAt(date); setScheduleError(null) } }}
          />
          {scheduleError ? <Text variant="footnote" tone="danger" align="ui">{scheduleError}</Text> : null}
          <Text variant="footnote" tone="muted" align="ui">
            A background job scans about every 60 seconds, so publication lands within a minute of the time you pick.
          </Text>
        </View>
      </Sheet>

      <Sheet
        visible={deleteSheet.visible}
        onClose={deleteSheet.close}
        title="Delete permanently"
        subtitle="Type the paper's title to confirm."
        footer={
          <Button
            label="Delete"
            variant="danger"
            block
            size="lg"
            disabled={confirmTitle.trim() !== detail.title.trim()}
            onPress={remove}
          />
        }
      >
        <View style={{ padding: space.lg, gap: space.sm2 }}>
          <Text variant="subhead" align="auto" numberOfLines={3}>{detail.title}</Text>
          <Field value={confirmTitle} onChangeText={setConfirmTitle} placeholder="Paper title" autoFocus />
        </View>
      </Sheet>
    </Screen>
  )
}

function ActionRowItem({
  icon, label, note, accent, destructive, loading, onPress,
}: {
  icon: 'upload' | 'clock' | 'eyeOff' | 'archive' | 'warning' | 'refresh' | 'trash'
  label: string
  note: string
  accent?: boolean
  destructive?: boolean
  loading?: boolean
  onPress: () => void
}) {
  const t = useTheme()
  const c = t.colors
  const tint = destructive ? c.danger : accent ? c.accent : c.textSecondary
  return (
    <Touchable onPress={onPress} disabled={loading} feedback="tint" noAutoHitSlop style={styles.actionRow}>
      <Icon name={icon} size={20} color={tint} />
      <View style={styles.flex}>
        <Text variant="subhead" weight="600" align="ui" color={destructive ? c.danger : undefined}>{label}</Text>
        <Text variant="caption" tone="muted" align="ui" style={{ marginTop: space.xxs }}>{note}</Text>
      </View>
      {loading ? <Text variant="caption" tone="accent">Working…</Text> : null}
    </Touchable>
  )
}

const styles = StyleSheet.create({
  hero: { borderRadius: 18, padding: space.lg2 },
  card: { borderRadius: 16, padding: space.lg },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm2, paddingVertical: space.sm2 },
  actionRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md2, paddingHorizontal: space.lg, paddingVertical: space.md2, minHeight: 56 },
  flex: { flex: 1 },
})
