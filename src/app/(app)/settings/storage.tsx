/* =========================================================
   Storage.

   Two numbers that look alike and are nothing alike, which is
   the whole reason this screen exists as a pair of cards:

     server-side   what your uploads occupy on ours. A single
                   indexed SUM, cached for an hour — so a photo
                   deleted a minute ago is still counted. The
                   caption says "updated hourly" rather than
                   letting that read as a bug.
     on this phone the app's own cache. We cannot see it, and
                   clearing it never deletes anything uploaded.

   The bar is stacked, not a pie: at this width a pie is
   unreadable, and a stacked bar stays honest when one slice is
   98% of the total.
   ========================================================= */
import React from 'react'
import { View } from 'react-native'
import * as FileSystem from 'expo-file-system'
import { api } from '@/api'
import { useAction, useAsync } from '@/hooks/useAsync'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  Button, Callout, Card, ConfirmSheet, ErrorState, GroupFooter, GroupLabel,
  Header, Screen, ScreenScroll, Skeleton, Text, useSheetState, toast,
} from '@/ui'

const TYPE_LABELS: Record<string, string> = {
  IMAGE: 'Images', VIDEO: 'Videos', AUDIO: 'Audio', FILE: 'Documents',
  DOCUMENT: 'Documents', FILM: 'Films', VIDEO_CLIP: 'Clips', OTHER: 'Other',
}

export default function StorageScreen() {
  const t = useTheme()
  const c = t.colors
  const confirm = useSheetState()

  const usage = useAsync<any>(() => api.settings.storage.usage(), { deps: [] })
  const [cacheBytes, setCacheBytes] = React.useState<number | null>(null)

  const measure = React.useCallback(async () => {
    try { setCacheBytes(await cacheSize()) }
    catch { setCacheBytes(null) }
  }, [])

  React.useEffect(() => { void measure() }, [measure])

  const clear = useAction(async () => {
    await clearCache()
    await measure()
    toast.ok('Cache cleared')
  }, { onError: () => toast.error('Could not clear the cache.') })

  const total = Number(usage.data?.totalBytes ?? 0)
  const byType: Record<string, number> = usage.data?.byType || {}
  const slices = Object.entries(byType)
    .map(([k, v]) => [k, Number(v) || 0] as const)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])

  const hues = [c.accent, c.scholar, c.success, c.warning, c.danger, c.textMuted]

  return (
    <Screen background="sunken">
      <Header back title="Storage" />
      <ScreenScroll refreshing={usage.refreshing} onRefresh={usage.refresh}>
        <GroupLabel>On Hikmah Web's servers</GroupLabel>
        <View style={{ paddingHorizontal: t.layout.screenPadding }}>
          <Card variant="outlined" padding={16}>
            {usage.loading ? (
              <View style={{ gap: 12 }}>
                <Skeleton width="46%" height={30} />
                <Skeleton height={12} radius={999} />
                <Skeleton width="70%" height={12} />
                <Skeleton width="60%" height={12} />
              </View>
            ) : usage.error ? (
              /* The device card below needs no network, so only this one fails. */
              <ErrorState error={usage.error} onRetry={usage.reload} compact />
            ) : total <= 0 ? (
              <>
                <Text variant="title2" align="ui">Nothing stored yet</Text>
                <Text variant="footnote" tone="muted" align="ui" style={{ marginTop: 4 }}>
                  Photos, videos and files you upload will be counted here.
                </Text>
              </>
            ) : (
              <>
                <Text variant="display" align="ui">{humanBytes(total)}</Text>
                <Text variant="footnote" tone="muted" align="ui" style={{ marginTop: 2 }}>
                  used on Hikmah Web's servers
                </Text>

                {/* A progress meter, not a plate — capsule ends are sanctioned
                    here for the same reason spinners and rings are. No text
                    rides on it, so the setback law does not apply. */}
                <View
                  style={{
                    flexDirection: 'row',
                    height: 12,
                    borderRadius: 999,
                    overflow: 'hidden',
                    marginTop: space.lg,
                    backgroundColor: c.surfaceSunken,
                  }}
                >
                  {slices.map(([key, value], i) => (
                    <View key={key} style={{ flex: value / total, backgroundColor: hues[i % hues.length] }} />
                  ))}
                </View>

                <View style={{ gap: space.sm2, marginTop: space.lg }}>
                  {slices.map(([key, value], i) => (
                    <View key={key} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm2 }}>
                      <View
                        style={{
                          width: 10, height: 10, borderRadius: 3,
                          backgroundColor: hues[i % hues.length],
                        }}
                      />
                      <Text variant="footnote" align="ui" style={{ flex: 1 }}>
                        {TYPE_LABELS[key] ?? humanise(key)}
                      </Text>
                      <Text variant="footnote" tone="muted">{humanBytes(value)}</Text>
                      <Text variant="footnote" tone="faint" style={{ width: 40, textAlign: 'right' }}>
                        {Math.round((value / total) * 100)}%
                      </Text>
                    </View>
                  ))}
                </View>
              </>
            )}
          </Card>
        </View>
        <GroupFooter>
          Updated about once an hour, so an upload you just deleted may still be
          counted here for a while.
        </GroupFooter>

        <GroupLabel>On this device</GroupLabel>
        <View style={{ paddingHorizontal: t.layout.screenPadding, gap: space.md }}>
          <Card variant="outlined" padding={16}>
            <Text variant="title2" align="ui">
              {cacheBytes == null ? 'Not measurable' : humanBytes(cacheBytes)}
            </Text>
            <Text variant="footnote" tone="muted" align="ui" style={{ marginTop: space.xxs }}>
              {cacheBytes == null
                ? 'This build cannot read its own cache directory.'
                : 'Cached images, videos and downloads'}
            </Text>
          </Card>

          <Button
            label="Clear cache"
            icon="trash"
            variant="secondary"
            size="lg"
            block
            loading={clear.pending}
            disabled={cacheBytes == null || cacheBytes === 0}
            onPress={confirm.open}
          />

          <Callout tone="neutral" icon="lock">
            This is only on your phone — we can't see it, and clearing it never
            deletes anything you've uploaded. Images will re-download the next
            time you scroll past them.
          </Callout>
        </View>

        <View style={{ height: 16 }} />
      </ScreenScroll>

      <ConfirmSheet
        visible={confirm.visible}
        onClose={confirm.close}
        title="Clear the cache?"
        message="Cached media is deleted from this phone. Nothing you have uploaded is affected, and everything re-downloads on demand."
        confirmLabel="Clear"
        icon="trash"
        loading={clear.pending}
        onConfirm={async () => { confirm.close(); await clear.run() }}
      />
    </Screen>
  )
}

