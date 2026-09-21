# LINKS — share links, rich previews, and opening the app from a URL

The contract between a shared link, the preview card it paints in WhatsApp /
iMessage / X / Telegram, and the tap that opens this app at the right screen.
The app side is **done and shipped in this repo**; the domain side is a small,
exact checklist for whoever operates the backend host. Nothing here needs a
third-party service.

## What already works

**The backend already mints preview-ready links.** Every share surface uses
the server's own short link, never a raw API URL:

| Content   | Link shape            | Minted by                              |
|-----------|-----------------------|----------------------------------------|
| Post/Reel | `{base}/p/{postId}`   | `GET /api/v1/posts/{id}/share-link` — "Public OG-tagged URL … safe for chats/tweets" (engagement.md §5.3) |
| Research  | `{base}/r/{token16}`  | `GET /api/v1/researches/{id}/share-link` |
| Question  | `{base}/q/{questionId}` | `GET /api/v1/questions/{id}/share-link` |
| Live      | `{base}/live/{id}`    | `shareUrl` on the stream row           |
| Channel   | `{base}/c/{handle}`   | `shareUrl` on the channel row (null for private) |
| Invite    | `{base}/join/{token}` | invite-link endpoints                  |

**The app claims every one of those paths.** File-based routes exist for
`/p`, `/post(s)`, `/r`, `/research`, `/q`, `/qna`, `/live`, `/c`, `/u`,
`/join`, `/story` — so once the OS hands the app a link, expo-router lands on
the right screen with no extra glue. `src/lib/shareLinks.ts` is the same
closed grammar on the send side.

**Share UX** (post sheet, research sheet, reel/live/story/profile/channel/QnA
menus): Copy Link with inline "Copied" swap, **Send in a message** (in-app
recipient picker, sequential sends, one ledger write), Share to story,
Repost, and "Share via…" for the OS sheet. Share sheets present as slide-up
form sheets. Share events are recorded server-side (`POST /{id}/share` →
ledger row + counter + `POST_SHARED` notification).

**Deep-link claims are wired but dormant.** `app.config.js` reads
`EXPO_PUBLIC_LINK_DOMAINS` (comma-separated bare hosts) and, when set, adds
iOS `associatedDomains` and Android `autoVerify` intent filters for exactly
the paths above. Empty = nothing changes, which is every dev build today.

## What the domain must host (the only missing half)

Universal Links (iOS) and App Links (Android) are free and built into the
OS, but the OS only trusts a domain that proves the association. Host these
two files **on every domain in `EXPO_PUBLIC_LINK_DOMAINS`**, served over
https with `Content-Type: application/json`, no redirects:

### 1. `https://<domain>/.well-known/apple-app-site-association`

```json
{
  "applinks": {
    "details": [
      {
        "appIDs": ["<TEAMID>.com.ika.mobile"],
        "components": [
          { "/": "/p/*" }, { "/": "/post/*" }, { "/": "/posts/*" },
          { "/": "/r/*" }, { "/": "/research/*" },
          { "/": "/q/*" }, { "/": "/qna/*" },
          { "/": "/live/*" }, { "/": "/c/*" }, { "/": "/u/*" },
          { "/": "/join/*" }, { "/": "/story/*" }
        ]
      }
    ]
  }
}
```

`<TEAMID>` is the Apple Developer Team ID (Membership page of the developer
account — the one that signs the app; there is no signing identity on this
machine yet, so fill it in when the Apple ID lands).

### 2. `https://<domain>/.well-known/assetlinks.json`

```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "com.ika.mobile",
      "sha256_cert_fingerprints": ["<SHA256_OF_SIGNING_CERT>"]
    }
  }
]
```

Get the fingerprint from the keystore that signs the build:
`cd android && ./gradlew signingReport` (use the `SHA-256` of the variant you
ship; debug and release differ — list both while developing).

### 3. The link page itself (rich previews + web fallback)

The short-link pages are documented as OG-tagged already. The bar they must
clear — per post, not app-wide:

- `og:title`, `og:description`, `og:image` (or `og:video` for clips),
  `og:url`, plus `twitter:card = summary_large_image`. Crawlers (WhatsApp,
  iMessage, X, Slack) do **not** run JavaScript — the tags must be in the
  server-rendered HTML.
- A human who opens the link **without the app** should see the content
  itself (title, media, author), not a "download the app" wall — with an
  optional, quiet "Open in app" affordance.
- Deleted/private content → a clean 404 page (the app's own screens already
  handle their side of that).

## Turning it on (app side)

1. Set `EXPO_PUBLIC_LINK_DOMAINS=<host1>,<host2>` in `.env`.
2. Rebuild the native app once (`npm run android` / `npm run ios`) — intent
   filters and entitlements are baked at prebuild.
3. Verify:
   - Android: `adb shell pm get-app-links com.ika.mobile` → the domains
     should read `verified`.
   - iOS: install, then tap a link from Notes/Messages (not Safari's URL bar
     — Safari deliberately stays in the browser).
   - Previews: paste a real short link into WhatsApp, iMessage and X, and
     run it through the Facebook Sharing Debugger / X Card Validator. Meta
     tags in devtools are not the test; the pasted card is.

## Explicitly out

- **Firebase Dynamic Links** — shut down August 25, 2025. Not used, and must
  not be reintroduced.
- **Branch / AppsFlyer / Adjust** — only needed for *deferred* deep linking
  (link → store install → first launch lands on the post) plus attribution
  analytics. That is a product decision with a price tag; the self-hosted
  setup above covers "installed → open the right screen, not installed →
  clean web view" with zero dependencies. Revisit only if install
  attribution becomes a real requirement.
- **Share-channel analytics** — the ledger records who shared what (+ an
  optional caption). It has no `channel` field (chat / story / external), so
  per-channel conversion cannot be split server-side today. Noted in the
  backend suggestions list; harmless to add later as an optional enum on
  `RecordShareRequest`.
