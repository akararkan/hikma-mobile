/* =========================================================
   The settings search index — STATIC, and honestly so.

   It lives in lib rather than beside the screens it indexes
   because EVERY file under src/app is a route: expo-router
   walked this one, found no default export and said so on
   every boot ("Route ./(app)/settings/searchIndex.ts is
   missing the required default export"). A table is not a
   screen, so it belongs outside the route tree.

   There is no server settings-search endpoint (settings/
   api-reference.md) and none is needed: forty-odd screens is a
   list a phone can filter per keystroke. The cost of a static
   index is that it must be tended by hand — when a settings
   screen is added or renamed, add or rename its row here. The
   route strings are literals on purpose: scripts/check-routes
   then proves every one of them still resolves.

   Keywords carry the words people actually type, including the
   synonyms the titles avoid ("2FA", "dark mode", "block").
   ========================================================= */

export interface SettingsEntry {
  title: string
  subtitle: string
  section: string
  route: string
  keywords: string[]
}

export const SETTINGS_INDEX: SettingsEntry[] = [
  { title: 'Account', subtitle: 'Email, phone, password, deletion', section: 'Account', route: '/settings/account', keywords: ['email', 'phone', 'password', 'delete'] },
  { title: 'Change password', subtitle: 'Set a new password', section: 'Account', route: '/settings/account/change-password', keywords: ['password', 'credentials'] },
  { title: 'Delete account', subtitle: 'Permanently remove your account', section: 'Account', route: '/settings/account/delete', keywords: ['delete', 'remove', 'close', 'deactivate'] },
  { title: 'Security', subtitle: 'Sessions, sign-ins, two-factor', section: 'Account', route: '/settings/security', keywords: ['2fa', 'sessions', 'sign in'] },
  { title: 'Two-factor authentication', subtitle: 'Authenticator app codes', section: 'Security', route: '/settings/security/two-factor', keywords: ['2fa', 'totp', 'authenticator', 'otp'] },
  { title: 'Recovery codes', subtitle: 'One-time backup codes', section: 'Security', route: '/settings/security/recovery-codes', keywords: ['backup codes', '2fa'] },
  { title: 'Active sessions', subtitle: 'Devices signed into your account', section: 'Security', route: '/settings/security/sessions', keywords: ['devices', 'sign out everywhere'] },
  { title: 'Login history', subtitle: 'Recent sign-ins', section: 'Security', route: '/settings/security/login-history', keywords: ['sign in', 'activity'] },
  { title: 'Phone number', subtitle: 'Add or change your phone', section: 'Security', route: '/settings/security/phone', keywords: ['phone', 'sms', 'number'] },
  { title: 'Verify email', subtitle: 'Confirm your address', section: 'Security', route: '/settings/security/verify-email', keywords: ['email', 'verification'] },
  { title: 'Privacy', subtitle: 'Who can see and reach you', section: 'Account', route: '/settings/privacy', keywords: ['visibility', 'private'] },
  { title: 'Blocked accounts', subtitle: 'People you have blocked', section: 'Privacy', route: '/settings/privacy/blocked', keywords: ['block', 'unblock'] },
  { title: 'Muted accounts', subtitle: 'People you have muted', section: 'Privacy', route: '/settings/privacy/muted', keywords: ['mute', 'unmute', 'silence'] },
  { title: 'Restricted accounts', subtitle: 'Limited interactions', section: 'Privacy', route: '/settings/privacy/restricted', keywords: ['restrict'] },
  { title: 'Muted keywords', subtitle: 'Hide posts containing words', section: 'Privacy', route: '/settings/privacy/keywords', keywords: ['filter', 'words', 'hide'] },
  { title: 'Close-friend lists', subtitle: 'Audience lists', section: 'Privacy', route: '/settings/privacy/lists', keywords: ['lists', 'close friends', 'audience'] },
  { title: 'Presence', subtitle: 'Online status and last seen', section: 'Account', route: '/settings/presence', keywords: ['online', 'last seen', 'activity status'] },
  { title: 'Notifications', subtitle: 'What reaches this phone', section: 'Notifications', route: '/settings/notifications', keywords: ['push', 'alerts'] },
  { title: 'Notification devices', subtitle: 'Phones registered for push', section: 'Notifications', route: '/settings/notifications/devices', keywords: ['push', 'devices', 'tokens'] },
  { title: 'Do not disturb', subtitle: 'Quiet hours', section: 'Notifications', route: '/settings/notifications/dnd', keywords: ['dnd', 'quiet', 'silence', 'mute'] },
  { title: 'Email notifications', subtitle: 'What arrives by email', section: 'Notifications', route: '/settings/notifications/email', keywords: ['email', 'digest'] },
  { title: 'Messaging', subtitle: 'Receipts, typing, requests', section: 'Notifications', route: '/settings/messaging', keywords: ['read receipts', 'typing', 'dm', 'chat'] },
  { title: 'Discovery', subtitle: 'How people find you', section: 'Discovery', route: '/settings/discovery', keywords: ['contacts', 'suggestions', 'find'] },
  { title: 'Communities', subtitle: 'Group and channel defaults', section: 'Discovery', route: '/settings/communities', keywords: ['groups', 'channels'] },
  { title: 'Appearance', subtitle: 'Theme, accent, density', section: 'Appearance', route: '/settings/appearance', keywords: ['dark mode', 'theme', 'light', 'accent', 'color'] },
  { title: 'Accessibility', subtitle: 'Motion, text size, captions', section: 'Appearance', route: '/settings/accessibility', keywords: ['reduce motion', 'font size', 'captions', 'haptics'] },
  { title: 'Language', subtitle: 'App language', section: 'Appearance', route: '/settings/language', keywords: ['english', 'arabic', 'kurdish', 'rtl'] },
  { title: 'Media', subtitle: 'Autoplay and upload quality', section: 'Appearance', route: '/settings/media', keywords: ['autoplay', 'data saver', 'quality', 'video'] },
  { title: 'Your data', subtitle: 'Download and manage your data', section: 'Your data', route: '/settings/data', keywords: ['export', 'download', 'gdpr'] },
  { title: 'Storage', subtitle: 'Cache and space on this phone', section: 'Your data', route: '/settings/storage', keywords: ['cache', 'clear', 'space'] },
  { title: 'Safety', subtitle: 'Reports, strikes, moderation', section: 'Safety', route: '/settings/safety', keywords: ['report', 'abuse'] },
  { title: 'How moderation works', subtitle: 'Checks, review, appeals', section: 'Safety', route: '/settings/safety/moderation', keywords: ['moderation', 'appeal', 'removed', 'held'] },
  { title: 'Your reports', subtitle: 'Reports you have filed', section: 'Safety', route: '/settings/safety/reports', keywords: ['report', 'appeal'] },
  { title: 'Account strikes', subtitle: 'Actions on your account', section: 'Safety', route: '/settings/safety/strikes', keywords: ['strike', 'warning', 'ban'] },
  { title: 'Your QR code', subtitle: 'Let people scan to follow you', section: 'About', route: '/settings/qr', keywords: ['qr', 'code', 'share profile'] },
  { title: 'Scan a code', subtitle: 'Open a profile or invite', section: 'About', route: '/settings/scan', keywords: ['qr', 'scan', 'camera'] },
  { title: 'Permissions', subtitle: 'What this app can access', section: 'About', route: '/settings/permissions', keywords: ['camera', 'microphone', 'contacts', 'photos', 'location'] },
  { title: 'Policies', subtitle: 'Terms, privacy policy, guidelines', section: 'About', route: '/settings/policies', keywords: ['terms', 'legal', 'guidelines'] },
  { title: 'About', subtitle: 'Version and licences', section: 'About', route: '/settings/about', keywords: ['version', 'licenses'] },
]

/** Case-insensitive substring across title, subtitle, section and keywords. */
export function filterSettings(q: string): SettingsEntry[] {
  const needle = q.trim().toLowerCase()
  if (!needle) return []
  return SETTINGS_INDEX.filter(e =>
    e.title.toLowerCase().includes(needle)
    || e.subtitle.toLowerCase().includes(needle)
    || e.section.toLowerCase().includes(needle)
    || e.keywords.some(k => k.includes(needle)),
  )
}
