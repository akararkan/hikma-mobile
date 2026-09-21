/* =========================================================
   FileRow — one attached file and its download.

   Two rules from the API docs shape this component:

   1. `download` returns a fresh presigned URL every time but
      only COUNTS once per (research, media, user) per 90 days.
      So a repeat tap is never disabled and the local counter is
      never bumped — a local +1 would routinely lie.
   2. `mediaId` is required. Downloads are tracked per physical
      file, never per paper.
   ========================================================= */
import React from 'react'
import { Linking, StyleSheet, View } from 'react-native'
import { codeOf, errorText } from '@/api'
import { api } from '@/api'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import { Icon, Spinner, Text, Touchable, toast } from '@/ui'
import { extOf, fileTint, formatBytes } from './format'
import type { MediaFile } from './types'

export type FileRowState = 'idle' | 'working' | 'done' | 'unavailable'

export function FileRow({
  file, researchId, downloadsEnabled, onOpen, onDownloaded, onDisabled, onLongPress,
}: {
  file: MediaFile
  researchId: string
  downloadsEnabled: boolean
  onOpen?: () => void
  onDownloaded?: (mediaId: string, url: string) => void
  /** A DOWNLOADS_DISABLED / NOT_PUBLISHED answer flips the whole screen. */
  onDisabled?: (message: string, code: string) => void
  onLongPress?: () => void
}) {
  const t = useTheme()
  const c = t.colors
  const [state, setState] = React.useState<FileRowState>('idle')
  const [rowError, setRowError] = React.useState<string | null>(null)
  const tint = fileTint(c, file.type)

  const run = async () => {
    if (state === 'working') return
    setState('working')
    setRowError(null)
    try {
      const res: any = await api.research.download(researchId, file.id)
      const url = res?.url
      if (!url) throw new Error('no url')
      onDownloaded?.(file.id, url)
      setState('done')
      setTimeout(() => setState(s => (s === 'done' ? 'idle' : s)), 2000)
    } catch (e: any) {
      const code = codeOf(e)
      if (code === 'DOWNLOADS_DISABLED' || code === 'NOT_PUBLISHED') {
        setState('idle')
        onDisabled?.(errorText(e), code)
        return
      }
      if (code === 'FILE_NOT_AVAILABLE') { setState('unavailable'); return }
      setState('idle')
      setRowError(errorText(e))
    }
  }

  const dead = state === 'unavailable'

  return (
    <Touchable onPress={onOpen} onLongPress={onLongPress} feedback="tint" noAutoHitSlop>
      <View style={styles.row}>
        <View style={[styles.tile, { backgroundColor: dead ? c.surfaceSunken : tint.bg }]}>
          <Text variant="micro" color={dead ? c.textFaint : tint.fg} align="center">{extOf(file.name)}</Text>
        </View>

        <View style={styles.flex}>
          <Text variant="subhead" weight="600" align="auto" numberOfLines={2} tone={dead ? 'faint' : 'default'}>
            {file.name || 'Untitled file'}
          </Text>
          <Text variant="caption" tone="muted" align="ui" numberOfLines={1} style={{ marginTop: space.xxs }}>
            {dead
              ? 'File unavailable'
              : [formatBytes(file.fileSize), file.type, file.caption].filter(Boolean).join(' · ')}
          </Text>
          {rowError ? (
            <Text variant="caption" tone="danger" align="ui" numberOfLines={2} style={{ marginTop: space.xs }}>
              {rowError}
            </Text>
          ) : null}
        </View>

        {downloadsEnabled && !dead ? (
          <Touchable
            onPress={run}
            feedback="scale"
            haptic="light"
            accessibilityLabel={`Download ${file.name}`}
            style={[styles.action, { backgroundColor: c.surfaceSunken }]}
          >
            {state === 'working'
              ? <Spinner style={styles.spinner} />
              : <Icon name={state === 'done' ? 'check' : rowError ? 'refresh' : 'download'} size={17} color={state === 'done' ? c.success : c.textSecondary} />}
          </Touchable>
        ) : null}
      </View>
    </Touchable>
  )
}

/** Hand a presigned URL to the OS. Awaited by callers because only one share
 *  sheet can be open at a time. */
export async function openDownloaded(url: string) {
  try {
    const ok = await Linking.canOpenURL(url)
    if (!ok) throw new Error('unopenable')
    await Linking.openURL(url)
  } catch {
    toast.error('Could not open the file.')
  }
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md, minHeight: 64 },
  tile: { width: 40, height: 40, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  action: { width: 32, height: 32, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  spinner: { padding: 0 },
  flex: { flex: 1 },
})
