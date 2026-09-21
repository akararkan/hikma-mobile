/* =========================================================
   Masking a delivery destination.

   Use the masked form on a screen someone else might read over
   a shoulder, and the FULL address on the settings verify-email
   card — there it has to be unambiguous which inbox to open,
   and `a***@gmail.com` is not.
   ========================================================= */

/** ahmad@example.com → a***@example.com */
export function maskEmail(value?: string | null): string {
  const s = String(value || '').trim()
  const at = s.lastIndexOf('@')
  if (at < 1) return s
  const local = s.slice(0, at)
  const domain = s.slice(at)
  if (local.length <= 1) return `${local}***${domain}`
  return `${local[0]}${'*'.repeat(Math.min(3, local.length - 1))}${domain}`
}

/** +9647701565811 → +964·····5811 */
export function maskPhone(value?: string | null): string {
  const s = String(value || '').trim()
  const digits = s.replace(/\D/g, '')
  if (digits.length < 6) return s
  const head = s.startsWith('+') ? `+${digits.slice(0, 3)}` : digits.slice(0, 2)
  return `${head}${'·'.repeat(5)}${digits.slice(-4)}`
}
