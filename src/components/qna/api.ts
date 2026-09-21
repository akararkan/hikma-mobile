/* =========================================================
   A typed view of the Q&A slice of `@/api`.

   The api modules are JavaScript. TypeScript infers a
   destructured default parameter from its DEFAULTS ONLY, so a
   property with no default — `cursor`, `prefix`, `signal` —
   disappears from the inferred options type and passing it is
   a compile error even though the runtime reads it. These
   declarations restate the signatures that src/api already
   documents in JSDoc. They add no behaviour, invent no
   endpoint, and every method below exists in qna.js / tags.js
   / mentions.js / search.js today.

   The `Raw*` return types are deliberate: those are the
   methods the module does NOT map, and the caller must run
   them through adapters (see `to*` in ./types).
   ========================================================= */
import { api } from '@/api'
import type {
  AnswerView, AttachmentView, QnaAuthor, QuestionView, SearchHitView,
  ShareLinkInfo, SourceKind, SourceView, TagContentRow, TagSuggestion, TrendingTag,
} from './types'

export interface CursorPage<T> { items: T[]; nextCursor: string | null; hasMore: boolean }
export interface PageOpts { page?: number; size?: number; signal?: AbortSignal }

/** A wire DTO the module handed back unmapped. */
export type RawQuestion = unknown
export type RawAnswer = unknown

export interface CreateQuestionRequest {
  title: string
  body: string
  tags?: string[]
  keywords?: string
  answersLocked?: boolean
  maxAnswers?: number | null
}

export interface EditQuestionRequest {
  title?: string
  body?: string
  tags?: string[]
  keywords?: string
}

export interface SourceRequest {
  sourceType: SourceKind
  title?: string
  citationText?: string
  url?: string
  isbn?: string
  displayOrder?: number
}

export interface CreateAnswerRequest {
  body: string
  links?: string
  sources?: SourceRequest[]
  /** Length of the attached voice note. The server stamps `voiceUrl` itself
   *  from the uploaded part, but it cannot know the duration — without this
   *  every voice answer renders a 0:00 clock until it has been played
   *  (answers.md, CreateAnswerRequest). */
  voiceDurationSeconds?: number
}

interface QnaApi {
  feed(opts?: { cursor?: string | null; limit?: number; signal?: AbortSignal }): Promise<CursorPage<QuestionView>>
  following(opts?: PageOpts): Promise<QuestionView[]>
  mine(opts?: PageOpts): Promise<QuestionView[]>
  get(id: string): Promise<QuestionView>
  create(req: CreateQuestionRequest): Promise<QuestionView>
  edit(id: string, req: EditQuestionRequest): Promise<RawQuestion>
  remove(id: string): Promise<null>

  lockAnswers(id: string): Promise<RawQuestion>
  unlockAnswers(id: string): Promise<RawQuestion>
  /** Omit `maxAnswers` to clear the cap — buildUrl drops undefined values. */
  answerLimit(id: string, maxAnswers?: number): Promise<RawQuestion>

  answers(id: string, opts?: PageOpts): Promise<AnswerView[]>
  postAnswer(id: string, req: CreateAnswerRequest): Promise<AnswerView>
  postAnswerUpload(id: string, formData: FormData): Promise<AnswerView>
  /** Defaults to size 50 here, not 20. */
  reanswers(id: string, answerId: string, opts?: PageOpts): Promise<AnswerView[]>
  postReanswer(id: string, answerId: string, req: CreateAnswerRequest): Promise<AnswerView>
  postReanswerUpload(id: string, answerId: string, formData: FormData): Promise<AnswerView>
  /** The third argument is the raw body STRING — the module wraps it. */
  editAnswer(id: string, answerId: string, body: string): Promise<RawAnswer>
  deleteAnswer(id: string, answerId: string): Promise<null>

  react(id: string, answerId: string): Promise<RawAnswer>
  unreact(id: string, answerId: string): Promise<RawAnswer>
  accept(id: string, answerId: string): Promise<RawAnswer>
  unaccept(id: string, answerId: string): Promise<RawAnswer>

  listAttachments(id: string, answerId: string): Promise<AttachmentView[]>
  /** caption/displayOrder travel as QUERY params in this client. */
  addAttachment(id: string, answerId: string, formData: FormData, query?: { caption?: string; displayOrder?: number }, opts?: { onProgress?: (fraction: number) => void; signal?: AbortSignal }): Promise<AttachmentView>
  editAttachment(id: string, answerId: string, attachmentId: string, req: { caption?: string; displayOrder?: number }): Promise<AttachmentView>
  deleteAttachment(id: string, answerId: string, attachmentId: string): Promise<null>

  listSources(id: string, answerId: string): Promise<SourceView[]>
  addSource(id: string, answerId: string, req: SourceRequest): Promise<SourceView>
  editSource(id: string, answerId: string, sourceId: string, req: SourceRequest | { displayOrder: number }): Promise<SourceView>
  uploadSourceFile(id: string, answerId: string, sourceId: string, formData: FormData): Promise<SourceView>
  deleteSource(id: string, answerId: string, sourceId: string): Promise<null>

  save(id: string, collection?: string): Promise<RawQuestion>
  unsave(id: string): Promise<RawQuestion>
  mySaved(opts?: PageOpts): Promise<QuestionView[]>
  mySavedCollection(name: string, opts?: PageOpts): Promise<QuestionView[]>
  savedCollections(): Promise<string[]>
  renameCollection(oldName: string, newName: string): Promise<null>

  shareLink(id: string): Promise<ShareLinkInfo>
  recordShare(id: string): Promise<ShareLinkInfo>
}

interface TagsApi {
  trending(opts?: { scope?: string; limit?: number }): Promise<TrendingTag[]>
  content(tag: string, opts?: { cursor?: string; pageSize?: number }): Promise<{ tag: string; items: TagContentRow[]; nextCursor: string; pageSize: number }>
  usage(tag: string, opts?: { scope?: string }): Promise<{ tag: string; scopes?: Record<string, number>; scope?: string; usageCount?: number }>
  search(opts: { prefix: string; scope?: string; limit?: number }): Promise<TagSuggestion[]>
}

interface MentionsApi {
  suggest(q: string, limit?: number): Promise<QnaAuthor[]>
  click(query: string, targetUserId: string): Promise<unknown>
}

export interface SearchEnvelope {
  query: string
  types: string[]
  page: number
  size: number
  degraded: boolean
  nextCursor: string
  results: SearchHitView[]
}

interface SearchApi {
  stream(q: string, opts?: { types?: string[]; cursor?: string; size?: number; expand?: boolean; signal?: AbortSignal }): Promise<SearchEnvelope>
}

export const qna = api.qna as unknown as QnaApi
export const tagsApi = api.tags as unknown as TagsApi
export const mentionsApi = api.mentions as unknown as MentionsApi
export const searchApi = api.search as unknown as SearchApi
