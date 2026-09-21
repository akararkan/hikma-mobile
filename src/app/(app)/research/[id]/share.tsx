/* =========================================================
   Share & cite.

   `shareLink` is the ONLY place shareCount is readable —
   neither researchFrom's metrics object nor
   researchDetailFrom exposes it — and it deliberately does not
   bump the count. `recordShare` does, and only after the user
   actually copied or completed an OS share.

   Citation strings are assembled client-side: there is no
   formatting endpoint anywhere in the API.
   ========================================================= */
import React from 'react'
import { Share, StyleSheet, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import * as Clipboard from 'expo-clipboard'
import QRCode from 'react-native-qrcode-svg'
import { adapters, api, codeOf } from '@/api'
import { useAuthGate } from '@/context/AuthContext'
import { useAsync } from '@/hooks/useAsync'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  Button, Callout, Chip, ChipRail, Header, Icon, Screen, ScreenScroll, Skeleton,
  Text, Touchable, formatCount, toast, type IconName,
} from '@/ui'
import { ResearchCover } from '@/components/research/ResearchCover'
import { ErrorPanel, SignInPrompt } from '@/components/research/states'
import { useResearchDetail } from '@/components/research/hooks'
import { CITATION_LABEL, buildCitation, citationStyles, type CitationStyle } from '@/components/research/citations'
import { sharedAssetPath } from '@/components/stories/storyVisual'
import type { ResearchDetail, ShareLinkInfo } from '@/components/research/types'

