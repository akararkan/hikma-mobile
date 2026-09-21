/* =========================================================
   One admin's rights.

   Every switch is LOCAL until Save. A per-switch PUT would let a
   half-applied set persist if the network dropped between the
   third and fourth toggle, and the wire's null-means-true rule
   makes a partial body dangerous: `admins.set` runs `rightsTo`,
   which sends all nine flags explicitly, so what you see is what
   is stored.

   The owner is read-only — the server refuses to edit their
   rights, and the owner always has all of them anyway.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { RIGHT_KEYS, api, codeOf, errorText, isNotFound } from '@/api'
import { useAuth } from '@/context/AuthContext'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  Avatar, Callout, ConfirmSheet, ErrorState, Header, ListRow, RowGroup, Screen,
  Skeleton, Text, toast, useSheetState,
} from '@/ui'
import { RightsSwitchList } from '@/components/channels/RightsSwitchList'
import { GoneCard, RefusalCard } from '@/components/channels/states'
import { useChannelRights } from '@/components/channels/hooks'
import { chRoute } from '@/components/channels/routes'

export default function AdminRightsScreen() {
  const t = useTheme()
  const router = useRouter()
  const { user } = useAuth()
  const { id, userId } = useLocalSearchParams<{ id: string; userId: string }>()

  const rights = useChannelRights(id)
  const row = rights.admins.find((a: any) => a.userId === userId) ?? null

  const [flags, setFlags] = React.useState<Record<string, any> | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<any>(null)
  const confirmDemote = useSheetState()
  const confirmSelfLock = useSheetState()

  React.useEffect(() => {
    if (row && !flags) setFlags({ ...row.rights, customTitle: row.customTitle || '' })
  }, [row, flags])

  const readOnly = row?.role === 'OWNER'
  const dirty = !!row && !!flags && (
    (RIGHT_KEYS as string[]).some(k => (flags[k] !== false) !== (row.rights[k] !== false))
    || String(flags.customTitle || '') !== String(row.customTitle || '')
  )

  const save = async () => {
    if (!flags || !dirty) return
    setSaving(true)
    setError(null)
    try {
      await api.channels.admins.set(id, userId, flags)
      rights.reload()
      toast.ok('Rights updated')
      router.back()
    } catch (e: any) {
      setError(e)
      /* A NOT_OWNER refusal on save means the form was never applicable —
         revert rather than leave a screen that disagrees with the server. */
      if (codeOf(e) === 'NOT_OWNER' && row) setFlags({ ...row.rights, customTitle: row.customTitle || '' })
      toast.error(errorText(e))
    } finally {
      setSaving(false)
    }
  }

  const demote = async () => {
    try {
      await api.channels.admins.demote(id, userId)
      rights.reload()
      toast.ok('Demoted to subscriber')
      router.back()
    } catch (e: any) { toast.error(errorText(e)) }
  }

  const onChange = (next: Record<string, any>) => {
    /* Removing your own canAddAdmins locks you out of this very screen. */
    if (userId === user?.id && flags?.canAddAdmins !== false && next.canAddAdmins === false) {
      confirmSelfLock.open()
    }
    setFlags(next)
  }

  if (rights.error && isNotFound(rights.error)) {
    return (
      <Screen background="sunken">
        <Header back title="Admin rights" />
        <GoneCard onBrowse={() => router.replace(chRoute.index())} />
      </Screen>
    )
  }

  if (rights.loading && !rights.admins.length) {
    return (
      <Screen background="sunken">
        <Header back title="Admin rights" />
        <View style={{ alignItems: 'center', paddingVertical: space.xxl, gap: space.sm }}>
          <Skeleton circle width={64} height={64} />
          <Skeleton width={140} height={16} />
          <Skeleton width={90} height={12} />
        </View>
        <View style={{ paddingHorizontal: space.lg, gap: space.sm2 }}>
          {Array.from({ length: 9 }, (_, i) => <Skeleton key={i} height={52} radius={12} />)}
        </View>
      </Screen>
    )
  }

  if (rights.error) {
    return (
      <Screen background="sunken">
        <Header back title="Admin rights" />
        <ErrorState error={rights.error} onRetry={rights.reload} />
      </Screen>
    )
  }

  if (codeOf(error) === 'ADMINS_ONLY') {
    return (
      <Screen background="sunken">
        <Header back title="Admin rights" />
        <RefusalCard error={error} title="You can’t manage admins here" onAction={() => router.back()} />
      </Screen>
    )
  }

  if (!row) {
    return (
      <Screen background="sunken">
        <Header back title="Admin rights" />
        <GoneCard
          title="This person is no longer an admin"
          message="Their rights were removed somewhere else."
          onBrowse={() => router.back()}
        />
      </Screen>
    )
  }

  return (
    <Screen background="sunken">
      <Header
        back
        title="Admin rights"
        actions={[{ icon: 'check', onPress: save, label: 'Save', tone: dirty && !readOnly ? 'accent' : 'default' }]}
      />

      <KeyboardAwareScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 48, opacity: saving ? 0.6 : 1 }}
        bottomOffset={24}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View pointerEvents={saving ? 'none' : 'auto'}>
          {readOnly ? (
            <View style={{ padding: t.layout.screenPadding }}>
              <Callout tone="info" icon="crown">The owner always has every right.</Callout>
            </View>
          ) : null}

          <View style={styles.identity}>
            <Avatar name={row.fullName} seed={row.userId} size={64} />
            <Text variant="title3" align="center" style={{ marginTop: space.sm2 }}>{row.fullName}</Text>
            {row.handle ? <Text variant="subhead" tone="muted" align="center">@{row.handle}</Text> : null}
            <Text variant="footnote" tone="faint" align="center" style={{ marginTop: space.xxs }}>Admin since {row.time}</Text>
          </View>

          {flags ? (
            <RightsSwitchList flags={flags} onChange={onChange} readOnly={readOnly} disabled={saving} />
          ) : null}

          {!readOnly ? (
            <>
              <View style={{ height: 22 }} />
              <RowGroup>
                <ListRow title="Demote to subscriber" icon="personRemove" destructive onPress={() => confirmDemote.open()} />
              </RowGroup>
            </>
          ) : null}
        </View>
      </KeyboardAwareScrollView>

      <ConfirmSheet
        visible={confirmDemote.visible}
        onClose={confirmDemote.close}
        title={`Demote ${row.fullName}?`}
        message="They’ll become a regular subscriber."
        confirmLabel="Demote"
        destructive
        onConfirm={() => { confirmDemote.close(); void demote() }}
      />

      <ConfirmSheet
        visible={confirmSelfLock.visible}
        onClose={confirmSelfLock.close}
        title="Turn off your own “Add admins”?"
        message="You’ll no longer be able to manage admins in this channel — including undoing this."
        confirmLabel="I understand"
        icon="warning"
        onConfirm={confirmSelfLock.close}
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  identity: { alignItems: 'center', paddingTop: space.lg2, paddingBottom: space.xs },
})
