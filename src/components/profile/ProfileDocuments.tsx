/* =========================================================
   The scholar's documents — ProfileResponse.attachments
   (CV, ijazah scans, publication lists), which the adapter
   has mapped since day one and no screen ever rendered.

   Row grammar echoes the chat file tile's extension plate —
   a small tinted plate carrying the extension, deterministic
   tone per file kind so a PDF is the same colour on a profile
   as in a thread — but built with the profile's own pieces:
   plain Views and font glyphs only (list-row law), hairline
   WEFT DASH between rows, no shadow.

   `fileUrl` is a public CDN URL (profile.md: same R2/S3 store
   as avatars/covers), already absolutized by the adapter's
   assetUrl — so opening is the app's public-file pattern,
   WebBrowser.openBrowserAsync, exactly as the chat media page
   and the Q&A attachment list do for non-visual files.

   Renders nothing when there are no attachments: an empty
   "Documents" card would be furniture, not information.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import * as WebBrowser from 'expo-web-browser'
import { useTheme } from '@/theme/ThemeProvider'
import { setback, space } from '@/theme/tokens'
import { errorText } from '@/api'
import { Card, Icon, Section, Text, Touchable, WeftDash, toast } from '@/ui'

/** The adapter's userAttachmentFrom shape (src/api/adapters.js). */
export interface ProfileDocument {
  id: string
  url: string
  name: string
  mime: string
  size: number
  description: string
}

/** `thesis-final.pdf` → `PDF`; falls back to the MIME subtype, then `FILE`,
 *  so the plate is never blank. */
function extOf(doc: ProfileDocument): string {
  const fromName = String(doc.name || '').split('.').pop()
  if (fromName && fromName.length <= 5 && fromName !== doc.name) return fromName.toUpperCase()
  const fromMime = String(doc.mime || '').split('/').pop()
  if (fromMime && fromMime.length <= 5) return fromMime.toUpperCase()
  return 'FILE'
}

/** Deterministic plate tone per extension — the same mapping chat's file tile
 *  uses, so one kind of file wears one colour app-wide. Returns a palette
 *  ROLE key, never a hex. */
function toneOf(ext: string): 'danger' | 'accent' | 'success' | 'warning' | 'scholar' {
  if (ext === 'PDF') return 'danger'
  if (['DOC', 'DOCX', 'RTF', 'TXT', 'MD'].includes(ext)) return 'accent'
  if (['XLS', 'XLSX', 'CSV', 'NUMBERS'].includes(ext)) return 'success'
  if (['ZIP', 'RAR', '7Z', 'TAR', 'GZ'].includes(ext)) return 'warning'
  return 'scholar'
}

/** 204800 → `200 KB`. */
function sizeLabel(bytes: number): string {
  const b = Number(bytes) || 0
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`
  if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`
  return `${(b / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

async function openDocument(url: string) {
  if (!url) return
  try {
    await WebBrowser.openBrowserAsync(url)
  } catch (e: any) {
    toast.error(errorText(e))
  }
}

export const ProfileDocuments = React.memo(function ProfileDocuments({
  attachments,
}: { attachments?: ProfileDocument[] | null }) {
  const t = useTheme()
  const docs = attachments ?? []
  if (!docs.length) return null

  return (
    <Section title="Documents">
      <View style={{ paddingHorizontal: t.layout.screenPadding }}>
        <Card variant="outlined">
          {docs.map((d, i) => (
            <React.Fragment key={d.id || d.url}>
              {/* Inside a card the divider is the weft dash, inset past the
                  plate so it underlines the text column like a list row's. */}
              {i > 0 ? <WeftDash style={styles.dash} /> : null}
              <DocumentRow doc={d} />
            </React.Fragment>
          ))}
        </Card>
      </View>
    </Section>
  )
})

function DocumentRow({ doc }: { doc: ProfileDocument }) {
  const t = useTheme()
  const c = t.colors
  const ext = extOf(doc)
  const tint = c[toneOf(ext)]
  const size = doc.size ? sizeLabel(doc.size) : ''
  const press = React.useCallback(() => { void openDocument(doc.url) }, [doc.url])

  return (
    <Touchable
      onPress={press}
      feedback="dim"
      noAutoHitSlop
      accessibilityLabel={[doc.description || doc.name, size].filter(Boolean).join(', ')}
      accessibilityHint="Opens the document"
      style={styles.row}
    >
      <View style={[styles.plate, { backgroundColor: tint, ...setback(t.shape.chip) }]}>
        <Text variant="micro" color={c.textOnAccent} align="center" numberOfLines={1}>{ext}</Text>
      </View>
      <View style={styles.flex}>
        <Text variant="subhead" weight="600" numberOfLines={1} ellipsizeMode="middle" align="auto">
          {doc.name}
        </Text>
        {doc.description ? (
          <Text variant="footnote" tone="secondary" numberOfLines={2} align="auto" style={{ marginTop: space.xxs }}>
            {doc.description}
          </Text>
        ) : null}
        <Text variant="micro" tone="faint" align="ui" style={{ marginTop: space.xxs }}>
          {size ? `${ext} · ${size}` : ext}
        </Text>
      </View>
      <Icon name="download" size={18} color={c.textFaint} />
    </Touchable>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    paddingHorizontal: space.md2, paddingVertical: space.md, minHeight: 64,
  },
  plate: {
    width: 40, height: 48, alignItems: 'center', justifyContent: 'center',
    borderCurve: 'continuous',
  },
  /* 14 row padding + 40 plate + 12 gap — the dash starts under the text. */
  dash: { marginStart: 66 },
})
