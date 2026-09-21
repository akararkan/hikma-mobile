/* =========================================================
   Route linter.

   expo-router's `typedRoutes` would do this at compile time,
   but its generated `.expo/types/router.d.ts` only refreshes
   when the dev server runs — which makes it useless during a
   build where routes are appearing faster than the file
   regenerates, and actively misleading when it is stale.

   So the check moves here: walk src/app for the real route
   table, walk the source for every navigation target, and
   report the ones that do not resolve.

   Run:  node scripts/check-routes.mjs
   Exits non-zero when something is wrong, so it can gate CI.
   ========================================================= */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const APP = join(ROOT, 'src/app')
const SRC = join(ROOT, 'src')

/* ---------- 1. the route table ---------- */

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

/** A file path under src/app → its URL pattern, or null when it is not a route. */
function routeOf(file) {
  const rel = relative(APP, file).split(sep).join('/')
  if (!/\.(tsx|jsx|ts|js)$/.test(rel)) return null
  if (rel.includes('/_') || rel.startsWith('_')) return null          // layouts, private dirs
  if (rel.startsWith('+')) return null                                 // +not-found, +html

  let path = rel.replace(/\.(tsx|jsx|ts|js)$/, '')
  path = path.replace(/\/index$/, '').replace(/^index$/, '')
  /* Route groups are invisible in the URL. */
  path = path.split('/').filter(seg => !/^\(.*\)$/.test(seg)).join('/')
  return '/' + path
}

const routeFiles = walk(APP)
const routes = routeFiles.map(routeOf).filter(r => r !== null)

/** Turn `/post/[id]/edit` into a matcher, and `[...rest]` into a greedy one. */
function toMatcher(route) {
  const source = '^' + route
    .split('/')
    .map(seg => {
      if (/^\[\.\.\..+\]$/.test(seg)) return '(?:/.*)?'
      if (/^\[.+\]$/.test(seg)) return '/[^/]+'
      return seg ? '/' + seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : ''
    })
    .join('')
    .replace(/^\^\//, '^/') + '$'
  return new RegExp(source)
}

/* Static beats dynamic, exactly as the router resolves it: `/qna/[id]` matches
   the string "/qna/ask", so without this ordering a real static route looks
   unreferenced because its dynamic sibling absorbed every link to it. */
const specificity = route => route.split('/').reduce((n, seg) => (
  n + (/^\[\.\.\..+\]$/.test(seg) ? 0 : /^\[.+\]$/.test(seg) ? 1 : 2)
), 0)

const ordered = routes
  .map(route => ({ route, matcher: toMatcher(route), rank: specificity(route) }))
  .sort((a, b) => b.rank - a.rank || b.route.length - a.route.length)

const matches = href => (href === '/' ? routes.includes('/') : ordered.some(o => o.matcher.test(href)))
/** The route the router would actually pick for this href. */
const resolve = href => ordered.find(o => o.matcher.test(href))?.route ?? null

/* ---------- 2. every navigation target in the source ---------- */

/* Route groups are legal inside an href — `/(auth)/sign-in` addresses the same
   screen as `/sign-in` — so parentheses have to survive the character class.
   Everything else that ends a path literal still terminates it. */
/* Only the quote characters and whitespace terminate a path: a template hole
   (`/chat/forward?messageId=${id}`) contains braces, and excluding them cut
   every interpolated href short and made it look unreferenced. The
   backreference to the opening quote is what actually bounds the match. */
const PATH = String.raw`\/[^'"\`\s]*`

/* router.push('/x') · <Redirect href="/x"> · <Link href="/x"> ·
   { pathname: '/x' } · href: '/x' · and the `href('/x')` helper the search
   surface wraps its targets in. */
const PATTERNS = [
  new RegExp(String.raw`router\.(?:push|replace|navigate|prefetch)\(\s*(['"\`])(${PATH})\1`, 'g'),
  new RegExp(String.raw`\bhref\s*=\s*\{?\s*(['"\`])(${PATH})\1`, 'g'),
  new RegExp(String.raw`\bhref:\s*(['"\`])(${PATH})\1`, 'g'),
  new RegExp(String.raw`\bpathname:\s*(['"\`])(${PATH})\1`, 'g'),
  /* A lone quoted path as a call's only argument — href('/tags'), go('/saved').
     String methods take path-shaped arguments too and are not navigation, so
     they are excluded by name rather than by shape. */
  new RegExp(
    String.raw`(?<!\.(?:endsWith|startsWith|includes|indexOf|lastIndexOf|split|replace|replaceAll|join|test|match|search|concat))`
    + String.raw`\(\s*(['"\`])(${PATH})\1\s*[,)]`,
    'g',
  ),
]

const found = new Map()   // href → Set<file:line>

for (const file of walk(SRC)) {
  if (!/\.(tsx|jsx|ts)$/.test(file)) continue
  if (file.endsWith('.d.ts')) continue
  /* Comments describe routes constantly ("`/qna/[id]` is the canonical
     target"), and counting those as navigation produces phantom findings. They
     are blanked rather than removed so every reported line number still points
     at the real line. */
  const text = readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p) => p + ' '.repeat(m.length - p.length))

  for (const re of PATTERNS) {
    re.lastIndex = 0
    let m
    while ((m = re.exec(text))) {
      let href = m[2]
      /* A `${…}` that does not directly follow a `/` is not a path segment —
         it is a suffix the caller appends (`/channels/${id}/compose${query}`).
         Truncate there: what follows is a query string, not a route. */
      href = href.replace(/([^/])\$\{[^}]*\}[\s\S]*$/, '$1')
      /* The remaining holes are whole segments: `/post/${id}` → `/post/X`. */
      href = href.replace(/\$\{[^}]*\}/g, 'X')
      /* Drop the query and hash — the route table has neither. */
      href = href.split('?')[0].split('#')[0]
      if (!href.startsWith('/')) continue
      if (href.startsWith('//')) continue                     // protocol-relative URL
      /* Backend paths are not routes. They share the shape and appear in the
         same call position (`http.get('/api/v1/…')`). */
      if (href.startsWith('/api/')) continue
      /* A caller may address a route with or without its groups —
         `/(app)/(tabs)` and `/` are the same destination — so groups come out
         of the href the same way they come out of the route table. */
      href = '/' + href.split('/').filter(seg => seg && !/^\(.*\)$/.test(seg)).join('/')
      if (href.length > 1 && href.endsWith('/')) href = href.slice(0, -1)

      const upto = text.slice(0, m.index)
      const line = upto.split('\n').length
      const where = `${relative(ROOT, file)}:${line}`
      if (!found.has(href)) found.set(href, new Set())
      found.get(href).add(where)
    }
  }
}