export default function ShareScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const { id, tab } = useLocalSearchParams<{ id: string; tab?: string }>()
  const gate = useAuthGate()

  const { detail } = useResearchDetail(id, { subscribe: false, recordView: false })
  const [mode, setMode] = React.useState<'share' | 'cite'>(tab === 'cite' ? 'cite' : 'share')
  const [style, setStyle] = React.useState<CitationStyle | null>(null)
  const [showQr, setShowQr] = React.useState(false)
  const [shareCount, setShareCount] = React.useState<number | null>(null)
  const [cited, setCited] = React.useState(false)
  const [citeError, setCiteError] = React.useState<any>(null)
  const [busy, setBusy] = React.useState(false)

  const link = useAsync<ShareLinkInfo>(
    () => api.research.shareLink(id),
    { enabled: !!id, deps: [id], onSuccess: (v: any) => setShareCount(v?.shareCount ?? null) },
  )

  const notPublished = codeOf(link.error) === 'NOT_PUBLISHED'
  const shortUrl = link.data?.shortUrl || detail?.shareUrl || ''
  const styles_ = detail ? citationStyles(detail) : []
  const active: CitationStyle = style ?? styles_[0] ?? 'APA'
  const citation = detail ? buildCitation(active, detail, shortUrl || link.data?.canonicalUrl || null) : ''

  /* recordShare returns the POST-increment count, so the line below the tiles
     is authoritative without a second read. */
  const record = async () => {
    try {
      const res: any = await api.research.recordShare(id)
      if (typeof res?.shareCount === 'number') setShareCount(res.shareCount)
    } catch { /* a missed count must never interrupt a share */ }
  }

  const copyLink = async () => {
    if (!shortUrl) return
    await Clipboard.setStringAsync(shortUrl)
    toast.ok('Link copied')
    void record()
  }

  const shareVia = async () => {
    if (!detail) return
    const res = await Share.share({ message: [detail.title, shortUrl].filter(Boolean).join('\n') })
    if (res.action === Share.sharedAction) void record()
  }

  const cite = async () => {
    if (gate !== 'allow') return
    setBusy(true)
    setCiteError(null)
    try {
      await api.research.cite(id)
      setCited(true)
      /* The citer's own CITATION_COUNT_UPDATED is actor-suppressed and the call
         may have been deduped inside the 30-day window, so the authoritative
         number can only come from a re-read. */
      const raw = await api.research.get(id)
      const fresh = adapters.researchDetailFrom(raw) as ResearchDetail
      toast.ok(`Recorded — ${formatCount(fresh.metrics.citations)} citations`)
    } catch (e: any) {
      setCiteError(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen background="elevated">
      <Header closeButton title="Share & cite" border={false} />

      <View style={styles.segments}>
        <Chip label="Share" selected={mode === 'share'} onPress={() => setMode('share')} />
        <Chip label="Cite" selected={mode === 'cite'} onPress={() => setMode('cite')} />
      </View>

      <ScreenScroll contentContainerStyle={{ paddingBottom: space.huge }}>
        {notPublished ? (
          <Callout tone="warning" icon="info" style={styles.block}>
            This paper is not published yet, so it has no public link and cannot be cited.
          </Callout>
        ) : null}

        {mode === 'share' ? (
          <View>
            <View style={[styles.preview, { borderColor: c.borderFaint }]}>
              <ResearchCover
                cover={detail?.cover}
                uri={detail?.coverImageUrl}
                irc={detail?.irc}
                ratio={1}
                radius={12}
                style={styles.previewThumb}
              />
              <View style={styles.flex}>
                <Text variant="subhead" align="auto" numberOfLines={2}>{detail?.title || ' '}</Text>
                <Text variant="caption" tone="muted" align="ui" numberOfLines={1} style={{ marginTop: space.xs }}>
                  {detail?._author.handle ? `@${detail._author.handle}` : ''}
                </Text>
              </View>
            </View>

            <View style={[styles.linkField, { borderColor: c.border, backgroundColor: c.surfaceSunken }]}>
              {link.loading ? (
                <Skeleton width="70%" height={13} />
              ) : (
                <Text variant="footnote" mono numberOfLines={1} align="left" style={styles.flex}>
                  {shortUrl || '—'}
                </Text>
              )}
              <Touchable onPress={copyLink} feedback="dim" disabled={!shortUrl} style={styles.copyBtn}>
                <Text variant="subhead" tone="accent" weight="600">Copy</Text>
              </Touchable>
            </View>

            {link.error && !notPublished ? (
              <ErrorPanel error={link.error} onRetry={link.reload} compact style={styles.block} />
            ) : null}

            <View style={styles.tiles}>
              <ActionTile icon="link" label="Copy link" onPress={copyLink} disabled={!shortUrl} />
              <ActionTile icon="share" label="Share via…" onPress={shareVia} disabled={!shortUrl} />
              <ActionTile
                icon="chat"
                label="Message"
                onPress={() => {
                  if (!shortUrl) return
                  /* The chat share sheet records the share itself once a send
                     lands — same rule as Copy/Share via: only a link that
                     actually left counts. */
                  router.push({
                    pathname: '/chat/share',
                    params: { url: shortUrl, kind: 'research', recordId: id, label: detail?.title || 'Paper' },
                  })
                }}
                disabled={!shortUrl}
              />
              <ActionTile icon="qr" label="QR" onPress={() => setShowQr(v => !v)} disabled={!shortUrl} />
              <ActionTile
                icon="add"
                label="Share to story"
                /* Not gated on the short link: a story carries the paper's
                   cover and title, not a url. Unpublished papers stay out —
                   nobody else could open what the card points at. */
                disabled={!detail || notPublished}
                onPress={() => router.push({
                  pathname: '/story/compose',
                  params: {
                    linkType: 'LINKED_RESEARCH',
                    mediaUrl: sharedAssetPath(detail?.coverImageUrl) ?? '',
                    thumbnailUrl: sharedAssetPath(detail?.coverImageUrl) ?? '',
                    title: detail?.title || 'A paper',
                  },
                } as any)}
              />
            </View>

            {showQr && shortUrl ? (
              <View style={[styles.qr, { backgroundColor: c.qrPlate, borderColor: c.borderFaint }]}>
                {/* The same encoder + qrInk/qrPlate pairing every other QR in
                    the app uses (settings/qr, invite, channel invites) — the
                    plate stays light in BOTH schemes because scanners want
                    dark-on-light. */}
                <QRCode value={shortUrl} size={196} color={c.qrInk} backgroundColor={c.qrPlate} ecl="M" />
                <Text variant="caption" mono align="center" selectable style={{ marginTop: space.sm2 }}>
                  {shortUrl}
                </Text>
              </View>
            ) : null}

            {shareCount != null ? (
              <Text variant="caption" tone="faint" align="center" style={styles.shareCount}>
                Shared {formatCount(shareCount)} times
              </Text>
            ) : null}
          </View>
        ) : (
          <View>
            {gate !== 'allow' ? (
              <SignInPrompt message="Sign in to record that you cited this paper." />
            ) : null}

            <ChipRail style={{ paddingVertical: space.md }}>
              {styles_.map(s => (
                <Chip key={s} label={CITATION_LABEL[s]} selected={s === active} onPress={() => setStyle(s)} />
              ))}
            </ChipRail>

            <View style={[styles.citation, { backgroundColor: c.surfaceSunken }]}>
              <Text variant="footnote" mono align="left" selectable style={{ lineHeight: 20 }}>
                {citation || '—'}
              </Text>
              <Touchable
                onPress={async () => { await Clipboard.setStringAsync(citation); toast.ok('Citation copied') }}
                feedback="dim"
                accessibilityLabel="Copy citation"
                style={[styles.copyPin, { backgroundColor: c.surface }]}
              >
                <Icon name="copy" size={14} color={c.accent} />
              </Touchable>
            </View>

            {citeError ? <ErrorPanel error={citeError} onRetry={cite} compact style={styles.block} /> : null}

            <Button
              label={cited ? 'Citation recorded' : 'I cited this paper'}
              icon={cited ? 'check' : 'cite'}
              variant="secondary"
              block
              size="lg"
              loading={busy}
              disabled={cited || notPublished || gate !== 'allow'}
              onPress={cite}
              style={styles.block}
            />
            <Text variant="caption" tone="faint" align="center" style={{ paddingHorizontal: space.lg, marginTop: space.sm }}>
              Counts once per paper every 30 days.
            </Text>
          </View>
        )}
      </ScreenScroll>
    </Screen>
  )
}

function ActionTile({
  icon, label, onPress, disabled,
}: { icon: IconName; label: string; onPress: () => void; disabled?: boolean }) {
  const t = useTheme()
  const c = t.colors
  return (
    <Touchable
      onPress={onPress}
      disabled={disabled}
      feedback="scale"
      noAutoHitSlop
      accessibilityLabel={label}
      style={styles.tile}
    >
      <View style={[styles.tileCircle, { backgroundColor: c.surfaceSunken }]}>
        <Icon name={icon} size={22} color={c.textSecondary} />
      </View>
      <Text variant="caption" tone="muted" align="center" numberOfLines={1}>{label}</Text>
    </Touchable>
  )
}

const styles = StyleSheet.create({
  segments: { flexDirection: 'row', gap: space.sm, paddingHorizontal: space.lg, paddingBottom: space.md },
  block: { marginHorizontal: space.lg, marginTop: space.md2 },
  preview: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    marginHorizontal: space.lg, padding: space.md, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth,
  },
  previewThumb: { width: 56, height: 56 },
  linkField: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm2,
    marginHorizontal: space.lg, marginTop: space.md2, paddingStart: space.md, paddingEnd: space.xs, height: 46,
    borderRadius: 12, borderWidth: StyleSheet.hairlineWidth,
  },
  copyBtn: { paddingHorizontal: space.md, paddingVertical: space.sm },
  tiles: { flexDirection: 'row', justifyContent: 'space-around', paddingHorizontal: space.sm, paddingTop: 22 },
  tile: { alignItems: 'center', gap: space.sm, width: 72 },
  tileCircle: { width: 64, height: 64, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  qr: {
    marginHorizontal: space.lg, marginTop: space.lg2, padding: space.lg, borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth, alignItems: 'center',
  },
  shareCount: { paddingTop: space.lg2 },
  citation: { marginHorizontal: space.lg, padding: space.md2, paddingTop: space.lg2, borderRadius: 12, minHeight: 120 },
  copyPin: { position: 'absolute', top: 8, end: 8, width: 30, height: 30, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1 },
})