/* ---------------------------------------------------------
   The cache directory. SDK 54 replaced the function API with
   the class-based one, so `Directory` is what exists here —
   and it is guarded because a build without the native module
   must degrade to "not measurable", never crash the screen.
   --------------------------------------------------------- */

function cacheDir(): any | null {
  try { return (FileSystem as any)?.Paths?.cache ?? null }
  catch { return null }
}

async function cacheSize(): Promise<number | null> {
  const dir = cacheDir()
  if (!dir) return null
  /* `Directory.size` is null when the directory cannot be read, so the manual
     walk is the fallback rather than the primary path. */
  try {
    const n = dir.size
    if (typeof n === 'number' && Number.isFinite(n)) return n
  } catch { /* fall through */ }
  try { return walk(dir) } catch { return null }
}

function walk(dir: any): number {
  let total = 0
  let entries: any[] = []
  try { entries = dir.list() } catch { return 0 }
  for (const entry of entries) {
    try {
      if (typeof entry?.list === 'function') total += walk(entry)
      else total += Number(entry?.size) || 0
    } catch { /* an unreadable entry contributes nothing */ }
  }
  return total
}

async function clearCache() {
  const dir = cacheDir()
  if (!dir) return
  let entries: any[] = []
  try { entries = dir.list() } catch { return }
  for (const entry of entries) {
    /* Delete the contents, not the directory itself: some platforms will not
       recreate it, and every later write then fails. */
    try { entry.delete() } catch { /* in use, or not ours */ }
  }
}

function humanise(key: string) {
  const s = String(key).replace(/_/g, ' ').toLowerCase()
  return s.charAt(0).toUpperCase() + s.slice(1)
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
