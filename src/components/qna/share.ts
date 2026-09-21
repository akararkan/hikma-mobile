/* =========================================================
   Sharing a question.

   Two calls, deliberately: `shareLink` is a PREVIEW and does
   not move the counter, so it is safe to call on mount to seed
   the metric. `recordShare` is the one that increments, and it
   only fires once the user actually completed a share — a
   dismissed native sheet must not inflate the number.

   QuestionView carries no share field (questionFrom does not
   map one), so the share count lives in screen state seeded
   from the preview and overwritten by SHARE_COUNT_UPDATED.
   ========================================================= */
import React from 'react'
import { Share } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import { errorText } from '@/api'
import { qna } from './api'
import { toast } from '@/ui'
import type { ShareLinkInfo } from './types'

/** The one-shot forms, for a card's overflow sheet where there is no screen
 *  state to seed. Both resolve the link first, then record only on success. */
export async function shareQuestion(questionId: string, title?: string): Promise<number | null> {
  try {
    const info: ShareLinkInfo = await qna.shareLink(questionId)
    const url = info?.shortUrl || info?.canonicalUrl
    if (!url) return null
    const out = await Share.share(title ? { message: `${title}\n${url}`, url } : { message: url, url })
    if (out.action !== Share.sharedAction) return info.shareCount ?? null
    const after: ShareLinkInfo = await qna.recordShare(questionId)
    return after?.shareCount ?? null
  } catch (e: any) {
    toast.error(errorText(e))
    return null
  }
}

/** Resolve the short link and hand it to the chat share sheet. Records
 *  NOTHING here — the sheet records once a send actually lands, which keeps
 *  "opened the picker and backed out" off the author's counter. */
export async function sendQuestionToChat(
  router: { push: (href: any) => void }, questionId: string, title?: string,
): Promise<void> {
  try {
    const info: ShareLinkInfo = await qna.shareLink(questionId)
    const url = info?.shortUrl || info?.canonicalUrl
    if (!url) { toast.error('Could not build a link for this question.'); return }
    router.push({
      pathname: '/chat/share',
      params: { url, kind: 'question', recordId: questionId, label: title || 'Question' },
    })
  } catch (e: any) {
    toast.error(errorText(e))
  }
}

export async function copyQuestionLink(questionId: string): Promise<void> {
  try {
    const info: ShareLinkInfo = await qna.shareLink(questionId)
    const url = info?.shortUrl || info?.canonicalUrl
    if (!url) { toast.error('Could not build a link for this question.'); return }
    await Clipboard.setStringAsync(url)
    toast.ok('Link copied')
    await qna.recordShare(questionId)
  } catch (e: any) {
    toast.error(errorText(e))
  }
}

export function useQuestionShare(questionId: string | undefined, title?: string) {
  const [info, setInfo] = React.useState<ShareLinkInfo | null>(null)
  const [shares, setShares] = React.useState(0)

  React.useEffect(() => {
    if (!questionId) return
    let alive = true
    qna.shareLink(questionId)
      .then((res: ShareLinkInfo) => { if (alive && res) { setInfo(res); setShares(res.shareCount ?? 0) } })
      /* Decoration: a failed preview costs the user a number, not a screen. */
      .catch(() => {})
    return () => { alive = false }
  }, [questionId])

  const link = React.useCallback(async (): Promise<ShareLinkInfo | null> => {
    if (!questionId) return null
    if (info) return info
    try {
      const res: ShareLinkInfo = await qna.shareLink(questionId)
      setInfo(res)
      setShares(res?.shareCount ?? 0)
      return res
    } catch { return null }
  }, [questionId, info])

  const record = React.useCallback(async () => {
    if (!questionId) return
    try {
      const res: ShareLinkInfo = await qna.recordShare(questionId)
      if (res && typeof res.shareCount === 'number') setShares(res.shareCount)
    } catch { /* the share already happened; a failed count is not the user's problem */ }
  }, [questionId])

  const shareNow = React.useCallback(async () => {
    const res = await link()
    const url = res?.shortUrl || res?.canonicalUrl
    if (!url) { toast.error('Could not build a link for this question.'); return }
    try {
      const out = await Share.share(title ? { message: `${title}\n${url}`, url } : { message: url, url })
      if (out.action === Share.sharedAction) await record()
    } catch (e: any) {
      toast.error(errorText(e))
    }
  }, [link, record, title])

  const copyLink = React.useCallback(async () => {
    const res = await link()
    const url = res?.shortUrl || res?.canonicalUrl
    if (!url) { toast.error('Could not build a link for this question.'); return }
    await Clipboard.setStringAsync(url)
    toast.ok('Link copied')
    await record()
  }, [link, record])

  return { shares, setShares, shareNow, copyLink }
}
