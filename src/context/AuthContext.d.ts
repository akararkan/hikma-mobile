/* =========================================================
   Types for AuthContext.jsx.

   The provider is ported JS and stays that way — it is the one
   file where the web app's state machine, the proactive-refresh
   timer and the role helpers must remain diffable against the
   original. Its context is created as `createContext(null)`, so
   inference gives every consumer `null`; this declaration is
   what makes `useAuth()` usable from TypeScript without
   touching the runtime file.

   Keep it in step with the .jsx by hand: nothing checks that
   these agree.
   ========================================================= */
import type * as React from 'react'

/** The view-shaped user from `adapters.meFrom`. Loose on purpose — the
 *  adapter is JS and its shape is documented there, not here. */
export interface AuthUser {
  id: string
  username?: string
  handle?: string
  displayName?: string
  fname?: string
  lname?: string
  email?: string
  avatarUrl?: string | null
  coverUrl?: string | null
  bio?: string | null
  role?: string | null
  verified?: boolean
  emailVerified?: boolean
  phoneVerified?: boolean
  twoFactorEnabled?: boolean
  createdAt?: string | null
  [k: string]: any
}

export interface LoginFields {
  identifier?: string
  username?: string
  email?: string
  password: string
}

export interface LoginResult {
  /** Present (and true) only when the account owes a second factor. */
  mfaRequired?: boolean
  mfaToken?: string
  expiresIn?: number | null
  token?: string
  user?: AuthUser | null
}

export interface RegisterFields {
  fname?: string
  lname?: string
  full?: string
  handle?: string
  username?: string
  email: string
  password: string
}

export interface AuthValue {
  user: AuthUser | null
  /** False until the boot /users/me settles. Routing before this flashes. */
  ready: boolean
  signedIn: boolean
  signedOutReason: string | null
  /** Read-and-clear, so the line does not survive into the next attempt. */
  consumeSignedOutReason: () => string | null
  login: (fields: LoginFields) => Promise<LoginResult>
  completeTwoFactor: (args: { mfaToken: string; code: string }) => Promise<void>
  register: (fields: RegisterFields) => Promise<void>
  logout: () => Promise<void>
  logoutEverywhere: () => Promise<void>
  refreshUser: () => Promise<void>
  setUser: React.Dispatch<React.SetStateAction<AuthUser | null>>
}

export type Gate = 'loading' | 'allow' | 'deny'

export declare function AuthProvider(props: { children: React.ReactNode }): React.JSX.Element
export declare function useAuth(): AuthValue
/** 'deny' means "sign in first". */
export declare function useAuthGate(): Gate
/** 'deny' here is FINAL — a rights refusal is not a wrong address. */
export declare function useRoleGate(roles: string | string[]): Gate

export declare const PLATFORM_ADMIN_ROLES: string[]
export declare function hasRole(user: AuthUser | null, ...roles: (string | string[])[]): boolean
export declare function isPlatformAdmin(user: AuthUser | null): boolean
