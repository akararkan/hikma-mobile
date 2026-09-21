/* =========================================================
   Your data — export and deletion.

   The deletion endpoint carries a side effect that has to be
   surfaced before the tap, not after: requesting deletion soft-
   deletes the account NOW and revokes every session. The caller
   "must treat success as a logout". So the confirmation says
   exactly that, and the success path drops the session rather
   than pretending the user is still signed in.

   Export is once per 30 days and the job is asynchronous, so
   the screen polls its own status while it is PROCESSING and
   stops the moment it is not.
   ========================================================= */
import React from 'react'
import { View } from 'react-native'
import { api, errorText, isNotFound, isRateLimited, cooldownSecondsFrom } from '@/api'
import { storage } from '@/platform/storage'
import { useAuth } from '@/context/AuthContext'
import { useAsync, useAction } from '@/hooks/useAsync'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  Button, Callout, ConfirmSheet, GroupFooter, GroupLabel, Header, ListRow,
  RowGroup, Screen, ScreenScroll, Text, useSheetState, toast,
} from '@/ui'

/* An export takes minutes to build, which is far longer than anyone stares at
   this screen. The jobId is the ONLY handle on it — there is no "list my
   exports" endpoint — so losing it on navigate-away means the file is built
   and unreachable, and the 30-day rate limit blocks asking again. Remembered
   here, and pruned at 48h because the download link expires long before
   that. */
const EXPORT_JOB_KEY = 'ika_export_job'
const EXPORT_JOB_MAX_AGE_MS = 48 * 60 * 60 * 1000

function readStoredJob(): string | null {
  try {
    const raw = storage.getItem(EXPORT_JOB_KEY)
    if (!raw) return null
    const { jobId, requestedAt } = JSON.parse(raw) || {}
    if (!jobId || !requestedAt) return null
    if (Date.now() - Number(requestedAt) > EXPORT_JOB_MAX_AGE_MS) {
      storage.removeItem(EXPORT_JOB_KEY)
      return null
    }
    return String(jobId)
  } catch {
    /* Corrupt or unavailable storage degrades to "no stored job", never a
       throw on mount. */
    return null
  }
}

