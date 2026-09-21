/* =========================================================
   Media & storage.

   `uploadQuality` is documented as "a hint that saves the
   user's bandwidth — the client may pre-compress to it", and
   lib/mediaTier.ts is what makes it real. So this screen has
   to keep that module's cache honest: it writes the server AND
   calls setTierLocal, because an upload started before the
   next settings read would otherwise still use the old tier.

   Storage usage is cached for an hour server-side, so the
   pull-to-refresh here is honest about not changing much.
   ========================================================= */
import React from 'react'
import { View } from 'react-native'
import { api, errorText, MEDIA_TIERS } from '@/api'
import { useAsync } from '@/hooks/useAsync'
import { canDetectMetered } from '@/platform/network'
import { setTierLocal, TIER_EDGE } from '@/lib/mediaTier'
import {
  readCachedMediaPrefs, setMediaPrefsLocal,
  type AutoDownload, type MediaPrefs, type UploadOverCellular,
} from '@/lib/mediaPrefs'
import { useTheme } from '@/theme/ThemeProvider'
import {
  Card, GroupFooter, GroupLabel, Header, ListRow, RowGroup,
  Screen, ScreenScroll, Skeleton, Text, toast, formatCount,
} from '@/ui'

/* The wire's own values (verified against a live GET /settings/media), with
   the copy a reader understands. */
const UPLOAD_OVER_CELLULAR: [UploadOverCellular, string, string][] = [
  ['SAME_AS_WIFI', 'Same as wi-fi', 'Use your upload quality everywhere'],
  ['DATA_SAVER_ONLY', 'Data saver on mobile', 'Smaller photos when you are not on wi-fi'],
]

const AUTO_DOWNLOAD: [AutoDownload, string][] = [
  ['NEVER', 'Never'],
  ['WIFI', 'On wi-fi only'],
  ['WIFI_AND_CELLULAR', 'Wi-fi and mobile data'],
]

/** Only the three keys this screen owns — never the whole block, or a stale
 *  uploadQuality would ride along. */
function pickPrefs(block: any): Partial<MediaPrefs> {
  const out: Partial<MediaPrefs> = {}
  if (block?.uploadOverCellular) out.uploadOverCellular = block.uploadOverCellular
  if (block?.autoDownloadPhotos) out.autoDownloadPhotos = block.autoDownloadPhotos
  if (block?.autoDownloadVideos) out.autoDownloadVideos = block.autoDownloadVideos
  return out
}

const TYPE_LABELS: Record<string, string> = {
  IMAGE: 'Photos', VIDEO: 'Videos', AUDIO: 'Audio', FILE: 'Files',
  FILM: 'Films', VIDEO_CLIP: 'Clips', OTHER: 'Other',
}

