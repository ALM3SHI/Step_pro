/**
 * Content repository — the single door to content in the database.
 *
 * Every read and write of questions, passages, audio clips and batches
 * goes through here. Nothing else builds a Supabase query for content,
 * so the field mapping, the hashing rule, and the cache invalidation
 * exist once instead of being re-derived (and eventually contradicted)
 * at each call site.
 *
 * This is also the seam future features attach to without touching the
 * UI: a bulk importer, an AI explanation generator, a translation pass,
 * and a quality analyser are all just more callers of these methods.
 */

import 'server-only';
import { createServiceClient } from '../supabase/server';
import { invalidateContentCache } from './activeProvider';
import { hashQuestion, hashText } from '../ingestion/dedupe';
import { normalizeAuthoredText, type DraftQuestion } from './validation';
import type { OptionKey } from './schema';
import type { Difficulty, SectionId } from './taxonomy';

export type ContentStatus = 'draft' | 'review' | 'published' | 'retired';

export interface BatchSummary {
  id: string;
  title: string;
  notes: string;
  status: string;
  createdAt: string;
  counts: {
    total: number;
    published: number;
    draft: number;
    review: number;
    bySection: Record<string, number>;
  };
}

export interface EditableQuestion {
  id: string;
  batchId: string | null;
  section: SectionId;
  skillId: string | null;
  difficulty: Difficulty;
  status: ContentStatus;
  text: string;
  options: Partial<Record<OptionKey, string>>;
  correctOption: OptionKey | null;
  explanationAr: string | null;
  tags: string[];
  passageId: string | null;
  audioClipId: string | null;
  imageUrl: string | null;
  imageAlt: string | null;
  ordinal: number | null;
  contentHash: string;
  updatedAt: string;
}

export interface PassageRef {
  id: string;
  title: string | null;
  body: string;
  imageUrl: string | null;
}

export interface AudioClipRef {
  id: string;
  audioKey: string;
  storagePath: string;
  durationMs: number | null;
}

// ---------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------

type Row = Record<string, unknown>;

function toQuestion(r: Row): EditableQuestion {
  return {
    id: r.id as string,
    batchId: (r.batch_id as string) ?? null,
    section: r.category as SectionId,
    skillId: (r.skill_id as string) ?? null,
    difficulty: ((r.difficulty as Difficulty) ?? 'medium'),
    status: ((r.status as ContentStatus) ?? 'draft'),
    text: r.question_text as string,
    options: (r.options ?? {}) as Partial<Record<OptionKey, string>>,
    correctOption: (r.correct_option as OptionKey) ?? null,
    explanationAr: (r.explanation as string) ?? null,
    tags: (r.tags as string[]) ?? [],
    passageId: (r.passage_id as string) ?? null,
    audioClipId: (r.audio_clip_id as string) ?? null,
    imageUrl: (r.image_url as string) ?? null,
    imageAlt: (r.image_alt as string) ?? null,
    ordinal: (r.ordinal as number) ?? null,
    contentHash: r.content_hash as string,
    updatedAt: (r.updated_at as string) ?? '',
  };
}

const QUESTION_COLUMNS =
  'id, batch_id, category, skill_id, difficulty, status, question_text, options, ' +
  'correct_option, explanation, tags, passage_id, audio_clip_id, image_url, image_alt, ' +
  'ordinal, content_hash, updated_at';

/** Shape a draft into a database row. Text normalisation happens here. */
function toRow(q: DraftQuestion, batchId: string | null) {
  const text = normalizeAuthoredText(q.text);
  const options = Object.fromEntries(
    Object.entries(q.options)
      .filter(([, v]) => v?.trim())
      // Options are single-line by nature; collapsing here prevents a
      // stray paste from breaking the exam layout.
      .map(([k, v]) => [k, v!.replace(/\s+/g, ' ').trim()]),
  ) as Record<OptionKey, string>;

  return {
    batch_id: batchId,
    category: q.section,
    skill_id: q.skillId || null,
    difficulty: q.difficulty,
    status: q.status,
    question_text: text,
    options,
    correct_option: q.correctOption || null,
    // Explanations are multi-paragraph by design; newlines survive.
    explanation: q.explanationAr?.trim() ? normalizeAuthoredText(q.explanationAr) : null,
    tags: q.tags ?? [],
    passage_id: q.passageId || null,
    audio_clip_id: q.audioClipId || null,
    image_url: q.imageUrl || null,
    image_alt: q.imageAlt || null,
    ordinal: q.ordinal ?? null,
    // Recomputed server-side from the normalised text: a client-supplied
    // hash is a client-controlled dedup key.
    content_hash: hashQuestion(text, options),
    answer_source: 'human_review' as const,
    needs_human_review: q.status === 'review',
  };
}

// ---------------------------------------------------------------------
// Batches
// ---------------------------------------------------------------------

