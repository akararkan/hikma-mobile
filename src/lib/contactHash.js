/* =========================================================
   contactHash — the client half of contact matching
   ---------------------------------------------------------
   The server NEVER sees an address book. It stores only
   SHA-256 hashes, and matching is a hash join against other
   users' identity hashes — so the hashing contract is not an
   implementation detail, it IS the interoperability surface:
   a normalisation that differs by one space or one uppercase
   letter produces a hash that can never match anything, and
   the failure is silent (zero suggestions, no error).

   The contract, verbatim from the API doc:

     email → sha256(lowercase(trim(email)))      hex
     phone → sha256(E.164 digits, no '+')        hex

   Two consequences worth stating:

   · RN: `crypto.subtle` does not exist at all on native, and
     the secure-context idea does not apply — expo-crypto is
     always available. `canHashContacts()` therefore returns
     true, and InsecureContextError is kept only so the shape
     of the module (and any caller that catches it by name)
     is unchanged. The contract above is byte-identical, which
     is the part that matters: the hash IS the interop surface
     and web and mobile must produce the same hex for the same
     contact.
   · Nothing here ever keeps the raw values. The caller hands
     over strings, gets hashes back, and the originals are
     garbage the moment the call returns.
   ========================================================= */
import * as Crypto from 'expo-crypto'
import * as Localization from 'expo-localization'
import { dialOf } from './dialCodes.js'

/** Max hashes the server accepts in one sync (documented). */
export const MAX_HASHES_PER_SYNC = 5000

/* The calling code assumed for numbers stored without one ("0770 156 5811").
   The doc is explicit: convert to E.164 ON THE DEVICE, where the user's region
   is known — the server's own fallback assumes Iraq and would mangle a foreign
   number. Device region → dial code; the server's default (964) only when the
   region is unknown or unmapped. */
function defaultDialCode() {
  try {
    const region = Localization.getLocales?.()[0]?.regionCode
    return (region && dialOf(region)) || '964'
  } catch {
    return '964'
  }
}

export class InsecureContextError extends Error {
  constructor() {
    super('Contact hashing needs a secure context (https or localhost).')
    this.name = 'InsecureContextError'
  }
}

/** true when hashing is possible here — gate the UI on this, not on a try/catch.
 *  Always true on native: expo-crypto has no secure-context precondition. */
export function canHashContacts() {
  return true
}

/* RN: `crypto.subtle.digest` over a TextEncoder buffer becomes
   `Crypto.digestStringAsync`, which hashes the UTF-8 bytes of the string and
   returns lowercase hex — the same bytes in and the same hex out, so a hash
   minted here joins against one minted by the web client. */
async function sha256Hex(input) {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, input, {
    encoding: Crypto.CryptoEncoding.HEX,
  })
}

/** One short fingerprint of a whole hash set, for answering "has the address
 *  book changed since last time?" without keeping the book.
 *
 *  Sorted first: `hashContacts` emits in address-book order, which reshuffles
 *  between reads of an identical book and would make every sync look new.
 *
 *  Only the digest is ever stored. The hashes themselves are not — a stored
 *  hash set IS an address book on disk, which is exactly what this module's
 *  header promises never to keep. */
export async function digestOfHashes(hashes) {
  return sha256Hex([...(hashes || [])].sort().join(','))
}

/** `  Amina@Example.COM ` → `amina@example.com`, or '' when it isn't an email. */
export function normalizeEmail(raw) {
  const v = String(raw || '').trim().toLowerCase()
  // Deliberately permissive — the server does the real matching. This only
  // rejects entries that are obviously not addresses, so they don't burn
  // slots against the 5000 cap.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : ''
}

