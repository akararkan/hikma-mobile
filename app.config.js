/* =========================================================
   Dynamic config over app.json.

   One job: pick up ./google-services.json AUTOMATICALLY the
   moment it exists, so enabling real Android push is "download
   one file from the Firebase console into the repo root and
   rebuild" — no config edit, nothing to forget. Until the file
   exists this exports app.json unchanged, and the build works
   exactly as before (push then rides the SSE local-notification
   path only). See PUSH.md for the 5-minute Firebase walkthrough.

   Second job: DROP the iOS push entitlement. expo-notifications'
   iOS plugin writes `aps-environment` into the entitlements on
   every prebuild (withNotificationsIOS.js), and Apple treats that
   key as the Push Notifications capability — which a FREE
   "Personal Team" is not allowed to sign. The result is a build
   that dies at signing with "Personal development teams do not
   support the Push Notifications capability", and deleting the
   key by hand does not help because the next prebuild puts it
   back.

   Nothing is lost by removing it: this app has no APNs
   integration at all. Notifications arrive over the SSE streams
   and are raised locally, which needs no entitlement. The day a
   real APNs setup lands (a paid team + PUSH.md's Firebase step),
   delete this block and the entitlement returns on its own.
   ========================================================= */
const fs = require('fs')
const path = require('path')
const { withEntitlementsPlist } = require('expo/config-plugins')

/** Runs AFTER expo-notifications has added the key, so it is the last word.
 *  Opt back IN with IKA_IOS_PUSH=1 once a PAID Apple Developer team is in
 *  place — that is the only kind Apple lets sign this entitlement. */
const withoutPushEntitlement = cfg => withEntitlementsPlist(cfg, mod => {
  delete mod.modResults['aps-environment']
  return mod
})

const iosPushWanted = process.env.IKA_IOS_PUSH === '1'

/* The link paths the app claims on its domains — the same closed set
   lib/shareLinks.ts parses and src/app mirrors as file routes. Kept as data
   so the Android intent filter and LINKS.md's AASA sample cannot drift. */
const LINK_PATH_PREFIXES = [
  '/p', '/post', '/posts', '/r', '/research', '/q', '/qna',
  '/live', '/c', '/u', '/join', '/story',
]

/** Third job: Universal Links (iOS) / App Links (Android).

    `EXPO_PUBLIC_LINK_DOMAINS` is a comma-separated list of bare hosts (the
    short-link host and the web app's host, e.g. "share.example.com,
    app.example.com"). When set, a prebuild claims the LINK_PATH_PREFIXES
    above on those domains, so a tapped https share link opens the app
    directly at the right screen. Unset (every dev build today), nothing is
    added and nothing changes.

    The OTHER half lives on the domain itself — /.well-known/
    apple-app-site-association and assetlinks.json, spelled out in LINKS.md.
    Without those files the OS ignores these claims by design. */
const withAppLinks = cfg => {
  const domains = String(process.env.EXPO_PUBLIC_LINK_DOMAINS || '')
    .split(',').map(s => s.trim()).filter(Boolean)
  if (!domains.length) return cfg
  cfg.ios = {
    ...cfg.ios,
    associatedDomains: [
      ...(cfg.ios?.associatedDomains || []),
      ...domains.map(d => `applinks:${d}`),
    ],
  }
  cfg.android = {
    ...cfg.android,
    intentFilters: [
      ...(cfg.android?.intentFilters || []),
      {
        action: 'VIEW',
        autoVerify: true,
        data: domains.flatMap(host =>
          LINK_PATH_PREFIXES.map(pathPrefix => ({ scheme: 'https', host, pathPrefix })),
        ),
        category: ['BROWSABLE', 'DEFAULT'],
      },
    ],
  }
  return cfg
}

module.exports = ({ config }) => {
  const googleServices = path.join(__dirname, 'google-services.json')
  if (fs.existsSync(googleServices)) {
    config.android = { ...config.android, googleServicesFile: './google-services.json' }
  }
  /* Same auto-detect for the iOS plist. Inert until a paid Apple team +
     IKA_IOS_PUSH=1 exist (prebuild just copies it into the Xcode project),
     but it means iOS needs no config edit on that day either. */
  const googleServicesIos = path.join(__dirname, 'GoogleService-Info.plist')
  if (fs.existsSync(googleServicesIos)) {
    config.ios = { ...config.ios, googleServicesFile: './GoogleService-Info.plist' }
  }
  config = withAppLinks(config)
  /* Keeping the entitlement is the DEFAULT-OFF case, not the other way round:
     a free "Personal Team" cannot sign aps-environment, and the failure is
     not a warning — Xcode refuses to create the provisioning profile at all,
     which also blocks the certificate, which reads downstream as the baffling
     "No code signing certificates are available to use". Off by default keeps
     the app installable; the day the team is paid, set IKA_IOS_PUSH=1. */
  return iosPushWanted ? config : withoutPushEntitlement(config)
}
