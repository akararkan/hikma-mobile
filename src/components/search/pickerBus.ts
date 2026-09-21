/* =========================================================
   pickerBus — how a modal picker returns a selection.

   Route params carry strings, and expo-router has no
   `popTo(result)`. So a picker writes its payload onto the app
   event bus keyed by a `sink` name and calls `router.back()`;
   the opener subscribes in an effect keyed by the same sink.

   The sink is passed IN through route params (a string, which
   params can carry), which is what keeps two pickers open at
   once from crossing wires.
   ========================================================= */
import React from 'react'
import { emit, on } from '@/platform/appEvents'

export const PICKER_EVENT = 'ika:picker'

export function emitPick(sink: string, payload: unknown): void {
  emit(PICKER_EVENT, { sink, payload })
}

export function onPick(sink: string, cb: (payload: any) => void): () => void {
  return on(PICKER_EVENT, (e: any) => {
    if (e?.detail?.sink === sink) cb(e.detail.payload)
  })
}

/** Subscribe for the life of a component. The handler is held in a ref so an
 *  inline arrow does not re-subscribe on every render. */
export function usePickResult(sink: string | null | undefined, cb: (payload: any) => void): void {
  const ref = React.useRef(cb)
  ref.current = cb
  React.useEffect(() => {
    if (!sink) return
    return onPick(sink, p => ref.current(p))
  }, [sink])
}