/* ---------- 3. report ---------- */

const broken = [...found.entries()]
  .filter(([href]) => !matches(href))
  .sort((a, b) => a[0].localeCompare(b[0]))

/* A LITERAL path — one with no interpolated segment — that lands on a dynamic
   route is almost always a typo the router will happily swallow:
   `/sounds/picker` matches `/sounds/[id]` and opens the detail screen for a
   sound called "picker". A templated href (`/post/X`) is the legitimate case
   and is excluded by the X marker the scanner substitutes. */
const suspicious = [...found.entries()]
  /* `{ pathname: '/user/[id]', params: { id } }` is expo-router's object form —
     the pathname IS the pattern and the params fill it, so a literal `[` means
     the caller is addressing the route deliberately. */
  .filter(([href]) => matches(href) && !href.split('/').includes('X') && !href.includes('['))
  .map(([href, where]) => [href, resolve(href), where])
  .filter(([, route]) => String(route).includes('['))
  .sort((a, b) => String(a[0]).localeCompare(String(b[0])))

const usedRoutes = new Set()
for (const [href] of found) {
  const hit = resolve(href)
  if (hit) usedRoutes.add(hit)
}
/* Tab screens are reached by the tab bar, which navigates by route NAME rather
   than by href, so they never appear as a navigation target and are not
   orphans. */
const tabRoutes = new Set(
  routeFiles
    .filter(f => relative(APP, f).split(sep).some(seg => seg === '(tabs)'))
    .map(routeOf)
    .filter(Boolean),
)

const orphans = routes.filter(r => (
  !usedRoutes.has(r) && r !== '/' && !r.includes('[') && !tabRoutes.has(r)
))

/* ---------- 3b. <Stack.Screen name> ----------
   A name that matches no sibling route is not an error at runtime — the
   navigator ignores it — so a `presentation: 'fullScreenModal'` on a
   mistyped name silently degrades to an ordinary push and nothing says so.
   The classic mistake is `name="live/[id]"` for a directory whose route is
   really `live/[id]/index`, because only a directory with its own `_layout`
   collapses to the bare name. */
const screenNameProblems = []
for (const layout of routeFiles.filter(f => f.endsWith(`${sep}_layout.tsx`))) {
  const dir = join(layout, '..')
  const src = readFileSync(layout, 'utf8')
  for (const m of src.matchAll(/<Stack\.Screen\s+[^>]*name=(['"`])([^'"`]+)\1/g)) {
    const name = m[2]
    const base = join(dir, name)
    const resolves = ['.tsx', '.ts', '.jsx', '.js'].some(ext => fileExists(base + ext))
      || fileExists(join(base, '_layout.tsx'))
    if (!resolves) screenNameProblems.push([relative(ROOT, layout), name])
  }
}

function fileExists(p) {
  try { return statSync(p).isFile() } catch { return false }
}

console.log(`routes defined:      ${routes.length}`)
console.log(`navigation targets:  ${found.size}`)

if (orphans.length) {
  console.log(`\nunreferenced routes (${orphans.length}) — reachable only by deep link:`)
  for (const r of orphans) console.log(`  ${r}`)
}

if (suspicious.length) {
  /* Advisory, not a failure: a literal segment that lands on a dynamic route
     is usually a typo (`/sounds/picker` opening the detail screen for a sound
     called "picker"), but it is also how a deliberate sentinel works —
     `/call/new` is read by the call screen as "start one". */
  console.log(`\nCaught by a dynamic route (${suspicious.length}) — typo, or a deliberate sentinel:`)
  for (const [href, route, where] of suspicious) {
    console.log(`  ${href}  →  ${route}`)
    for (const w of [...where].slice(0, 3)) console.log(`      ${w}`)
  }
}

if (screenNameProblems.length) {
  console.log(`\nUNMATCHED <Stack.Screen name> (${screenNameProblems.length}) — its options are inert:`)
  for (const [file, name] of screenNameProblems) console.log(`  ${name}\n      ${file}`)
}

if (broken.length) {
  console.log(`\nBROKEN navigation targets (${broken.length}):`)
  for (const [href, where] of broken) {
    console.log(`  ${href}`)
    for (const w of [...where].slice(0, 4)) console.log(`      ${w}`)
    if (where.size > 4) console.log(`      …and ${where.size - 4} more`)
  }
}

if (broken.length || screenNameProblems.length) process.exit(1)

console.log('\nEvery navigation target resolves to a route.')
