/* =========================================================
   New group — two steps, one screen.

   Step 1 picks people, step 2 names them. Splitting them into
   two routes would make Back from the naming step leave the
   flow instead of returning to the selection, which is the
   opposite of what Back means here.

   The 256-member cap is enforced client-side because the
   server's answer is a 400 that arrives after the user has
   picked 300 people. Blocked and unknown ids are dropped
   server-side without comment, so the footnote says so rather
   than letting the group quietly come back smaller.
   ========================================================= */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { FlashList } from '@shopify/flash-list'
import * as ImagePicker from 'expo-image-picker'
import { useRouter } from 'expo-router'
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { api, fieldErrorMap } from '@/api'
import { useAuth } from '@/context/AuthContext'
import { chatError } from '@/lib/chatErrors'
import { prepareUpload } from '@/lib/mediaTier'
import { toUploadFile } from '@/platform/files'
import { useEvent } from '@/hooks/useAsync'
import { useTheme } from '@/theme/ThemeProvider'
import { space } from '@/theme/tokens'
import {
  Avatar, AvatarStack, Button, EmptyState, Field, Header, Icon, ListRow, Screen,
  SearchField, Text, Touchable, toast,
} from '@/ui'
import {
  PersonRow, PickerSectionLabel, SelectionChips, usePeopleSearch,
} from '@/components/chat/PeoplePicker'

const MAX_MEMBERS = 256

const keyExtractor = (item: any) => String(item.id)

