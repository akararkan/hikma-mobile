/* =========================================================
   The two size/duration labels every media surface prints.

   They lived three times over (qna, research, search) and had
   already drifted: 1536 bytes read as "1.5 KB" on an answer's
   attachment and "2 KB" on the same file inside a paper. One
   file, one answer — a feature module re-exports from here so
   no call site has to move.
   ========================================================= */

/** mm:ss. Notes and clips are minutes long, so an hours component is noise. */
export function formatDuration(seconds: number | null | undefined): string {
  const s = Math.max(0, Math.round(Number(seconds) || 0))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

const UNITS = ['B', 'KB', 'MB', 'GB']

export interface FormatBytesOptions {
  /** What a missing/zero size prints as. Research's file rows join their
   *  metadata with ' · ' and want the segment to vanish entirely; an upload
   *  progress line wants a real "0 B" so the row does not reflow when the
   *  first chunk lands. */
  zero?: string
}

export function formatBytes(n: number | null | undefined, opts?: FormatBytesOptions): string {
  let v = Number(n) || 0
  if (v <= 0) return opts?.zero ?? '0 B'
  let i = 0
  while (v >= 1024 && i < UNITS.length - 1) { v /= 1024; i += 1 }
  /* Bytes are whole; everything above keeps one decimal until the number is
     big enough that the decimal is noise. */
  return `${i === 0 ? Math.round(v) : v.toFixed(v < 10 ? 1 : 0)} ${UNITS[i]}`
}
