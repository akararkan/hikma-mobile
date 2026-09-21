/* =========================================================
   Land a question short link.

   {base}/q/{token} (qna/engagement.md "Share") — the token is
   simply the question UUID, so this is a pure path mirror onto
   the question screen, which owns the not-found state.
   ========================================================= */
import React from 'react'
import { Redirect, useLocalSearchParams } from 'expo-router'

export default function QuestionShortLinkScreen() {
  const { token } = useLocalSearchParams<{ token: string }>()
  return <Redirect href={`/qna/${decodeURIComponent(String(token || ''))}`} />
}
