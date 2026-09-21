/* =========================================================
   The share-message grammar.

   The backend has NO share message type (messages.md §2.1:
   TEXT|IMAGE|VIDEO|VOICE|FILE). A share into a chat is a TEXT
   message whose body carries the backend's own short link —
   the "safe for chats" `shortUrl` the share endpoints mint
   (engagement.md §5.3) — optionally under a caption line.

   This module is the single grammar both ends speak:

     shareMessageBody()   the SEND side — compose the body
     splitShareBody()     the RECEIVE side — recognise one of
                          our links in a body and hand back the
                          reference plus the caption remainder
     shareSnippet()       inbox rows / reply strips / pin bars

   Recognition is by PATH SHAPE, not host: the short-link host
   is whatever `irc.base-url` says (LAN IP in dev, a domain in
   prod) and app-scheme deep links have no host at all — so the
   id segment carries the burden of proof instead. Two-segment
   paths only, with the id validated per kind (UUID where the
   backend mints UUIDs), which is what keeps a pasted
   youtube.com/live/dQw4w9WgXcQ from dressing up as a stream.

   Pure module: no React, no react-native — format.ts imports it.
   ========================================================= */

export type ShareKind =
  | 'post' | 'research' | 'question' | 'live'
  | 'channel' | 'invite' | 'profile' | 'story'

export interface ShareRef {
  kind: ShareKind
  /** The id segment: post/question/stream/user id, channel or profile
   *  handle, research share token or id, invite token. */
  ref: string
  /** How `ref` identifies the thing — decides which lookup a card uses. */
  via: 'id' | 'token' | 'handle'
  /** The matched URL exactly as it appeared in the body. */
  url: string
  /** The in-app route this share opens (mirrors the web paths — /r, /c,
   *  /u and /join are file-based routes for exactly this reason). */
  route: string
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/* Research share tokens are 16-char mints (research.md "shareToken");
   invite tokens are opaque. Both: url-safe, and never UUID-shaped here. */
const TOKEN = /^[A-Za-z0-9_-]{8,64}$/
const HANDLE = /^[A-Za-z0-9_.]{2,40}$/

/** The path of any URL form a share can travel as: https short links,
 *  `scheme://story/…` app links, and dev-client `exp://host/--/story/…`. */
function pathOf(raw: string): string | null {
  const m = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)([^?#]*)/i.exec(raw)
  if (!m) return null
  const scheme = m[1].toLowerCase()
  let path = m[3] || ''
  if (scheme === 'exp' || scheme === 'exps') {
    const cut = path.indexOf('/--/')
    if (cut < 0) return null
    path = path.slice(cut + 3)
  } else if (scheme !== 'http' && scheme !== 'https') {
    /* A custom scheme has no origin: `ikamobileapp://story/9f…` parses its
       first segment into the host slot. Fold it back into the path. */
    path = `/${m[2]}${path}`
  }
  return path
}

export function parseShareUrl(url: string): ShareRef | null {
  const path = pathOf(String(url || '').trim())
  if (!path) return null
  const seg = path.split('/').filter(Boolean)
  if (seg.length !== 2) return null
  const [head, ref] = [seg[0].toLowerCase(), decodeURIComponent(seg[1])]

  const make = (kind: ShareKind, via: ShareRef['via'], route: string): ShareRef =>
    ({ kind, ref, via, url, route })

  switch (head) {
    /* Posts and reels — reels ARE posts (postType REEL), one link shape. */
    case 'p':
    case 'post':
    case 'posts':
      return UUID.test(ref) ? make('post', 'id', `/post/${ref}`) : null
    /* /r/{token} is the backend short link; /research/{id} the canonical. */
    case 'r':
      return !UUID.test(ref) && TOKEN.test(ref) ? make('research', 'token', `/r/${ref}`) : null
    case 'research':
    case 'researches':
      return UUID.test(ref) ? make('research', 'id', `/research/${ref}`) : null
    case 'q':
    case 'qna':
    case 'questions':
      return UUID.test(ref) ? make('question', 'id', `/qna/${ref}`) : null
    case 'live':
    case 'streams':
      return UUID.test(ref) ? make('live', 'id', `/live/${ref}`) : null
    case 'c':
      return HANDLE.test(ref) ? make('channel', 'handle', `/c/${ref}`) : null
    case 'join':
      return TOKEN.test(ref) ? make('invite', 'token', `/join/${ref}`) : null
    case 'u':
      return HANDLE.test(ref) ? make('profile', 'handle', `/u/${ref}`) : null
    /* Story links are per-AUTHOR (the tray has no per-frame address). */
    case 'story':
      return TOKEN.test(ref) || UUID.test(ref) ? make('story', 'id', `/story/${ref}`) : null
    default:
      return null
  }
}

/* Everything URL-shaped in a body: http(s), exp dev links, app schemes.
   The `://` is the anchor — bare hosts and mailto: stay untouched. */
const URL_RE = /[a-z][a-z0-9+.-]*:\/\/[^\s<>"'`\])]+/gi

/** The receive side: the FIRST recognisable share link in a body, plus the
 *  body with that link lifted out (the caption). Null → an ordinary message. */
export function splitShareBody(body: string): { share: ShareRef; rest: string } | null {
  const text = String(body || '')
  if (!text.includes('://')) return null
  for (const m of text.matchAll(URL_RE)) {
    /* Trailing sentence punctuation belongs to the prose, not the URL. */
    const raw = m[0].replace(/[.,;:!?]+$/, '')
    const share = parseShareUrl(raw)
    if (!share) continue
    const rest = (text.slice(0, m.index) + text.slice((m.index ?? 0) + raw.length))
      .replace(/[ \t]{2,}/g, ' ')
      .trim()
    return { share, rest }
  }
  return null
}

/** The send side: caption above, link below — the same shape the OS share
 *  sheet and the web app compose, so every consumer unfurls it the same way. */
export function shareMessageBody(url: string, caption?: string | null): string {
  const cap = String(caption || '').trim()
  return cap ? `${cap}\n${url}` : url
}

/** One-line summaries for inbox rows, reply strips and pin bars. */
export function shareSnippet(kind: ShareKind): string {
  return ({
    post: 'Shared a post',
    research: 'Shared a paper',
    question: 'Shared a question',
    live: 'Shared a live stream',
    channel: 'Shared a channel',
    invite: 'Shared an invitation',
    profile: 'Shared a profile',
    story: 'Shared a story',
  } as Record<ShareKind, string>)[kind]
}
