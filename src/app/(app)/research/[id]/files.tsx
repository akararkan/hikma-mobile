/* =========================================================
   Files & downloads.

   Two rules the docs are explicit about and this screen is
   built around:

     · a repeat tap is never disabled and never bumps the
       counter locally — the server hands over a URL every time
       but counts once per (research, media, user) per 90 days
     · "Download all" is strictly sequential, because only one
       OS share sheet can be open at a time
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import * as Clipboard from 'expo-clipboard'
import { Linking } from 'react-native'
import { api, codeOf, errorText } from '@/api'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  ActionSheet, Callout, Divider, EmptyState, Header, Screen, ScreenScroll, Skeleton,
  Text, toast, useSheetState,
} from '@/ui'
import { FileRow } from '@/components/research/FileRow'
import { ErrorPanel } from '@/components/research/states'
import { useResearchDetail } from '@/components/research/hooks'
import { MEDIA_TYPE_LABEL, MEDIA_TYPE_ORDER, formatBytes } from '@/components/research/format'
import { to } from '@/components/research/nav'
import type { MediaFile } from '@/components/research/types'

export default function FilesScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const { detail, error, loading, reload } = useResearchDetail(id, { subscribe: false, recordView: false })

  const [banner, setBanner] = React.useState<string | null>(null)
  const [bulk, setBulk] = React.useState<{ done: number; total: number; name: string } | null>(null)
  const menu = useSheetState<MediaFile>()

  const files = detail?.mediaFiles || []
  const totalSize = files.reduce((sum, f) => sum + (f.fileSize || 0), 0)
  const downloadsOn = !!detail?.downloadsEnabled && !banner

  const grouped = MEDIA_TYPE_ORDER
    .map(type => ({ type, rows: files.filter(f => f.type === type).sort((a, b) => a.order - b.order) }))
    .filter(g => g.rows.length)

  const downloadAll = async () => {
    if (!downloadsOn || bulk) return
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      setBulk({ done: i, total: files.length, name: file.name })
      try {
        const res: any = await api.research.download(id, file.id)
        if (res?.url) await Linking.openURL(res.url)
      } catch (e: any) {
        const code = codeOf(e)
        if (code === 'DOWNLOADS_DISABLED' || code === 'NOT_PUBLISHED') { setBanner(errorText(e)); break }
        toast.error(errorText(e))
      }
    }
    setBulk(null)
  }

  return (
    <Screen background="sunken">
      <Header
        back
        title={`Files${files.length ? ` · ${files.length}` : ''}`}
        actions={downloadsOn && files.length ? [{ icon: 'download', onPress: downloadAll, label: 'Download all' }] : []}
      />

      <View style={styles.subline}>
        {bulk ? (
          <Text variant="footnote" tone="accent" align="ui" numberOfLines={1}>
            {bulk.done + 1} of {bulk.total} · {bulk.name}
          </Text>
        ) : totalSize ? (
          <Text variant="footnote" tone="muted" align="ui">{formatBytes(totalSize)} total</Text>
        ) : null}
      </View>

      {banner || (detail && !detail.downloadsEnabled) ? (
        <Callout tone="neutral" icon="lock" style={styles.banner}>
          {banner || 'The researcher turned downloads off for this paper.'}
        </Callout>
      ) : null}

      <ScreenScroll contentContainerStyle={{ paddingBottom: space.huge }}>
        {loading ? (
          <View style={{ padding: space.lg, gap: space.lg2 }}>
            {Array.from({ length: 4 }, (_, i) => (
              <View key={i} style={{ flexDirection: 'row', gap: space.md, alignItems: 'center' }}>
                <Skeleton width={40} height={40} radius={11} />
                <View style={{ flex: 1, gap: space.sm }}>
                  <Skeleton width="66%" height={12} />
                  <Skeleton width="38%" height={10} />
                </View>
              </View>
            ))}
          </View>
        ) : error ? (
          <ErrorPanel error={error} onRetry={reload} />
        ) : !files.length ? (
          <EmptyState icon="file" title="No files attached to this paper." />
        ) : (
          grouped.map(group => (
            <View key={group.type} style={styles.group}>
              {/* No .toUpperCase() at the call site: `micro` uppercases Latin
                  inside the Text primitive and leaves Arabic script alone. */}
              <Text variant="micro" tone="muted" align="ui" style={styles.groupLabel}>
                {MEDIA_TYPE_LABEL[group.type] || group.type}
              </Text>
              <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.borderFaint }]}>
                {group.rows.map((file, i) => (
                  <View key={file.id}>
                    {i ? <Divider inset={68} /> : null}
                    <FileRow
                      file={file}
                      researchId={id}
                      downloadsEnabled={downloadsOn}
                      onOpen={() => router.push(to(`/research/${id}/file/${file.id}`))}
                      onLongPress={() => menu.open(file)}
                      onDownloaded={(_mediaId, url) => { void Linking.openURL(url) }}
                      onDisabled={message => setBanner(message)}
                    />
                  </View>
                ))}
              </View>
            </View>
          ))
        )}
      </ScreenScroll>

      <ActionSheet
        visible={menu.visible}
        onClose={menu.close}
        title={menu.payload?.name}
        actions={[
          {
            label: 'Copy file name',
            icon: 'copy',
            onPress: async () => {
              if (menu.payload) { await Clipboard.setStringAsync(menu.payload.name); toast.ok('File name copied') }
            },
          },
          {
            label: 'Open in browser',
            icon: 'external',
            onPress: async () => {
              if (!menu.payload) return
              try {
                const res: any = await api.research.download(id, menu.payload.id)
                if (res?.url) await Linking.openURL(res.url)
              } catch (e: any) { toast.error(errorText(e)) }
            },
          },
        ]}
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  subline: { paddingHorizontal: space.lg, paddingBottom: space.sm, minHeight: 20 },
  banner: { marginHorizontal: space.lg, marginBottom: space.md },
  group: { marginTop: space.sm2 },
  groupLabel: { paddingHorizontal: space.lg, paddingBottom: space.xs2 },
  card: { marginHorizontal: space.lg, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
})
