/* =========================================================
   Auth context — current user, sign in/up/out, route guard.
   The current user comes from the login response and /users/me.
   ---------------------------------------------------------
   RN PORT. The state machine, the proactive-refresh timer, and
   hasRole/isPlatformAdmin are unchanged. Two things had to move:

     1. `window.addEventListener('ika:auth-expired')` →
        `on(AUTH_EXPIRED)` from ../platform/appEvents.js. This is
        load-bearing: it is how a dead session at the HTTP layer
        reaches the navigator without api/ importing UI.

     2. `RequireAuth` / `RequireRole` were react-router components
        that rendered a <Navigate>. There is no react-router here.
        They are replaced by HOOKS — `useAuthGate()` and
        `useRoleGate(roles)` — which return a verdict
        ('loading' | 'allow' | 'deny') and leave the redirect and
        the refusal copy to the screen. That is the right split on
        native anyway: expo-router redirects with <Redirect> or
        router.replace() from inside a screen, and the refusal
        surface is a real screen, not a <div>.
   ========================================================= */
import React from 'react'
import { api, session, adapters } from '../api/index.js'
import { on, emit, AUTH_EXPIRED, SIGNED_OUT } from '../platform/appEvents.js'
import { takeSignedOutReason } from '../api/http.js'
import { disablePush, invalidatePushRegistration } from '../lib/pushNotify'
import { clearBrandMoment, queueBrandMoment } from '../lib/brandMoment'
import { resetBootBrand } from '../lib/bootBrand'

const AuthCtx = React.createContext(null)
export const useAuth = () => React.useContext(AuthCtx)

export function AuthProvider({ children }) {
  const [user, setUser] = React.useState(() => adapters.meFrom(session.getUser()))
  const [ready, setReady] = React.useState(!session.isAuthed())   // ready once we know auth state
  /* Mirrors `session.isAuthed()` into React state. On web this was read
     straight off localStorage during render, which happened to work because
     every sign-out also triggered a navigation. Here the value has to be
     STATE or the tree never re-renders when endSession() clears the token
     from outside React, and a signed-out user keeps seeing the app. */
  const [signedIn, setSignedIn] = React.useState(() => session.isAuthed())
  /* Why the user landed on the auth screen ('your session expired', or the
     stronger copy after a detected token reuse). http.js parks it; the auth
     screen reads it once on mount. */
  const [signedOutReason, setSignedOutReason] = React.useState(null)
  const refreshTimer = React.useRef(null)

  // Proactive refresh: rotate the token ~60s before it expires so it never
  // lapses mid-request, rescheduling from each refresh's own expiresIn.
  // (The reactive 401 interceptor in http.js is the safety net if this misses.)
  const scheduleRefresh = React.useCallback(function schedule(expiresIn) {
    clearTimeout(refreshTimer.current)
    const secs = Math.max(30, (Number(expiresIn) || 3600) - 60)
    refreshTimer.current = setTimeout(() => {
      api.auth.refresh()
        .then(res => schedule(res?.expiresIn))            // chain the next one (self-ref, stays stable)
        .catch(() => { /* dead session → reactive path / endSession handles it */ })
    }, secs * 1000)
  }, [])

  // On boot, if a token exists, refresh the current user + arm the refresh timer.
  // A returning user's gate answer is knowable SYNCHRONOUSLY — token and cached
  // user are both on disk — so `ready` must not wait on the /users/me round
  // trip: that held the first frame for a network RTT on every warm start, and
  // on a dead network for the OS socket timeout. /me still runs as a background
  // refresh; a revoked session still bounces via AUTH_EXPIRED. Only the
  // authed-with-NO-cached-user boot (a wiped cache) waits, raced with a short
  // deadline so a dead network cannot pin the splash past BootGate's hatch.
  React.useEffect(() => {
    if (!session.isAuthed()) { setReady(true); return }
    let alive = true
    let deadline = null
    if (session.getUser()) setReady(true)
    else deadline = setTimeout(() => { if (alive) setReady(true) }, 3000)
    api.auth.me()
      .then(u => { if (alive && u) setUser(u) })
      .catch(() => { /* keep cached user if /me unavailable */ })
      .finally(() => { if (alive) setReady(true) })
    scheduleRefresh()
    return () => { alive = false; clearTimeout(deadline) }
  }, [scheduleRefresh])

  // The HTTP layer fires this when a refresh fails / the token is revoked:
  // drop the user so the gate bounces to the auth screen.
  React.useEffect(() => {
    const off = on(AUTH_EXPIRED, () => {
      clearTimeout(refreshTimer.current)
      setUser(null)
      setSignedIn(false)
      setSignedOutReason(takeSignedOutReason())
      /* A session that died on its own gets the reason copy on the sign-in
         screen, never a farewell curtain — the app did not say goodbye, it
         was shown the door. */
      clearBrandMoment()
      /* A session that dies on its own hands the boot splash back — the
         NEXT cold start re-plays the full reveal instead of skipping it. */
      resetBootBrand()
      /* No session left to hand the push token back with — poison the local
         cache so the NEXT sign-in re-registers instead of short-circuiting
         on a token the backend no longer has a live row for. */
      invalidatePushRegistration()
    })
    return () => { off(); clearTimeout(refreshTimer.current) }
  }, [])

  /* Every mutator below is identity-stable (they touch only refs, setters and
     each other), so an effect that lists e.g. refreshUser in its deps re-runs
     when the session changes, not on every provider render. */
  const adopt = React.useCallback((u, expiresIn) => {
    setUser(u || adapters.meFrom(session.getUser()))
    setSignedIn(session.isAuthed())
    setSignedOutReason(null)
    scheduleRefresh(expiresIn)
  }, [scheduleRefresh])

  /* Returns the MFA challenge instead of a session when the account has 2FA on
     (the response carries mfaRequired + a short-lived mfaToken and no tokens at
     all). The caller shows a code screen and finishes with completeTwoFactor —
     signedIn stays false in between, which is the honest state. */
  const login = React.useCallback(async (fields) => {
    const res = await api.auth.login(fields)
    if (res?.mfaRequired) return res
    adopt(res.user, res.expiresIn)
    /* The curtain is queued HERE, by the thing that caused it. It used to be
       inferred from a gate transition inside (app)/_layout, which never
       happened — see lib/brandMoment.js for the whole story. */
    queueBrandMoment('welcome')
    return res
  }, [adopt])
  /** Redeem the challenge with a TOTP or recovery code → real session. */
  const completeTwoFactor = React.useCallback(async ({ mfaToken, code }) => {
    const { user: u, expiresIn } = await api.auth.loginTwoFactor({ mfaToken, code })
    adopt(u, expiresIn)
    queueBrandMoment('welcome')
  }, [adopt])
  const register = React.useCallback(async (fields) => {
    const { user: u, expiresIn } = await api.auth.register(fields)
    adopt(u, expiresIn)
    /* Queued now, claimed much later: register() flips the session while the
       user is still in verify-email and onboarding, and the app shell they
       will finally land in does not exist yet. The slot waits for it. */
    queueBrandMoment('arrival')
  }, [adopt])
  const signOut = React.useCallback(() => {
    clearTimeout(refreshTimer.current); setUser(null); setSignedIn(false)
    /* Deliberate, so it earns the farewell. The involuntary path (AUTH_EXPIRED)
       clears the slot instead. */
    queueBrandMoment('farewell')
    /* Voluntary sign-out — per-account caches (social edges, mutes) listen for
       this. AUTH_EXPIRED only covers the involuntary path, and a second
       account must not inherit the first's cached relationships. */
    emit(SIGNED_OUT)
  }, [])
  /* Hand the push token back BEFORE the session goes away.
     A token left registered keeps this phone on the account's delivery list:
     the next person to sign in here receives the previous user's message and
     call notifications, on the lock screen, with their names in them. It has
     to run before the logout call, because deleting the row needs the session
     that owns it — and it must never be able to block the sign-out itself,
     hence the swallow. (The backend also purges by `sid` when a session is
     revoked; this is the client half of the same contract.) */
  const dropPushToken = React.useCallback(async () => {
    try { await disablePush() } catch { /* signing out matters more */ }
  }, [])
  const logout = React.useCallback(async () => {
    clearTimeout(refreshTimer.current); await dropPushToken(); await api.auth.logout(); signOut()
  }, [signOut, dropPushToken])
  const logoutEverywhere = React.useCallback(async () => {
    clearTimeout(refreshTimer.current); await dropPushToken(); await api.auth.logoutAll(); signOut()
  }, [signOut, dropPushToken])
  const refreshUser = React.useCallback(async () => {
    try { const u = await api.auth.me(); if (u) setUser(u) } catch { /* keep current */ }
  }, [])

  /** Read-and-clear — the auth screen calls this once so the "why am I here?"
   *  line does not persist into the next sign-in attempt. */
  const consumeSignedOutReason = React.useCallback(() => {
    const r = signedOutReason
    if (r) setSignedOutReason(null)
    return r
  }, [signedOutReason])

  /* The value's identity only moves when auth state actually moves — every
     useAuth() consumer (each tab item included) is downstream of it. */
  const value = React.useMemo(() => ({
    user, ready, signedIn, signedOutReason, consumeSignedOutReason,
    login, completeTwoFactor, register, logout, logoutEverywhere, refreshUser, setUser,
  }), [
    user, ready, signedIn, signedOutReason, consumeSignedOutReason,
    login, completeTwoFactor, register, logout, logoutEverywhere, refreshUser,
  ])
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>
}

