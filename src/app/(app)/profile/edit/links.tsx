/* =========================================================
   Links and contacts.

   Two sub-resources with the same shape and one important
   difference from the rest of the profile: `isPublic` decides
   whether an entry is serialized into public reads AT ALL, so
   a private row is not "hidden by the client" — the public
   endpoint never sends it. That is why this screen has to be
   read through `meProfile`, the only read that returns them,
   and re-read after every mutation.

   The eye toggle writes `{ isPublic }` alone, because these
   PATCHes are partial and sending the whole row back would
   overwrite a description edited on another device.
   ========================================================= */
import React from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import * as WebBrowser from 'expo-web-browser'
import { api, codeOf, errorText, fieldErrorMap, isNotFound } from '@/api'
import { useAsync } from '@/hooks/useAsync'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  ActionSheet, Button, Callout, ConfirmSheet, ErrorState, Field, GroupLabel,
  Header, Icon, ListRow, RowGroup, Screen, Sheet, Skeleton, Text, Touchable,
  fireHaptic, toast, useSheetState,
} from '@/ui'

const LINK_PLATFORMS = [
  'FACEBOOK', 'TWITTER', 'INSTAGRAM', 'LINKEDIN', 'YOUTUBE', 'GITHUB',
  'ORCID', 'RESEARCHGATE', 'GOOGLE_SCHOLAR', 'TELEGRAM', 'PERSONAL_WEBSITE', 'OTHER',
]
const CONTACT_PLATFORMS = ['TELEGRAM', 'WHATSAPP', 'EMAIL', 'PHONE', 'VIBER', 'SIGNAL', 'SKYPE', 'OTHER']

const label = (p: string) => p.toLowerCase().split('_').map(w => w[0].toUpperCase() + w.slice(1)).join(' ')

type LinkRow = { id: string; platform: string; url: string; label: string; order: number; isPublic?: boolean }
type ContactRow = { id: string; platform: string; value: string; label: string; order: number; isPublic?: boolean }

type Draft = {
  kind: 'link' | 'contact'
  id?: string
  platform: string
  description: string
  url: string
  value: string
  isPublic: boolean
}