export async function listBatches(): Promise<BatchSummary[]> {
  const db = createServiceClient();

  const { data: batches, error } = await db
    .from('ingestion_batches')
    .select('id, batch_title, source_metadata, status, created_at')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);

  // One grouped read rather than a count per batch, which would be N+1.
  const counts = new Map<string, BatchSummary['counts']>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error: qErr } = await db
      .from('questions')
      .select('batch_id, status, category')
      .range(from, from + PAGE - 1);
    if (qErr) throw new Error(qErr.message);
    if (!data?.length) break;

    for (const row of data) {
      const id = (row.batch_id as string) ?? 'orphan';
      const c = counts.get(id) ?? { total: 0, published: 0, draft: 0, review: 0, bySection: {} };
      c.total++;
      const st = row.status as ContentStatus;
      if (st === 'published') c.published++;
      else if (st === 'draft') c.draft++;
      else if (st === 'review') c.review++;
      const sec = row.category as string;
      c.bySection[sec] = (c.bySection[sec] ?? 0) + 1;
      counts.set(id, c);
    }
    if (data.length < PAGE) break;
  }

  return (batches ?? []).map((b) => ({
    id: b.id as string,
    title: b.batch_title as string,
    notes: ((b.source_metadata as { notes?: string })?.notes) ?? '',
    status: b.status as string,
    createdAt: b.created_at as string,
    counts: counts.get(b.id as string) ?? { total: 0, published: 0, draft: 0, review: 0, bySection: {} },
  }));
}

export async function createBatch(title: string, notes: string): Promise<string> {
  const db = createServiceClient();
  const { data, error } = await db
    .from('ingestion_batches')
    .insert({
      batch_title: title.trim(),
      source_metadata: { notes: notes.trim(), origin: 'admin' },
      status: 'completed',
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(error?.message ?? 'batch insert failed');
  return data.id as string;
}

export async function deleteBatch(batchId: string) {
  const db = createServiceClient();
  const { data, error } = await db.rpc('delete_ingestion_batch', { p_batch_id: batchId });
  if (error) throw new Error(error.message);
  invalidateContentCache();
  const row = Array.isArray(data) ? data[0] : data;
  return { title: row?.deleted_batch_title as string, questions: row?.deleted_questions as number };
}

// ---------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------

export async function listQuestions(batchId: string): Promise<EditableQuestion[]> {
  const db = createServiceClient();
  const out: Row[] = [];
  const PAGE = 1000;

  // Paged: PostgREST caps a response at 1,000 rows, so a batch of 1,102
  // would silently load 1,000 and the editor would show — and let you
  // reorder — an incomplete list.
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from('questions')
      .select(QUESTION_COLUMNS)
      .eq('batch_id', batchId)
      // `ordinal` is the author's chosen order; created_at is the stable
      // tiebreak so rows without one never shuffle between loads.
      .order('ordinal', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    out.push(...(data as unknown as Row[]));
    if (data.length < PAGE) break;
  }

  return out.map(toQuestion);
}

export async function getQuestion(id: string): Promise<EditableQuestion | null> {
  const db = createServiceClient();
  const { data, error } = await db.from('questions').select(QUESTION_COLUMNS).eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? toQuestion(data as unknown as Row) : null;
}

/**
 * Find an existing question with the same canonical content.
 *
 * `excludeId` lets an edit re-save itself without matching its own row.
 */
export async function findDuplicate(
  text: string,
  options: Partial<Record<OptionKey, string>>,
  excludeId?: string,
): Promise<{ id: string; batchId: string | null; text: string } | null> {
  const db = createServiceClient();
  const hash = hashQuestion(normalizeAuthoredText(text), options);

  let query = db.from('questions').select('id, batch_id, question_text').eq('content_hash', hash);
  if (excludeId) query = query.neq('id', excludeId);

  const { data, error } = await query.limit(1);
  if (error) throw new Error(error.message);
  if (!data?.length) return null;
  return {
    id: data[0].id as string,
    batchId: (data[0].batch_id as string) ?? null,
    text: data[0].question_text as string,
  };
}

export async function createQuestion(q: DraftQuestion, batchId: string): Promise<EditableQuestion> {
  const db = createServiceClient();
  const { data, error } = await db
    .from('questions')
    .insert(toRow(q, batchId))
    .select(QUESTION_COLUMNS)
    .single();
  if (error) throw new Error(translateDbError(error.message));
  invalidateContentCache();
  return toQuestion(data as unknown as Row);
}

export async function updateQuestion(id: string, q: DraftQuestion): Promise<EditableQuestion> {
  const db = createServiceClient();
  const existing = await getQuestion(id);
  if (!existing) throw new Error('السؤال غير موجود');

  const { data, error } = await db
    .from('questions')
    .update(toRow(q, existing.batchId))
    .eq('id', id)
    .select(QUESTION_COLUMNS)
    .single();
  if (error) throw new Error(translateDbError(error.message));
  invalidateContentCache();
  return toQuestion(data as unknown as Row);
}

export async function deleteQuestion(id: string) {
  const db = createServiceClient();
  const { error } = await db.from('questions').delete().eq('id', id);
  if (error) throw new Error(error.message);
  invalidateContentCache();
}

/** Persist a new display order. Positions are 1-based. */
export async function reorderQuestions(orderedIds: string[]) {
  const db = createServiceClient();
  // Sequential rather than parallel: Supabase has no batch-update
  // primitive, and firing 200 concurrent requests trips its rate limit.
  for (let i = 0; i < orderedIds.length; i++) {
    const { error } = await db.from('questions').update({ ordinal: i + 1 }).eq('id', orderedIds[i]);
    if (error) throw new Error(error.message);
  }
  invalidateContentCache();
}

/** Move questions to another batch, appending to its existing order. */
export async function moveQuestions(ids: string[], targetBatchId: string) {
  const db = createServiceClient();

  const { data: last } = await db
    .from('questions')
    .select('ordinal')
    .eq('batch_id', targetBatchId)
    .order('ordinal', { ascending: false, nullsFirst: false })
    .limit(1);
  let next = ((last?.[0]?.ordinal as number) ?? 0) + 1;

  for (const id of ids) {
    const { error } = await db
      .from('questions')
      .update({ batch_id: targetBatchId, ordinal: next++ })
      .eq('id', id);
    if (error) throw new Error(error.message);
  }
  invalidateContentCache();
}

export async function setStatus(ids: string[], status: ContentStatus) {
  const db = createServiceClient();
  const { error } = await db.from('questions').update({ status }).in('id', ids);
  if (error) throw new Error(translateDbError(error.message));
  invalidateContentCache();
}

// ---------------------------------------------------------------------
// Stimuli
// ---------------------------------------------------------------------

export async function listPassages(): Promise<PassageRef[]> {
  const db = createServiceClient();
  const { data, error } = await db
    .from('passages')
    .select('id, title, body, image_url')
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) throw new Error(error.message);
  return (data ?? []).map((p) => ({
    id: p.id as string,
    title: (p.title as string) ?? null,
    body: p.body as string,
    imageUrl: (p.image_url as string) ?? null,
  }));
}

export async function createPassage(input: {
  title?: string;
  body: string;
  batchId: string;
  imageUrl?: string;
  imageAlt?: string;
}): Promise<PassageRef> {
  const db = createServiceClient();
  const body = normalizeAuthoredText(input.body);

  const { data, error } = await db
    .from('passages')
    .upsert(
      {
        batch_id: input.batchId,
        title: input.title?.trim() || null,
        body,
        content_hash: hashText(body),
        image_url: input.imageUrl || null,
        image_alt: input.imageAlt || null,
      },
      // Re-pasting the same passage reuses the existing row instead of
      // creating a near-duplicate the editor then shows twice.
      { onConflict: 'content_hash' },
    )
    .select('id, title, body, image_url')
    .single();
  if (error) throw new Error(error.message);
  invalidateContentCache();
  return {
    id: data.id as string,
    title: (data.title as string) ?? null,
    body: data.body as string,
    imageUrl: (data.image_url as string) ?? null,
  };
}

export async function listAudioClips(): Promise<AudioClipRef[]> {
  const db = createServiceClient();
  const { data, error } = await db
    .from('audio_clips')
    .select('id, audio_key, storage_path, duration_ms')
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) throw new Error(error.message);
  return (data ?? []).map((c) => ({
    id: c.id as string,
    audioKey: c.audio_key as string,
    storagePath: c.storage_path as string,
    durationMs: (c.duration_ms as number) ?? null,
  }));
}