export default function NewGroupScreen() {
  const t = useTheme()
  const c = t.colors
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { user } = useAuth()

  const [step, setStep] = React.useState<1 | 2>(1)
  const [picked, setPicked] = React.useState<any[]>([])
  const [title, setTitle] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [photo, setPhoto] = React.useState<any>(null)
  const [creating, setCreating] = React.useState(false)
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({})

  /* The creator is added by the server; offering yourself is a dead tap. */
  const exclude = React.useMemo(() => new Set([String(user?.id ?? '')]), [user?.id])
  const search = usePeopleSearch({ excludeIds: exclude })

  const pickedIds = React.useMemo(() => new Set(picked.map(p => String(p.id))), [picked])
  const full = picked.length >= MAX_MEMBERS

  /* Identity-stable and person-first, so the one function serves every row and
     renderItem below keeps its identity across a re-render. */
  const toggle = useEvent((person: any) => {
    const id = String(person.id)
    setPicked(prev => (
      prev.some(p => String(p.id) === id)
        ? prev.filter(p => String(p.id) !== id)
        : prev.length >= MAX_MEMBERS ? prev : [...prev, person]
    ))
  })

  const people = search.active ? search.results : search.suggestions
  /* Typed search results keep the SERVER's relevance ranking (never re-sort a
     server-ranked list); only the idle suggestions list is alphabetized, where
     scanning by name is what a picker is for. */
  const sorted = React.useMemo(
    () => (search.active
      ? people
      : [...people].sort((a, b) => String(a.full || '').localeCompare(String(b.full || '')))),
    [people, search.active],
  )

  const renderPerson = React.useCallback(({ item }: { item: any }) => {
    const selected = pickedIds.has(String(item.id))
    return (
      <PersonRow
        user={item}
        checkbox
        selected={selected}
        disabled={!selected && full}
        disabledNote={!selected && full ? 'Group is full' : undefined}
        onPress={() => toggle(item)}
      />
    )
  }, [pickedIds, full, toggle])

  const pickPhoto = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 1,
    })
    if (res.canceled || !res.assets?.length) return
    /* Honour the user's data-saver tier before anything touches the network. */
    setPhoto(await prepareUpload(res.assets[0] as any))
  }

  const create = async () => {
    if (!title.trim() || creating) return
    setCreating(true)
    setFieldErrors({})
    try {
      const convo: any = await api.chat.conversations.createGroup({
        title: title.trim(),
        description: description.trim() || undefined,
        memberIds: picked.slice(0, MAX_MEMBERS).map(p => p.id),
      } as any)

      if (photo) {
        try {
          const uploaded: any = await api.media.upload(toUploadFile(photo), { type: 'IMAGE' })
          /* NOTE: MediaStatusResponse documents `mediaId`, not a storage key —
             `storageKey` is read first for the deploys that do return one, and
             the id is the documented fallback the update endpoint accepts. */
          const avatarKey = uploaded?.storageKey || uploaded?.key || uploaded?.mediaId
          if (avatarKey) await api.chat.conversations.update(convo.id, { avatarKey })
        } catch {
          /* A failed photo must not cost the group that already exists. */
          toast.warn('Group created — the photo could not be uploaded.')
        }
      }

      router.replace(`/chat/${convo.id}`)
    } catch (e: any) {
      /* Keep the draft. Re-typing a description because the server 400'd is a
         punishment for the server's answer. */
      const map = fieldErrorMap(e) as Record<string, string>
      if (Object.keys(map).length) setFieldErrors(map)
      else toast.error(chatError(e, 'Could not create this group'))
      setCreating(false)
    }
  }

  /* ---------------- step 1 ---------------- */

  if (step === 1) {
    return (
      <Screen>
        <Header
          title="New group"
          closeButton
          back={() => router.back()}
          actions={[{ icon: 'forward', onPress: () => setStep(2), label: 'Next', tone: 'accent' }]}
          below={
            <View style={styles.pickerHead}>
              <SelectionChips users={picked} onRemove={id => setPicked(prev => prev.filter(p => String(p.id) !== id))} />
              <View style={styles.field}>
                <SearchField value={search.query} onChangeText={search.setQuery} placeholder="Search people" autoFocus />
              </View>
            </View>
          }
        />

        <FlashList
          data={sorted}
          keyExtractor={keyExtractor}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          renderItem={renderPerson}
          ListHeaderComponent={
            <PickerSectionLabel>{search.active ? 'Results' : 'Suggested'}</PickerSectionLabel>
          }
          ListEmptyComponent={
            search.active && !search.searching
              ? <EmptyState icon="search" title={`No people found for “${search.query.trim()}”`} compact />
              : null
          }
          contentContainerStyle={{ paddingBottom: insets.bottom + 60 }}
        />

        <View style={[styles.footer, { backgroundColor: c.bg, borderTopColor: c.separator, paddingBottom: insets.bottom + 10 }]}>
          <Text variant="footnote" tone="muted" align="ui" style={styles.flex}>
            {picked.length}/{MAX_MEMBERS} selected
          </Text>
          <Button label="Next" onPress={() => setStep(2)} disabled={!picked.length} size="sm" />
        </View>
      </Screen>
    )
  }

  /* ---------------- step 2 ---------------- */

  return (
    <Screen>
      <Header
        title="New group"
        back={() => setStep(1)}
        actions={[{ icon: 'check', onPress: create, label: 'Create', tone: 'accent' }]}
      />

      <KeyboardAwareScrollView
        contentContainerStyle={[styles.form, { paddingBottom: insets.bottom + 40 }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        bottomOffset={20}
        showsVerticalScrollIndicator={false}
      >
        <Touchable onPress={pickPhoto} feedback="scale" accessibilityLabel="Choose a group photo" style={styles.avatarWrap}>
          <Avatar uri={photo?.uri} name={title || 'Group'} seed="new-group" size={88} square />
          <View style={[styles.cameraBadge, { backgroundColor: c.accent, borderColor: c.bg }]}>
            <Icon name="camera" size={14} color={c.textOnAccent} filled />
          </View>
        </Touchable>

        <Field
          label="Group name"
          value={title}
          onChangeText={v => { setTitle(v); setFieldErrors(f => ({ ...f, title: '' })) }}
          error={fieldErrors.title || null}
          placeholder="What is this group about?"
          maxLength={120}
          required
          editable={!creating}
        />

        <Field
          label="Description (optional)"
          value={description}
          onChangeText={setDescription}
          error={fieldErrors.description || null}
          placeholder="Add a description so people know what this group is about"
          maxLength={500}
          multiline
          minHeight={96}
          editable={!creating}
        />

        <ListRow
          title="Members"
          subtitle={`${picked.length} selected`}
          leading={<AvatarStack users={picked.map(p => ({ id: p.id, name: p.full, avatarUrl: p.profileImage }))} size={28} max={5} />}
          accessory={{ kind: 'chevron' }}
          onPress={() => setStep(1)}
        />

        <ListRow
          title="Disappearing messages"
          subtitle="Choose a timer once the group exists"
          icon="hourglass"
          iconTone="warning"
          accessory={{ kind: 'value', text: 'Off', chevron: false }}
          disabled
        />

        <Button
          label={creating ? 'Creating…' : 'Create group'}
          onPress={create}
          loading={creating}
          disabled={!title.trim() || creating}
          size="lg"
          block
          style={{ marginTop: space.md }}
        />
      </KeyboardAwareScrollView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  pickerHead: { paddingBottom: space.sm },
  field: { paddingHorizontal: space.lg },
  footer: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    paddingHorizontal: space.lg, paddingTop: space.sm2, borderTopWidth: StyleSheet.hairlineWidth,
  },
  flex: { flex: 1 },
  form: { padding: space.lg, gap: space.lg },
  avatarWrap: { alignSelf: 'center' },
  cameraBadge: {
    position: 'absolute', end: -2, bottom: -2,
    width: 28, height: 28, borderRadius: 14, borderWidth: 2,
    alignItems: 'center', justifyContent: 'center',
  },
})