export default function MediaSettings() {
  const t = useTheme()
  const c = t.colors

  const block = useAsync<any>(() => api.settings.section('media'), {
    deps: [],
    /* The read this screen makes is also the read every other surface would
       have had to make — hand it to the cache rather than fetching twice. */
    onSuccess: (b: any) => setMediaPrefsLocal(pickPrefs(b)),
  })
  const usage = useAsync<any>(() => api.settings.storage.usage(), { deps: [] })
  const [saving, setSaving] = React.useState(false)

  const setTier = async (tier: string) => {
    setSaving(true)
    const previous = block.data
    block.setData((prev: any) => ({ ...(prev || {}), uploadQuality: tier }))
    /* Keep the uploader's own cache in step immediately — an upload started
       before the next settings read would otherwise use the old cap. */
    setTierLocal(tier)
    try {
      await api.settings.patchSection('media', { uploadQuality: tier })
    } catch (e) {
      block.setData(previous ?? null)
      if (previous?.uploadQuality) setTierLocal(previous.uploadQuality)
      toast.error(errorText(e, 'Could not change the upload quality.'))
    } finally {
      setSaving(false)
    }
  }

  /* Same optimistic shape as setTier above, and for the same reason: the
     local cache has to move first, or an upload or a feed row that reads it
     before the next settings fetch would still obey the old policy. */
  const patchPrefs = async (patch: Partial<MediaPrefs>) => {
    setSaving(true)
    const previous = block.data
    block.setData((prev: any) => ({ ...(prev || {}), ...patch }))
    setMediaPrefsLocal(patch)
    try {
      /* patchSection, never replaceSection — a PUT nulls every key it is not
         given, which would wipe uploadQuality and playbackQuality. */
      await api.settings.patchSection('media', patch)
    } catch (e) {
      block.setData(previous ?? null)
      setMediaPrefsLocal(previous || {})
      toast.error(errorText(e, 'Could not save that.'))
    } finally {
      setSaving(false)
    }
  }

  /* The freshly-read block is the truth while this screen is open; the cache
     is the fallback before it lands (and what every other surface reads). */
  const prefs: MediaPrefs = block.data
    ? { ...readCachedMediaPrefs(), ...pickPrefs(block.data) }
    : readCachedMediaPrefs()
  const current = String(block.data?.uploadQuality || 'HIGH').toUpperCase()
  const byType: Record<string, number> = usage.data?.byType || {}
  const total = Number(usage.data?.totalBytes ?? 0)
  const entries = Object.entries(byType).filter(([, v]) => Number(v) > 0)

  return (
    <Screen background="sunken">
      <Header back title="Media & storage" />
      <ScreenScroll refreshing={usage.refreshing} onRefresh={() => { void usage.refresh(); void block.refresh() }}>
        <GroupLabel>Upload quality</GroupLabel>
        <RowGroup>
          {(MEDIA_TIERS as [string, string, string?][]).map(([value, label, note]) => (
            <ListRow
              key={value}
              title={label}
              subtitle={note ?? (TIER_EDGE[value] ? `Longest edge up to ${TIER_EDGE[value]}px` : undefined)}
              disabled={saving}
              accessory={{ kind: 'radio', checked: current === value }}
              onPress={() => void setTier(value)}
            />
          ))}
        </RowGroup>
        <GroupFooter>
          Photos are resized on your phone before they upload, so a lower setting
          saves your data as well as ours. Videos are never re-encoded here — the
          server caps them at 1080p either way.
        </GroupFooter>

        <GroupLabel>Storage you're using</GroupLabel>
        <View style={{ paddingHorizontal: t.layout.screenPadding }}>
          <Card variant="outlined" padding={16}>
            {usage.loading ? (
              <View style={{ gap: 10 }}>
                <Skeleton width="42%" height={26} />
                <Skeleton height={10} radius={999} />
              </View>
            ) : (
              <>
                <Text variant="display" align="ui">{humanBytes(total)}</Text>
                <Text variant="footnote" tone="muted" align="ui" style={{ marginTop: 2 }}>
                  across {entries.length || 0} kind{entries.length === 1 ? '' : 's'} of media
                </Text>

                {/* One stacked bar rather than a pie: it is the only chart that
                    reads correctly at this width and stays honest when one
                    slice is 98%. Capsule ends are sanctioned here — this is a
                    meter, not a plate, and no text rides on it. */}
                {total > 0 ? (
                  <View style={{ flexDirection: 'row', height: 10, borderRadius: 999, overflow: 'hidden', marginTop: 14, backgroundColor: c.surfaceSunken }}>
                    {entries.map(([key, v], i) => (
                      <View
                        key={key}
                        style={{
                          flex: Number(v) / total,
                          backgroundColor: [c.accent, c.scholar, c.success, c.warning, c.danger][i % 5],
                        }}
                      />
                    ))}
                  </View>
                ) : null}

                <View style={{ gap: 8, marginTop: 14 }}>
                  {entries.map(([key, v], i) => (
                    <View key={key} style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
                      <View
                        style={{
                          width: 9, height: 9, borderRadius: 3,
                          backgroundColor: [c.accent, c.scholar, c.success, c.warning, c.danger][i % 5],
                        }}
                      />
                      <Text variant="footnote" align="ui" style={{ flex: 1 }}>
                        {TYPE_LABELS[key] ?? key}
                      </Text>
                      <Text variant="footnote" tone="muted">{humanBytes(Number(v))}</Text>
                    </View>
                  ))}
                  {!entries.length ? (
                    <Text variant="footnote" tone="muted" align="ui">
                      You haven't uploaded anything yet.
                    </Text>
                  ) : null}
                </View>
              </>
            )}
          </Card>
        </View>
        <GroupFooter>
          Updated about once an hour. Deleting a post frees its media within a day.
        </GroupFooter>

        <GroupLabel>Uploads</GroupLabel>
        <RowGroup>
          {UPLOAD_OVER_CELLULAR.map(([value, label, note]) => (
            <ListRow
              key={value}
              title={label}
              subtitle={note}
              disabled={saving}
              accessory={{ kind: 'radio', checked: prefs.uploadOverCellular === value }}
              onPress={() => void patchPrefs({ uploadOverCellular: value })}
            />
          ))}
        </RowGroup>
        <GroupFooter>
          {canDetectMetered()
            ? 'On mobile data, Data saver sends photos at the smallest size whatever your upload quality is set to. Your choice above comes back on wi-fi.'
            : 'Saved to your account and used by your other devices. This build of the app can’t tell wi-fi from mobile data, so it uploads at your chosen quality either way — reinstall to enable it here.'}
        </GroupFooter>

        <GroupLabel>Auto-download photos</GroupLabel>
        <RowGroup>
          {AUTO_DOWNLOAD.map(([value, label]) => (
            <ListRow
              key={value}
              title={label}
              disabled={saving}
              accessory={{ kind: 'radio', checked: prefs.autoDownloadPhotos === value }}
              onPress={() => void patchPrefs({ autoDownloadPhotos: value })}
            />
          ))}
        </RowGroup>

        <GroupLabel>Auto-download videos</GroupLabel>
        <RowGroup>
          {AUTO_DOWNLOAD.map(([value, label]) => (
            <ListRow
              key={value}
              title={label}
              disabled={saving}
              accessory={{ kind: 'radio', checked: prefs.autoDownloadVideos === value }}
              onPress={() => void patchPrefs({ autoDownloadVideos: value })}
            />
          ))}
        </RowGroup>
        <GroupFooter>
          {canDetectMetered()
            ? 'Never still lets you open anything by tapping it — it only stops videos playing and pictures loading on their own.'
            : 'Never still lets you open anything by tapping it — it only stops videos playing and pictures loading on their own. This build can’t tell wi-fi from mobile data, so “On wi-fi only” behaves like “Wi-fi and mobile data” until you reinstall.'}
        </GroupFooter>

      </ScreenScroll>
    </Screen>
  )
}

function humanBytes(n: number): string {
  const b = Number(n) || 0
  if (b < 1024) return `${b} B`
  const kb = b / 1024
  if (kb < 1024) return `${Math.round(kb)} KB`
  const mb = kb / 1024
  if (mb < 1024) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`
  const gb = mb / 1024
  return `${gb < 10 ? gb.toFixed(2) : gb.toFixed(1)} GB`
}