export default function DataSettings() {
  const t = useTheme()
  const { logout } = useAuth()

  const [jobId, setJobId] = React.useState<string | null>(() => readStoredJob())
  const [job, setJob] = React.useState<any>(null)
  const deletion = useSheetState()
  const clearSearch = useSheetState()
  const [deleting, setDeleting] = React.useState(false)

  const requestExport = useAction(async () => {
    const res: any = await api.settings.data.requestExport()
    setJobId(res?.jobId ?? null)
    setJob(res ?? null)
    try {
      if (res?.jobId) storage.setItem(EXPORT_JOB_KEY, JSON.stringify({ jobId: String(res.jobId), requestedAt: Date.now() }))
    } catch { /* the job still runs; only the handle is lost */ }
    return res
  }, {
    onError: e => {
      toast.error(isRateLimited(e)
        ? `You can request another export in ${Math.ceil(cooldownSecondsFrom(e) / 86400) || 30} days.`
        : errorText(e, 'Could not start your export.'))
    },
  })

  /* A job restored from storage has no status yet — read it once so the screen
     comes back showing what the export is actually doing. A jobId the server
     no longer knows is forgotten rather than left polling for ever. */
  React.useEffect(() => {
    if (!jobId || job) return
    let alive = true
    void (async () => {
      try {
        const fresh = await api.settings.data.exportStatus(jobId)
        if (alive) setJob(fresh)
      } catch (e: any) {
        if (!alive) return
        if (isNotFound(e)) {
          setJobId(null)
          try { storage.removeItem(EXPORT_JOB_KEY) } catch { /* nothing to forget */ }
        }
      }
    })()
    return () => { alive = false }
  }, [jobId, job])

  /* Poll while the job is working, and only while it is working. */
  React.useEffect(() => {
    if (!jobId) return
    const status = String(job?.status || '').toUpperCase()
    if (status === 'READY' || status === 'FAILED' || status === 'EXPIRED') return
    const id = setTimeout(async () => {
      try { setJob(await api.settings.data.exportStatus(jobId)) }
      catch { /* a failed poll is not a failed export — try again next tick */ }
    }, 4000)
    return () => clearTimeout(id)
  }, [jobId, job])

  /* A finished export has nothing left to resume, and an expired one cannot be
     downloaded — either way the remembered handle is spent. */
  React.useEffect(() => {
    const status = String(job?.status || '').toUpperCase()
    if (status !== 'FAILED' && status !== 'EXPIRED') return
    try { storage.removeItem(EXPORT_JOB_KEY) } catch { /* nothing to forget */ }
  }, [job])

  const download = useAction(async () => {
    if (!jobId) return
    /* http.download returns { blob, filename, type }; saveBlob writes it and
       opens the share sheet, which is where "Save to Files" lives on a phone. */
    const file: any = await api.settings.data.downloadExport(jobId)
    const { saveBlob } = await import('@/platform/files')
    const ok = await saveBlob(file, 'ika-export.zip')
    if (!ok) toast.warn('Sharing is not available on this device.')
  }, { onError: e => toast.error(errorText(e, 'Could not download your export.')) })

  const doDelete = async () => {
    setDeleting(true)
    try {
      await api.settings.data.requestDeletion()
      /* Success IS a logout: every session was just revoked server-side. */
      await logout()
    } catch (e) {
      toast.error(errorText(e, 'Could not start account deletion.'))
      setDeleting(false)
      deletion.close()
    }
  }

  const status = String(job?.status || '').toUpperCase()

  return (
    <Screen background="sunken">
      <Header back title="Your data" />
      <ScreenScroll>
        <GroupLabel>Download your data</GroupLabel>
        <View style={{ paddingHorizontal: t.layout.screenPadding, gap: space.md }}>
          {status === 'READY' ? (
            <Callout tone="success" title="Your export is ready" icon="download">
              {job?.expiresAt
                ? `The download link expires ${new Date(job.expiresAt).toLocaleDateString()}.`
                : 'The download link is available for a limited time.'}
            </Callout>
          ) : status === 'FAILED' ? (
            <Callout tone="danger" title="That export failed" actionLabel="Try again" onAction={() => void requestExport.run()}>
              Nothing was produced. You can start a new one.
            </Callout>
          ) : jobId ? (
            <Callout tone="info" title="Preparing your export" icon="hourglass">
              This can take a while. You can leave this screen — we'll keep working.
            </Callout>
          ) : null}

          {status === 'READY' ? (
            <Button
              label="Save the file"
              icon="download"
              onPress={() => void download.run()}
              loading={download.pending}
              variant="primary"
              size="lg"
              block
            />
          ) : (
            <Button
              label={jobId ? 'Preparing…' : 'Request an export'}
              icon="upload"
              onPress={() => void requestExport.run()}
              loading={requestExport.pending}
              disabled={!!jobId && status !== 'FAILED'}
              variant="secondary"
              size="lg"
              block
            />
          )}
        </View>
        <GroupFooter>
          A copy of your posts, research, messages metadata and account details, as
          a single archive. You can request one every 30 days.
        </GroupFooter>

        <GroupLabel>Clear history</GroupLabel>
        <RowGroup>
          <ListRow
            title="Clear search history"
            icon="search"
            iconTone="neutral"
            onPress={clearSearch.open}
          />
          <ListRow
            title="Clear watch history"
            subtitle="Which reels you've watched"
            icon="reels"
            iconTone="neutral"
            onPress={async () => {
              try { await api.settings.data.clearHistory('watch'); toast.ok('Watch history cleared') }
              catch (e) { toast.error(errorText(e, 'Could not clear that.')) }
            }}
          />
        </RowGroup>
        <GroupFooter>
          Clearing history also stops it feeding your recommendations.
        </GroupFooter>

        <GroupLabel>Delete your account</GroupLabel>
        <View style={{ paddingHorizontal: t.layout.screenPadding }}>
          <Callout tone="danger" title="This signs you out immediately" icon="warning">
            Your account is hidden right away and every device is signed out. There is a
            grace period during which signing back in cancels the deletion — after that
            it is permanent and cannot be undone.
          </Callout>
        </View>
        <View style={{ height: 12 }} />
        <RowGroup>
          <ListRow title="Delete my account" icon="trash" destructive onPress={deletion.open} />
        </RowGroup>
      </ScreenScroll>

      <ConfirmSheet
        visible={clearSearch.visible}
        onClose={clearSearch.close}
        title="Clear search history?"
        message="Your past searches will be removed from this account on every device."
        confirmLabel="Clear"
        destructive
        onConfirm={async () => {
          clearSearch.close()
          try { await api.settings.data.clearHistory('search'); toast.ok('Search history cleared') }
          catch (e) { toast.error(errorText(e, 'Could not clear that.')) }
        }}
      />

      <ConfirmSheet
        visible={deletion.visible}
        onClose={deletion.close}
        title="Delete your account?"
        message="You'll be signed out of every device immediately. Sign back in during the grace period to cancel."
        confirmLabel="Delete account"
        destructive
        loading={deleting}
        icon="trash"
        onConfirm={() => void doDelete()}
      />
    </Screen>
  )
}