export async function createAudioClip(input: {
  audioKey: string;
  storagePath: string;
  batchId: string;
  durationMs?: number;
  transcript?: string;
}): Promise<AudioClipRef> {
  const db = createServiceClient();
  const { data, error } = await db
    .from('audio_clips')
    .upsert(
      {
        batch_id: input.batchId,
        audio_key: input.audioKey,
        storage_path: input.storagePath,
        duration_ms: input.durationMs ?? null,
        transcript: input.transcript ?? null,
      },
      { onConflict: 'audio_key' },
    )
    .select('id, audio_key, storage_path, duration_ms')
    .single();
  if (error) throw new Error(error.message);
  invalidateContentCache();
  return {
    id: data.id as string,
    audioKey: data.audio_key as string,
    storagePath: data.storage_path as string,
    durationMs: (data.duration_ms as number) ?? null,
  };
}

// ---------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------

/** Turn Postgres constraint names into something an author can act on. */
function translateDbError(message: string): string {
  if (/questions_content_hash_key/.test(message)) {
    return 'هذا السؤال موجود مسبقًا في قاعدة البيانات (نفس النص والخيارات).';
  }
  if (/questions_published_needs_skill/.test(message)) {
    return 'لا يمكن نشر سؤال بلا مهارة.';
  }
  if (/skill .* belongs to/.test(message)) {
    return 'المهارة المختارة تخص قسمًا آخر.';
  }
  if (/questions_options_min_two/.test(message)) {
    return 'يجب أن يحتوي السؤال على خيارين على الأقل (A و B).';
  }
  if (/questions_image_has_alt/.test(message)) {
    return 'الصورة تحتاج وصفًا نصيًا.';
  }
  return message;
}
