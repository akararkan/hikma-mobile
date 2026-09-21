/* =========================================================
   The mock switch, and nothing else.
   ---------------------------------------------------------
   Split out from ./index.js so a module can ask "are we
   mocking?" synchronously without dragging data.json into its
   bundle. index.js holds the fixture; this file holds only the
   three lines that decide whether to open it.

   PORTED: `import.meta.env` → ../platform/env.js,
           `localStorage`    → ../platform/storage.js (MMKV, sync —
                               the sync contract matters here too,
                               because mockEnabled() is called from
                               inside request()).
   ========================================================= */
import { USE_MOCK, MOCK_LANG, MOCK_DELAY_MS } from '../platform/env.js'
import { storage } from '../platform/storage.js'

const ENV_ON = USE_MOCK === true

function read(key) {
  try { return storage.getItem(key) } catch { return null }
}

/** Is mock mode active right now?
 *  The stored key wins over the build flag, so one device can demo against
 *  fixtures while the same build serves real data everywhere else.
 *  Flip it from anywhere: `storage.setItem('ika_mock', 'on' | 'off')`. */
export function mockEnabled() {
  const o = read('ika_mock')
  if (o === 'on' || o === 'true') return true
  if (o === 'off' || o === 'false') return false
  return ENV_ON
}

/** Fixture language: en | ar | ku | tr. */
export function mockLang() {
  const v = String(read('ika_mock_lang') || MOCK_LANG || 'en').toLowerCase()
  return ['en', 'ar', 'ku', 'tr'].includes(v) ? v : 'en'
}

/** Fake latency in ms — keeps loading and skeleton states visible in a demo. */
export const MOCK_DELAY = Number(MOCK_DELAY_MS ?? 220) || 0
