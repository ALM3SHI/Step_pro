'use server';

import { revalidatePath } from 'next/cache';
import { createServiceClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/admin';
import { invalidateContentCache } from '@/lib/content/activeProvider';
import { hashQuestion, hashText } from '@/lib/ingestion/dedupe';
import { SKILL_BY_ID, type SectionId } from '@/lib/content/taxonomy';
import type { OptionKey } from '@/lib/ingestion/fastkey';

// A "use server" file may only export async functions, so these live in
// a plain module that both the actions and the client import.
import {
  AUDIO_BUCKET,
  ALLOWED_AUDIO_MIME,
  MAX_AUDIO_BYTES,
  MAX_QUESTIONS_PER_CALL,
} from '@/lib/ingestion/constants';

/**
 * Bulk ingestion — the paste/parse/key workflow.
 *
 * Restored after the admin rebuild dropped it. Two things changed on the
 * way back in:
 *
 *  1. Every entry point calls `requireAdmin()`. These write to the
 *     question bank and are public HTTP endpoints like any other action.
 *  2. Everything lands as `draft`, never `published`. An importer that
 *     can publish is an importer that can put unreviewed items into a
 *     graded exam; the panel is where that decision gets made.
 */

export type SaveCategory = SectionId;

export interface SaveQuestion {
  ref: string;
  questionText: string;
  options: Partial<Record<OptionKey, string>>;
  correctOption: OptionKey;
  explanationAr?: string;
  /** Index into the passages array, when this is a reading item. */
  passageIndex?: number;
  /** Optional at import time; unset items surface under "بلا مهارة". */
  skillId?: string;
}

export interface SavePassage {
  title?: string;
  body: string;
}

export interface SaveResult {
  ok: boolean;
  error?: string;
  batchId?: string;
  inserted?: number;
  duplicates?: number;
  skipped?: number;
}

/** Recompute hashes server-side; a client-supplied hash is client-controlled. */
function withHashes(questions: SaveQuestion[]) {
  return questions.map((q) => ({
    ...q,
    contentHash: hashQuestion(q.questionText, q.options),
  }));
}

async function existingHashes(
  db: ReturnType<typeof createServiceClient>,
  hashes: string[],
): Promise<Set<string>> {
  const found = new Set<string>();
  // Chunked: Postgres has a practical ceiling on `in (...)` list length.
  for (let i = 0; i < hashes.length; i += 500) {
    const { data, error } = await db
      .from('questions')
      .select('content_hash')
      .in('content_hash', hashes.slice(i, i + 500));
    if (error) throw new Error(`dedupe lookup failed: ${error.message}`);
    for (const row of data ?? []) found.add(row.content_hash as string);
  }
  return found;
}

/**
 * Reject a skill that does not belong to the section being imported.
 *
 * A reading skill on a grammar question misattributes the entire
 * per-skill breakdown, and it is exactly the defect that put five
 * grammar items inside the Reading section of the simulator.
 */
function resolveSkill(skillId: string | undefined, section: SectionId): string | null {
  if (!skillId) return null;
  const def = SKILL_BY_ID[skillId];
  if (!def || def.section !== section) return null;
  return skillId;
}

function guard(input: { questions: SaveQuestion[] }): string | null {
  if (!input.questions.length) return 'لا توجد أسئلة للحفظ';
  if (input.questions.length > MAX_QUESTIONS_PER_CALL) {
    return `${input.questions.length} سؤال يتجاوز حد ${MAX_QUESTIONS_PER_CALL} لكل طلب — قسّمها.`;
  }
  // Every question must carry a key. Saving an unanswered question is
  // the failure this whole workflow exists to prevent.
  const missingKey = input.questions.filter(
    (q) => !q.correctOption || !q.options[q.correctOption]?.trim(),
  );
  if (missingKey.length) return `${missingKey.length} سؤال بلا إجابة صحيحة صالحة`;
  return null;
}

// ---------------------------------------------------------------------
// 1. Hybrid batch save (grammar / reading / writing)
// ---------------------------------------------------------------------

export async function saveHybridBatch(input: {
  batchTitle: string;
  sourceNotes?: string;
  category: SaveCategory;
  questions: SaveQuestion[];
  passages?: SavePassage[];
  /** Append to an existing batch instead of creating one. */
  existingBatchId?: string;
}): Promise<SaveResult> {
  try {
    await requireAdmin();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  const title = input.batchTitle?.trim();
  if (!title && !input.existingBatchId) return { ok: false, error: 'عنوان التسليمة مطلوب' };

  const problem = guard(input);
  if (problem) return { ok: false, error: problem };

  const db = createServiceClient();

  try {
    const hashed = withHashes(input.questions);

    // Drop duplicates within this payload first, then against the DB.
    const seen = new Set<string>();
    const uniqueInPayload = hashed.filter((q) => {
      if (seen.has(q.contentHash)) return false;
      seen.add(q.contentHash);
      return true;
    });
    const inPayloadDupes = hashed.length - uniqueInPayload.length;

    const known = await existingHashes(db, uniqueInPayload.map((q) => q.contentHash));
    const fresh = uniqueInPayload.filter((q) => !known.has(q.contentHash));

    if (!fresh.length) {
      return {
        ok: false,
        error: `كل الأسئلة (${input.questions.length}) موجودة مسبقًا في قاعدة البيانات.`,
        duplicates: known.size + inPayloadDupes,
      };
    }

    // --- batch row ---
    let batchId = input.existingBatchId;
    if (!batchId) {
      const { data, error } = await db
        .from('ingestion_batches')
        .insert({
          batch_title: title,
          source_metadata: { notes: input.sourceNotes ?? '', mode: 'hybrid', category: input.category },
          status: 'processing',
          total_questions_parsed: input.questions.length,
          total_questions_duplicate: known.size + inPayloadDupes,
          total_questions_processed: fresh.length,
        })
        .select('id')
        .single();
      if (error || !data) return { ok: false, error: `تعذّر إنشاء التسليمة: ${error?.message}` };
      batchId = data.id as string;
    }

    // --- passages ---
    const passageIds: string[] = [];
    for (const p of input.passages ?? []) {
      const { data, error } = await db
        .from('passages')
        .upsert(
          { batch_id: batchId, title: p.title ?? null, body: p.body, content_hash: hashText(p.body) },
          { onConflict: 'content_hash' },
        )
        .select('id')
        .single();
      if (error) {
        await markFailed(db, batchId, `passage insert: ${error.message}`);
        return { ok: false, error: `تعذّر حفظ القطعة: ${error.message}`, batchId };
      }
      passageIds.push(data.id as string);
    }

    // --- questions ---
    const rows = fresh.map((q) => ({
      batch_id: batchId,
      passage_id: q.passageIndex !== undefined ? passageIds[q.passageIndex] ?? null : null,
      category: input.category,
      skill_id: resolveSkill(q.skillId, input.category),
      // Imported content is never live content. See the file header.
      status: 'draft',
      question_text: q.questionText,
      options: q.options,
      correct_option: q.correctOption,
      explanation: q.explanationAr?.trim() || null,
      content_hash: q.contentHash,
      // Hybrid keys come from a human clicking or from a key list they
      // verified — not from an unattended model guess.
      answer_source: 'human_review',
      needs_human_review: false,
    }));

    // ignoreDuplicates: a concurrent batch may claim a hash between the
    // lookup and the insert. Skipping is right; failing the whole batch
    // over one collision is not.
    const { data: inserted, error } = await db
      .from('questions')
      .upsert(rows, { onConflict: 'content_hash', ignoreDuplicates: true })
      .select('id');

    if (error) {
      await markFailed(db, batchId, error.message);
      return { ok: false, error: error.message, batchId };
    }

    const count = inserted?.length ?? 0;
    await db
      .from('ingestion_batches')
      .update({ status: 'completed', total_questions_saved: count, completed_at: new Date().toISOString() })
      .eq('id', batchId);

    // The exam builder reads through a cached snapshot; without this the
    // new questions stay invisible until the process restarts.
    invalidateContentCache();
    revalidatePath('/admin');
    revalidatePath('/admin/history');
    return {
      ok: true,
      batchId,
      inserted: count,
      duplicates: known.size + inPayloadDupes,
      skipped: fresh.length - count,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function markFailed(
  db: ReturnType<typeof createServiceClient>,
  batchId: string,
  message: string,
) {
  await db.from('ingestion_batches').update({ status: 'failed', error_message: message }).eq('id', batchId);
}

// ---------------------------------------------------------------------
// 2. Audio upload — signed URL, direct to Storage
// ---------------------------------------------------------------------

export interface SignedUploadResult {
  ok: boolean;
  error?: string;
  bucket?: string;
  path?: string;
  token?: string;
  audioKey?: string;
}

/**
 * Issue a one-shot signed upload URL.
 *
 * The browser PUTs the file straight to Supabase Storage with this
 * token, so the MP3 never enters a Vercel function and the 4.5 MB
 * payload cap does not apply. Validation still happens here — the
 * client cannot be trusted about size or type, and the signed URL is
 * only minted for a request that passes.
 */
export async function createAudioUploadUrl(input: {
  fileName: string;
  sizeBytes: number;
  mimeType: string;
}): Promise<SignedUploadResult> {
  try {
    await requireAdmin();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  if (!ALLOWED_AUDIO_MIME.includes(input.mimeType) && !/\.(mp3|m4a|wav)$/i.test(input.fileName)) {
    return { ok: false, error: `نوع الملف غير مدعوم: ${input.mimeType || 'غير معروف'}` };
  }
  if (input.sizeBytes <= 0 || input.sizeBytes > MAX_AUDIO_BYTES) {
    return {
      ok: false,
      error: `حجم الملف ${(input.sizeBytes / 1024 / 1024).toFixed(1)}MB خارج الحد المسموح (25MB)`,
    };
  }

  // Derive the key from the filename, matching the existing corpus
  // convention (1742938770.mp3 -> "1742938770") so re-uploading the same
  // clip maps onto the same row instead of duplicating it.
  const audioKey = input.fileName.replace(/\.[^.]+$/, '').replace(/[^\w-]/g, '_').slice(0, 80);
  if (!audioKey) return { ok: false, error: 'اسم الملف غير صالح' };

  const ext = (input.fileName.match(/\.([a-z0-9]+)$/i)?.[1] ?? 'mp3').toLowerCase();
  const path = `${audioKey}.${ext}`;

  const db = createServiceClient();
  const { data, error } = await db.storage.from(AUDIO_BUCKET).createSignedUploadUrl(path, {
    upsert: true,
  });

  if (error || !data) return { ok: false, error: `تعذّر إنشاء رابط الرفع: ${error?.message}` };

  return { ok: true, bucket: AUDIO_BUCKET, path: data.path, token: data.token, audioKey };
}

// ---------------------------------------------------------------------
// 3. Listening batch save
// ---------------------------------------------------------------------

export async function saveListeningBatch(input: {
  batchTitle: string;
  sourceNotes?: string;
  audioKey: string;
  storagePath: string;
  durationMs?: number;
  questions: SaveQuestion[];
}): Promise<SaveResult> {
  try {
    await requireAdmin();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  if (!input.batchTitle?.trim()) return { ok: false, error: 'عنوان التسليمة مطلوب' };
  if (!input.storagePath) return { ok: false, error: 'لم يُرفع ملف الصوت' };

  const problem = guard(input);
  if (problem) return { ok: false, error: problem };

  const db = createServiceClient();

  try {
    // Confirm the object actually landed. Without this, a failed browser
    // upload would still produce question rows pointing at nothing —
    // silently broken audio for the student, discovered in the exam.
    const dir = input.storagePath.includes('/')
      ? input.storagePath.slice(0, input.storagePath.lastIndexOf('/'))
      : '';
    const base = input.storagePath.slice(input.storagePath.lastIndexOf('/') + 1);
    const { data: listed, error: listErr } = await db.storage
      .from(AUDIO_BUCKET)
      .list(dir, { search: base, limit: 1 });
    if (listErr) return { ok: false, error: `تعذّر التحقق من الملف: ${listErr.message}` };
    if (!listed?.length) {
      return { ok: false, error: 'لم يُعثر على ملف الصوت في التخزين — أعد الرفع.' };
    }

    const hashed = withHashes(input.questions);
    const known = await existingHashes(db, hashed.map((q) => q.contentHash));
    const fresh = hashed.filter((q) => !known.has(q.contentHash));

    if (!fresh.length) {
      return { ok: false, error: 'كل أسئلة هذا التسجيل موجودة مسبقًا.', duplicates: known.size };
    }

    const { data: batch, error: batchErr } = await db
      .from('ingestion_batches')
      .insert({
        batch_title: input.batchTitle.trim(),
        source_metadata: {
          notes: input.sourceNotes ?? '', mode: 'hybrid',
          category: 'listening', audioKey: input.audioKey,
        },
        status: 'processing',
        total_questions_parsed: input.questions.length,
        total_questions_duplicate: known.size,
        total_questions_processed: fresh.length,
      })
      .select('id')
      .single();
    if (batchErr || !batch) return { ok: false, error: `تعذّر إنشاء التسليمة: ${batchErr?.message}` };

    const batchId = batch.id as string;

    // Upsert on audio_key so re-uploading a clip updates it in place.
    const { data: clip, error: clipErr } = await db
      .from('audio_clips')
      .upsert(
        {
          batch_id: batchId,
          audio_key: input.audioKey,
          storage_path: input.storagePath,
          duration_ms: input.durationMs ?? null,
        },
        { onConflict: 'audio_key' },
      )
      .select('id')
      .single();

    if (clipErr || !clip) {
      await markFailed(db, batchId, `audio clip: ${clipErr?.message}`);
      return { ok: false, error: `تعذّر حفظ التسجيل: ${clipErr?.message}`, batchId };
    }

    const rows = fresh.map((q, i) => ({
      batch_id: batchId,
      audio_clip_id: clip.id as string,
      ordinal: i + 1,
      category: 'listening' as const,
      skill_id: resolveSkill(q.skillId, 'listening'),
      status: 'draft',
      question_text: q.questionText,
      options: q.options,
      correct_option: q.correctOption,
      explanation: q.explanationAr?.trim() || null,
      content_hash: q.contentHash,
      answer_source: 'provided_key',
      needs_human_review: false,
    }));

    const { data: inserted, error } = await db
      .from('questions')
      .upsert(rows, { onConflict: 'content_hash', ignoreDuplicates: true })
      .select('id');

    if (error) {
      await markFailed(db, batchId, error.message);
      return { ok: false, error: error.message, batchId };
    }

    const count = inserted?.length ?? 0;
    await db
      .from('ingestion_batches')
      .update({ status: 'completed', total_questions_saved: count, completed_at: new Date().toISOString() })
      .eq('id', batchId);

    invalidateContentCache();
    revalidatePath('/admin');
    revalidatePath('/admin/history');
    return { ok: true, batchId, inserted: count, duplicates: known.size, skipped: fresh.length - count };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Playable URL for a stored clip.
 *
 * Signed rather than public: the audio is paid content, and a public
 * bucket URL is permanently scrapeable once discovered.
 */
export async function getAudioUrl(storagePath: string, expiresInSeconds = 3600) {
  try {
    await requireAdmin();
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
  }

  const db = createServiceClient();
  const { data, error } = await db.storage
    .from(AUDIO_BUCKET)
    .createSignedUrl(storagePath, expiresInSeconds);
  if (error || !data) return { ok: false as const, error: error?.message ?? 'signing failed' };
  return { ok: true as const, url: data.signedUrl };
}

// ---------------------------------------------------------------------
// 4. History
// ---------------------------------------------------------------------

export interface BatchHistoryRow {
  id: string;
  title: string;
  status: string;
  category: string | null;
  mode: string | null;
  notes: string;
  parsed: number;
  saved: number;
  duplicates: number;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
}

/** Every ingestion run, newest first — the audit trail for imports. */
export async function listBatchHistory(): Promise<{
  ok: boolean;
  error?: string;
  rows?: BatchHistoryRow[];
}> {
  try {
    await requireAdmin();

    const db = createServiceClient();
    const { data, error } = await db
      .from('ingestion_batches')
      .select('id, batch_title, status, source_metadata, total_questions_parsed, total_questions_saved, total_questions_duplicate, error_message, created_at, completed_at')
      .order('created_at', { ascending: false });
    if (error) return { ok: false, error: error.message };

    return {
      ok: true,
      rows: (data ?? []).map((r) => {
        const meta = (r.source_metadata ?? {}) as { notes?: string; category?: string; mode?: string };
        return {
          id: r.id as string,
          title: r.batch_title as string,
          status: r.status as string,
          category: meta.category ?? null,
          mode: meta.mode ?? null,
          notes: meta.notes ?? '',
          parsed: (r.total_questions_parsed as number) ?? 0,
          saved: (r.total_questions_saved as number) ?? 0,
          duplicates: (r.total_questions_duplicate as number) ?? 0,
          errorMessage: (r.error_message as string) ?? null,
          createdAt: r.created_at as string,
          completedAt: (r.completed_at as string) ?? null,
        };
      }),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