/* -------------------------------------------------------------
   Gates.

   Hooks, not components: on native the redirect belongs to the
   screen (expo-router's <Redirect> or router.replace), and the
   refusal surface is a real screen rather than a div. Both return
   'loading' until the boot /users/me settles, because routing on
   an unknown auth state flashes the wrong screen.
   ------------------------------------------------------------- */

/** 'loading' | 'allow' | 'deny' — deny means "sign in first". */
export function useAuthGate() {
  const { signedIn, ready } = useAuth()
  if (!ready) return 'loading'
  return signedIn ? 'allow' : 'deny'
}

/** 'loading' | 'allow' | 'deny' — deny here is FINAL. A rights refusal is not
 *  a wrong address, so the screen should render the refusal in place and offer
 *  no retry, matching how every admin-only panel already answers a 403. */
export function useRoleGate(roles) {
  const { user, ready } = useAuth()
  if (!ready) return 'loading'
  return hasRole(user, roles) ? 'allow' : 'deny'
}

/* -------------------------------------------------------------
   PLATFORM roles. Not to be confused with a conversation role
   (OWNER/ADMIN/MEMBER inside one channel) — that one is per-room
   and lives on the conversation object.

   One helper, because the two hand-rolled gates in the app had
   already drifted apart: one of them omitted SUPER_ADMIN, so a
   super-admin lost an affordance a plain admin had. Compare
   case-insensitively — the role arrives from two places (the
   login response and /users/me) and only one of them is ours.
   ------------------------------------------------------------- */
export const PLATFORM_ADMIN_ROLES = ['ADMIN', 'SUPER_ADMIN']

export function hasRole(user, ...roles) {
  const mine = String(user?.role || '').toUpperCase()
  return roles.flat().some(r => String(r).toUpperCase() === mine)
}

export const isPlatformAdmin = (user) => hasRole(user, PLATFORM_ADMIN_ROLES)