export default function EditLinksScreen() {
  const t = useTheme()
  const me = useAsync<any>(() => api.users.meProfile(), {})

  const editor = useSheetState<Draft>()
  const rowMenu = useSheetState<{ kind: 'link' | 'contact'; row: any }>()
  const confirmDelete = useSheetState<{ kind: 'link' | 'contact'; row: any }>()
  const [busyId, setBusyId] = React.useState<string | null>(null)

  /* Read off `.raw`, not the mapped rows: the adapter drops `isPublic`
     (nothing else in the app needs it — the public read simply omits private
     entries), and this is the one screen where it is the whole point. */
  const rawProfile = me.data?.raw?.profile || {}

  const links: LinkRow[] = React.useMemo(() => (rawProfile.links || [])
    .map((l: any) => ({
      id: String(l.id),
      platform: l.platform || 'OTHER',
      url: l.url || '',
      label: l.description || label(l.platform || 'OTHER'),
      order: l.displayOrder ?? 0,
      isPublic: l.isPublic !== false,
    }))
    .sort((a: LinkRow, b: LinkRow) => a.order - b.order), [rawProfile.links])

  const contacts: ContactRow[] = React.useMemo(() => (rawProfile.contacts || [])
    .map((c: any) => ({
      id: String(c.id),
      platform: c.platform || 'OTHER',
      value: c.value || '',
      label: label(c.platform || 'OTHER'),
      order: c.displayOrder ?? 0,
      isPublic: c.isPublic !== false,
    }))
    .sort((a: ContactRow, b: ContactRow) => a.order - b.order), [rawProfile.contacts])

  const isPublicOf = (row: any) => row?.isPublic !== false

  const reload = React.useCallback(() => { void me.refresh() }, [me])

  /* Reordering, as two menu rows rather than a drag: this is a settings list
     whose rows already own a long-press (the menu itself), and DESIGN.md keeps
     glyph handles out of list rows. Only LINKS carry displayOrder — the
     contacts contract has no such field, so contacts stay in server order.

     Only the two rows that swap are PATCHed, and displayOrder alone is sent so
     a description edited on another device is not overwritten by this screen's
     stale copy. */
  const moveLink = async (row: LinkRow, delta: -1 | 1) => {
    const i = links.findIndex(l => l.id === row.id)
    const j = i + delta
    if (i < 0 || j < 0 || j >= links.length) return
    setBusyId(String(row.id))
    try {
      await api.users.editLink(links[i].id, { displayOrder: j })
      await api.users.editLink(links[j].id, { displayOrder: i })
      fireHaptic('select')
      reload()
    } catch (e: any) {
      if (isNotFound(e)) { reload(); return }
      toast.error(errorText(e))
    } finally {
      setBusyId(null)
    }
  }

  const togglePublic = async (kind: 'link' | 'contact', row: any) => {
    const next = !isPublicOf(row)
    setBusyId(String(row.id))
    try {
      if (kind === 'link') await api.users.editLink(row.id, { isPublic: next })
      else await api.users.editContact(row.id, { isPublic: next })
      fireHaptic('select')
      reload()
    } catch (e: any) {
      if (isNotFound(e)) { reload(); return }
      toast.error(errorText(e))
    } finally {
      setBusyId(null)
    }
  }

  const remove = async (kind: 'link' | 'contact', row: any) => {
    setBusyId(String(row.id))
    try {
      if (kind === 'link') await api.users.removeLink(row.id)
      else await api.users.removeContact(row.id)
      toast.ok('Removed')
      reload()
    } catch (e: any) {
      /* A 404 means the row was already gone — re-read rather than shout. */
      if (isNotFound(e)) { reload(); return }
      toast.error(errorText(e))
    } finally {
      setBusyId(null)
    }
  }

  if (me.loading && !me.data) {
    return (
      <Screen background="sunken">
        <Header back title="Links and contacts" />
        <View style={{ padding: t.layout.screenPadding, gap: space.md }}>
          <Skeleton height={180} radius={t.radius.md} />
          <Skeleton height={180} radius={t.radius.md} />
        </View>
      </Screen>
    )
  }

  if (me.error && !me.data) {
    return (
      <Screen background="sunken">
        <Header back title="Links and contacts" />
        <ErrorState error={me.error} onRetry={me.reload} />
      </Screen>
    )
  }

  return (
    <Screen background="sunken">
      <Header back title="Links and contacts" />

      <ScrollView contentContainerStyle={{ paddingBottom: 48 }} showsVerticalScrollIndicator={false}>
        <GroupLabel>Links</GroupLabel>
        {!links.length ? (
          <Text variant="footnote" tone="muted" align="ui" style={styles.hint}>
            Add your ORCID, personal site or GitHub.
          </Text>
        ) : null}
        <RowGroup inset={0}>
          {links.map(row => (
            <ListRow
              key={row.id}
              title={row.label || label(row.platform)}
              subtitle={middleTruncate(row.url)}
              icon="link"
              iconTone={isPublicOf(row) ? 'accent' : 'neutral'}
              style={{ opacity: isPublicOf(row) ? 1 : 0.6 }}
              onPress={() => { void WebBrowser.openBrowserAsync(row.url) }}
              onLongPress={() => rowMenu.open({ kind: 'link', row })}
              accessory={{
                kind: 'custom',
                node: (
                  <View style={styles.trailing}>
                    <Touchable
                      onPress={() => void togglePublic('link', row)}
                      disabled={busyId === String(row.id)}
                      feedback="dim"
                      accessibilityLabel={isPublicOf(row) ? 'Hide from profile' : 'Show on profile'}
                    >
                      <Icon
                        name={isPublicOf(row) ? 'eye' : 'eyeOff'}
                        size={18}
                        color={isPublicOf(row) ? t.colors.textSecondary : t.colors.textFaint}
                      />
                    </Touchable>
                    <Touchable onPress={() => rowMenu.open({ kind: 'link', row })} feedback="dim" accessibilityLabel="More">
                      <Icon name="more" size={18} color={t.colors.textMuted} />
                    </Touchable>
                  </View>
                ),
              }}
            />
          ))}
          <ListRow
            title="Add link"
            icon="add"
            iconTone="accent"
            onPress={() => editor.open({
              kind: 'link', platform: 'PERSONAL_WEBSITE', description: '', url: '', value: '', isPublic: true,
            })}
          />
        </RowGroup>

        <GroupLabel>Contacts</GroupLabel>
        {!contacts.length ? (
          <Text variant="footnote" tone="muted" align="ui" style={styles.hint}>
            Add a Telegram handle or a phone number people can reach you on.
          </Text>
        ) : null}
        <RowGroup inset={0}>
          {contacts.map(row => (
            <ListRow
              key={row.id}
              title={label(row.platform)}
              subtitle={row.value}
              icon="contacts"
              iconTone={isPublicOf(row) ? 'accent' : 'neutral'}
              style={{ opacity: isPublicOf(row) ? 1 : 0.6 }}
              onPress={async () => { await Clipboard.setStringAsync(row.value); toast.ok('Copied') }}
              onLongPress={() => rowMenu.open({ kind: 'contact', row })}
              accessory={{
                kind: 'custom',
                node: (
                  <View style={styles.trailing}>
                    <Touchable
                      onPress={() => void togglePublic('contact', row)}
                      disabled={busyId === String(row.id)}
                      feedback="dim"
                      accessibilityLabel={isPublicOf(row) ? 'Hide from profile' : 'Show on profile'}
                    >
                      <Icon
                        name={isPublicOf(row) ? 'eye' : 'eyeOff'}
                        size={18}
                        color={isPublicOf(row) ? t.colors.textSecondary : t.colors.textFaint}
                      />
                    </Touchable>
                    <Touchable onPress={() => rowMenu.open({ kind: 'contact', row })} feedback="dim" accessibilityLabel="More">
                      <Icon name="more" size={18} color={t.colors.textMuted} />
                    </Touchable>
                  </View>
                ),
              }}
            />
          ))}
          <ListRow
            title="Add contact"
            icon="add"
            iconTone="accent"
            onPress={() => editor.open({
              kind: 'contact', platform: 'TELEGRAM', description: '', url: '', value: '', isPublic: false,
            })}
          />
        </RowGroup>

        <View style={{ paddingHorizontal: t.layout.screenPadding, paddingTop: space.md2 }}>
          <Callout tone="neutral" icon="eye">
            Anything you mark public is visible to everyone, including people who do not follow you.
            Private entries are never sent to anyone else's copy of your profile.
          </Callout>
        </View>
      </ScrollView>

      <EntrySheet
        visible={editor.visible}
        onClose={editor.close}
        draft={editor.payload}
        nextLinkOrder={links.length}
        onSaved={() => { editor.close(); reload() }}
      />

      <ActionSheet
        visible={rowMenu.visible}
        onClose={rowMenu.close}
        title={rowMenu.payload?.kind === 'link' ? 'Link' : 'Contact'}
        actions={[
          {
            label: 'Edit',
            icon: 'edit',
            onPress: () => {
              const p = rowMenu.payload
              if (!p) return
              editor.open(p.kind === 'link'
                ? { kind: 'link', id: p.row.id, platform: p.row.platform, description: p.row.label || '', url: p.row.url || '', value: '', isPublic: p.row.isPublic !== false }
                : { kind: 'contact', id: p.row.id, platform: p.row.platform, description: '', url: '', value: p.row.value || '', isPublic: p.row.isPublic !== false })
            },
          },
          {
            label: 'Move up',
            icon: 'up',
            /* Hidden, not disabled, at the ends and on contacts — an action
               the server has no way to perform should not be on screen. */
            hidden: rowMenu.payload?.kind !== 'link'
              || links.findIndex(l => l.id === rowMenu.payload?.row?.id) <= 0,
            onPress: () => { const p = rowMenu.payload; if (p) void moveLink(p.row, -1) },
          },
          {
            label: 'Move down',
            icon: 'down',
            hidden: rowMenu.payload?.kind !== 'link'
              || links.findIndex(l => l.id === rowMenu.payload?.row?.id) >= links.length - 1,
            onPress: () => { const p = rowMenu.payload; if (p) void moveLink(p.row, 1) },
          },
          {
            label: 'Copy',
            icon: 'copy',
            onPress: async () => {
              const p = rowMenu.payload
              if (!p) return
              await Clipboard.setStringAsync(p.kind === 'link' ? p.row.url : p.row.value)
              toast.ok('Copied')
            },
          },
          {
            label: 'Delete',
            icon: 'trash',
            destructive: true,
            onPress: () => {
              const p = rowMenu.payload
              if (!p) return
              /* Only a PUBLIC entry needs the confirm: a private one is not
                 visible to anyone, so an undo toast is enough friction. */
              if (p.row.isPublic !== false) confirmDelete.open(p)
              else {
                void remove(p.kind, p.row)
              }
            },
          },
        ]}
      />

      <ConfirmSheet
        visible={confirmDelete.visible}
        onClose={confirmDelete.close}
        title="Delete this entry?"
        message="It disappears from your profile straight away."
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          const p = confirmDelete.payload
          confirmDelete.close()
          if (p) void remove(p.kind, p.row)
        }}
      />
    </Screen>
  )
}