/** `+964 (750) 123-4567` → `9647501234567`, `0770 156 5811` → `9647701565811`,
 *  or '' when it can't be coerced to a plausible number.
 *
 *  E.164 digits, no '+'. This mirrors the server's conservative PhoneNormalizer
 *  step for step (leading '+', international '00' prefix, trunk '0' rewritten
 *  with the calling code, trunk '0' AFTER the code stripped, 8–15 length band)
 *  — it has to, because the identity hash the server matches against is
 *  sha256(E.164 without '+'): a locally-formatted number hashed verbatim would
 *  verify nothing and silently never match. */
export function normalizePhone(raw, dial = defaultDialCode()) {
  const s = String(raw || '').trim()
  const hadPlus = s.startsWith('+')
  const digits = s.replace(/\D+/g, '')
  if (!digits) return ''
  let e164
  if (hadPlus) e164 = digits                                   // already international
  else if (digits.startsWith('00')) e164 = digits.slice(2)     // 00<cc>… international prefix
  else if (digits.startsWith('0')) e164 = dial + digits.slice(1)  // national, drop trunk 0
  else if (digits.startsWith(dial)) e164 = digits              // already carries the code
  else e164 = dial + digits                                    // bare national number
  /* Trunk 0 after the country code — "+964 0770…". National-dialling only,
     never part of E.164; default-country numbers only (Italy keeps its 0). */
  if (e164.startsWith(dial + '0')) e164 = dial + e164.slice(dial.length + 1)
  return e164.length >= 8 && e164.length <= 15 ? e164 : ''
}

/**
 * Hash a mixed list of address-book entries.
 *
 * Each entry may be a string (sniffed as email-or-phone) or
 * `{ email, phone }` — a single contact card contributes BOTH hashes, which is
 * what makes a person matchable by either identity.
 *
 * @returns {Promise<{hashes: string[], skipped: number, emails: number, phones: number}>}
 *          `hashes` is deduped and capped at MAX_HASHES_PER_SYNC.
 */
export async function hashContacts(entries = []) {
  if (!canHashContacts()) throw new InsecureContextError()

  const values = []          // [kind, normalised]
  let skipped = 0
  for (const entry of entries) {
    if (!entry) { skipped++; continue }
    const candidates = typeof entry === 'string'
      ? [entry.includes('@') ? ['email', entry] : ['phone', entry]]
      : [['email', entry.email], ['phone', entry.phone]]
    let took = 0
    for (const [kind, raw] of candidates) {
      if (!raw) continue
      const v = kind === 'email' ? normalizeEmail(raw) : normalizePhone(raw)
      if (v) { values.push([kind, v]); took++ }
    }
    if (!took) skipped++
  }

  // Dedupe BEFORE hashing: an address book repeats the same address across
  // cards constantly, and each duplicate would otherwise cost a digest and a
  // slot against the cap.
  const seen = new Set()
  const unique = values.filter(([kind, v]) => {
    const key = kind + ':' + v
    if (seen.has(key)) return false
    seen.add(key); return true
  })

  const capped = unique.slice(0, MAX_HASHES_PER_SYNC)
  const hashes = await Promise.all(capped.map(([, v]) => sha256Hex(v)))

  return {
    hashes,
    skipped: skipped + (unique.length - capped.length),
    emails: capped.filter(([k]) => k === 'email').length,
    phones: capped.filter(([k]) => k === 'phone').length,
  }
}

/**
 * Parse a pasted / imported contact blob into entries `hashContacts` accepts.
 * Handles the two formats a person can actually produce without tooling:
 * one-per-line text, and a vCard export (`.vcf`, the format every phone and
 * mail client exports) — from which only EMAIL/TEL lines are read and
 * everything else (names, addresses, photos) is ignored outright.
 */
export function parseContactBlob(text) {
  const src = String(text || '')
  if (/BEGIN:VCARD/i.test(src)) {
    const out = []
    for (const line of src.split(/\r?\n/)) {
      const m = /^(EMAIL|TEL)[^:]*:(.+)$/i.exec(line.trim())
      if (!m) continue
      out.push(m[1].toUpperCase() === 'EMAIL' ? { email: m[2] } : { phone: m[2] })
    }
    return out
  }
  return src.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean)
}
