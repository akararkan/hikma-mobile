/* =========================================================
   The running client build.
   ---------------------------------------------------------
   `GET /api/v1/app/config` is the only reliable way to retire a
   client with a security defect: the client compares ITSELF
   against minSupportedVersion before it lets anyone in. That
   only works if the client actually knows its own version — a
   hardcoded "1.0.0" makes the gate permanently satisfied and the
   `appVersion` recorded on every consent event a lie.

   RN: vite.config.js injected __APP_VERSION__ / __APP_BUILD__ as build-time
   globals. Metro has no equivalent, so the version is resolved from, in order:

     1. EXPO_PUBLIC_APP_VERSION  — a release pipeline stamping its own number
     2. expo-constants           — `version` in app.json, which is the number
                                   the store actually ships and therefore the
                                   one worth comparing against
                                   minSupportedVersion
     3. '0.0.0'                  — deliberately FAILING, not a satisfied gate

   The build stamp falls back to the native build number (iOS
   CFBundleVersion / Android versionCode), which is the closest native analogue
   to the web build's ISO timestamp and is what a bug report needs.
   ========================================================= */
import Constants from 'expo-constants'
import { Platform } from 'react-native'
import { APP_VERSION, APP_BUILD } from '../platform/env.js'

const expoConfig = Constants.expoConfig || {}

const nativeBuild = Platform.select({
  ios: expoConfig.ios?.buildNumber,
  android: expoConfig.android?.versionCode != null ? String(expoConfig.android.versionCode) : '',
  default: '',
}) || ''

/** Semver of the running bundle, e.g. "1.4.2". */
export const CLIENT_VERSION = APP_VERSION || expoConfig.version || '0.0.0'

/** Build stamp, for the About card and bug reports. */
export const CLIENT_BUILD = APP_BUILD || nativeBuild || ''

/** Compare two dotted versions. -1 / 0 / 1; unparsable parts count as 0. */
export function compareVersions(a, b) {
  const pa = String(a || '').split('.').map(n => parseInt(n, 10) || 0)
  const pb = String(b || '').split('.').map(n => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d) return d < 0 ? -1 : 1
  }
  return 0
}