/* ---------------------------------------------------------
   The add/edit form. One sheet for both resources — they
   differ in one field and one platform list.
   --------------------------------------------------------- */

function EntrySheet({
  visible, onClose, draft, nextLinkOrder, onSaved,
}: {
  visible: boolean
  onClose: () => void
  draft: Draft | null
  /** Where a NEW link lands: the end of the list. Omitting displayOrder makes
   *  every link share a 0 and the profile's order becomes whatever the server
   *  happens to return. */
  nextLinkOrder: number
  onSaved: () => void
}) {
  const t = useTheme()
  const [form, setForm] = React.useState<Draft | null>(draft)
  const [busy, setBusy] = React.useState(false)
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [formError, setFormError] = React.useState<any>(null)

  React.useEffect(() => {
    if (!visible) return
    setForm(draft)
    setErrors({})
    setFormError(null)
    setBusy(false)
  }, [visible, draft])

  if (!form) return null
  const isLink = form.kind === 'link'
  const platforms = isLink ? LINK_PLATFORMS : CONTACT_PLATFORMS

  const set = (patch: Partial<Draft>) => setForm(f => (f ? { ...f, ...patch } : f))

  const submit = async () => {
    if (busy || !form) return
    const next: Record<string, string> = {}
    if (isLink) {
      if (!form.description.trim()) next.description = 'Description is required'
      if (!form.url.trim()) next.url = 'URL is required'
    } else if (!form.value.trim()) {
      next.value = 'Value is required'
    }
    setErrors(next)
    if (Object.keys(next).length) return

    setBusy(true)
    setFormError(null)
    try {
      if (isLink) {
        const body = { platform: form.platform, description: form.description.trim(), url: form.url.trim(), isPublic: form.isPublic }
        /* An edit sends no displayOrder at all: PATCH treats omitted as "no
           change", so the row keeps the position the user gave it. */
        if (form.id) await api.users.editLink(form.id, body)
        else await api.users.addLink({ ...body, displayOrder: nextLinkOrder })
      } else {
        const body = { platform: form.platform, value: form.value.trim(), isPublic: form.isPublic }
        if (form.id) await api.users.editContact(form.id, body)
        else await api.users.addContact(body)
      }
      fireHaptic('success')
      onSaved()
    } catch (e: any) {
      setBusy(false)
      const code = codeOf(e)
      if (code === 'LINK_DUPLICATE') { setErrors({ url: errorText(e) }); return }
      if (code === 'CONTACT_DUPLICATE') { setErrors({ value: errorText(e) }); return }
      if (code === 'VALIDATION_FAILED') { setErrors(fieldErrorMap(e) as Record<string, string>); return }
      setFormError(e)
    }
  }

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={`${form.id ? 'Edit' : 'Add'} ${isLink ? 'link' : 'contact'}`}
      maxHeightRatio={0.92}
      footer={
        <Button
          label={busy ? 'Saving…' : form.id ? 'Save' : 'Add'}
          onPress={submit}
          variant="primary"
          size="lg"
          block
          loading={busy}
        />
      }
    >
      <View style={{ padding: t.layout.screenPadding, gap: space.md2 }}>
        <View>
          <Text variant="subhead" tone="secondary" align="ui" style={{ marginBottom: space.sm }}>Platform</Text>
          <View style={styles.grid}>
            {platforms.map(p => {
              const selected = form.platform === p
              return (
                <Touchable
                  key={p}
                  onPress={() => set({ platform: p })}
                  feedback="scale"
                  haptic="select"
                  noAutoHitSlop
                  accessibilityState={{ selected }}
                  style={[
                    styles.platform,
                    {
                      borderRadius: t.radius.sm,
                      borderWidth: selected ? 1.5 : StyleSheet.hairlineWidth,
                      borderColor: selected ? t.colors.accent : t.colors.border,
                      backgroundColor: selected ? t.colors.accentSofter : 'transparent',
                    },
                  ]}
                >
                  <Text variant="footnote" tone={selected ? 'accent' : 'secondary'} numberOfLines={1} align="ui">
                    {label(p)}
                  </Text>
                </Touchable>
              )
            })}
          </View>
        </View>

        {isLink ? (
          <>
            <Field
              label="Description"
              value={form.description}
              onChangeText={v => { set({ description: v }); setErrors(e => ({ ...e, description: '' })) }}
              error={errors.description || null}
              placeholder="My ORCID record"
              maxLength={200}
              editable={!busy}
            />
            <Field
              label="URL"
              value={form.url}
              onChangeText={v => { set({ url: v }); setErrors(e => ({ ...e, url: '' })) }}
              error={errors.url || null}
              placeholder="https://orcid.org/0000-0002-…"
              keyboardType="url"
              autoCapitalize="none"
              autoCorrect={false}
              editable={!busy}
            />
          </>
        ) : (
          <Field
            label="Value"
            value={form.value}
            onChangeText={v => { set({ value: v }); setErrors(e => ({ ...e, value: '' })) }}
            error={errors.value || null}
            placeholder="@ahmad or +9647701565811"
            maxLength={200}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!busy}
          />
        )}

        <ListRow
          title="Show on my profile"
          flush
          accessory={{ kind: 'switch', value: form.isPublic, onValueChange: v => set({ isPublic: v }), disabled: busy }}
        />
        {!isLink ? (
          <Text variant="footnote" tone="warning" align="ui" style={{ marginTop: -space.sm }}>
            Anything you mark public is visible to everyone, including people who do not follow you.
          </Text>
        ) : null}

        {formError ? <Callout tone="danger">{errorText(formError)}</Callout> : null}
      </View>
    </Sheet>
  )
}

/** Middle truncation: the tail of a URL is the part that identifies it. */
function middleTruncate(url: string, max = 46) {
  const s = String(url || '').replace(/^https?:\/\//i, '')
  if (s.length <= max) return s
  const head = Math.ceil((max - 1) / 2)
  return `${s.slice(0, head)}…${s.slice(-(max - head - 1))}`
}

const styles = StyleSheet.create({
  hint: { paddingHorizontal: space.lg, paddingBottom: space.sm, marginTop: -space.xs },
  trailing: { flexDirection: 'row', alignItems: 'center', gap: space.md2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  platform: { paddingHorizontal: space.md, paddingVertical: space.sm2, minWidth: '30%', alignItems: 'center' },
})
