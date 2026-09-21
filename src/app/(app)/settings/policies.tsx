/* =========================================================
   Policies.

   Acceptance is versioned: `/app/policies/{key}` returns the
   current version and `/app/policies/me/accepted` returns what
   this account has agreed to. When those differ the user has
   not accepted the CURRENT text, and the row says so rather
   than showing a stale green tick.

   The policy bodies come from the server as rich text, so they
   render through the same RichText renderer as everything else
   — a Terms page that reads differently from the rest of the
   app is a Terms page nobody reads.
   ========================================================= */
import React from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { api, POLICY_KEYS } from '@/api'
import { useAsync } from '@/hooks/useAsync'
import {
  GroupFooter, GroupLabel, Header, InlineError, ListRow, RowGroup, Screen, ScreenScroll,
  SkeletonList,
} from '@/ui'

export default function PoliciesScreen() {
  const router = useRouter()
  const accepted = useAsync<any[]>(() => api.settings.app.accepted(), { deps: [] })

  const acceptedMap = React.useMemo(() => {
    const m = new Map<string, string>()
    for (const row of accepted.data ?? []) {
      if (row?.policyKey) m.set(String(row.policyKey), String(row.version ?? ''))
    }
    return m
  }, [accepted.data])

  return (
    <Screen background="sunken">
      <Header back title="Terms & policies" />
      <ScreenScroll refreshing={accepted.refreshing} onRefresh={accepted.refresh}>
        <GroupLabel>Documents</GroupLabel>
        {accepted.loading ? <SkeletonList count={3} /> : (
          <>
            {/* The rows still navigate, so they stay — but an unread
                acceptance list must be shown as a failure, never as "Not
                accepted", which is the one answer we cannot know. */}
            {accepted.error ? <InlineError error={accepted.error} onRetry={accepted.reload} /> : null}
            <RowGroup>
              {(POLICY_KEYS as string[][]).map(([key, label]) => (
                <PolicyRow
                  key={key}
                  policyKey={key}
                  label={label}
                  acceptedVersion={acceptedMap.get(key) ?? null}
                  statusUnknown={!!accepted.error}
                  onPress={() => router.push(`/policies/${key}`)}
                />
              ))}
            </RowGroup>
          </>
        )}
        <GroupFooter>
          When a document changes you'll be asked to read and accept the new version.
          Until then, the version you accepted still applies.
        </GroupFooter>
      </ScreenScroll>
    </Screen>
  )
}

/** One row, with its own version read so a slow or missing document costs one
 *  subtitle rather than the whole list. */
function PolicyRow({
  policyKey, label, acceptedVersion, statusUnknown, onPress,
}: {
  policyKey: string; label: string; acceptedVersion: string | null;
  statusUnknown?: boolean; onPress: () => void
}) {
  const doc = useAsync<any>(() => api.settings.app.policy(policyKey), { deps: [policyKey] })
  const current = doc.data?.version ? String(doc.data.version) : null

  /* `statusUnknown` means the acceptance read failed — a missing version is
     then absence of evidence, not evidence of "Not accepted". */
  const state = statusUnknown || !current ? null
    : !acceptedVersion ? 'Not accepted'
      : acceptedVersion === current ? 'Accepted'
        : 'Update to accept'

  return (
    <ListRow
      title={label}
      subtitle={doc.data?.effectiveDate
        ? `In effect since ${new Date(doc.data.effectiveDate).toLocaleDateString()}`
        : undefined}
      icon={policyKey === 'guidelines' ? 'people' : policyKey === 'privacy' ? 'lock' : 'book'}
      iconTone={state === 'Update to accept' ? 'warning' : state === 'Accepted' ? 'success' : 'neutral'}
      accessory={state ? { kind: 'value', text: state } : { kind: 'chevron' }}
      onPress={onPress}
    />
  )
}
