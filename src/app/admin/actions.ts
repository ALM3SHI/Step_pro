'use server';

import { revalidatePath } from 'next/cache';
import { createServiceClient } from '@/lib/supabase/server';
import { runPipeline } from '@/lib/ingestion/pipeline';
import { createProvider } from '@/lib/llm/providers';
import { solveAll } from '@/lib/llm/solver';
import type { SolveInput } from '@/lib/llm/types';

export interface StagedQuestion {
  ref: string;
  questionText: string;
  options: Record<string, string>;
  correctOption: string;
  explanationAr: string;
  category: string;
  consensusRatio: number;
  confidence: number;
  needsHumanReview: boolean;
  reviewReasons: string[];
  contentHash: string;
  passageIndex?: number;
  sourceLine: number;
}

export interface ProcessResult {
  ok: boolean;
  error?: string;
  batchId?: string;
  staged: StagedQuestion[];
  passages: Array<{ title?: string; body: string; contentHash: string }>;
  stats: Record<string, unknown>;
}

/**
 * Stage 1 of ingestion: clean, dedupe, solve — but do NOT commit.
 *
 * Nothing reaches `questions` until a human presses Approve. The batch
 * row is created up front in 'processing' so a crash mid-run leaves a
 * visible failed batch rather than an invisible one.
 */
export async function processRawText(formData: FormData): Promise<ProcessResult> {
  const raw = String(formData.get('rawText') ?? '');
  const title = String(formData.get('batchTitle') ?? '').trim();
  const sourceNotes = String(formData.get('sourceNotes') ?? '').trim();

  if (!title) return { ok: false, error: 'Batch title is required', staged: [], passages: [], stats: {} };
  if (raw.trim().length < 20) return { ok: false, error: 'Paste some text first', staged: [], passages: [], stats: {} };

  const db = createServiceClient();

  // --- clean + segment -------------------------------------------------
  const parsed = runPipeline(raw);
  if (!parsed.questions.length) {
    return {
      ok: false,
      error: `No questions could be parsed. ${parsed.rejected.length} block(s) were rejected — check the format.`,
      staged: [], passages: [], stats: parsed.stats as unknown as Record<string, unknown>,
    };
  }

  // --- dedupe against what is already stored ---------------------------
  // Chunked: Postgres has a practical ceiling on `in (...)` list size, and
  // a 5,000-question paste would otherwise build one enormous query.
  const hashes = parsed.questions.map((q) => q.contentHash);
  const existing = new Set<string>();
  for (let i = 0; i < hashes.length; i += 500) {
    const { data, error } = await db
      .from('questions')
      .select('content_hash')
      .in('content_hash', hashes.slice(i, i + 500));
    if (error) return { ok: false, error: `Dedupe lookup failed: ${error.message}`, staged: [], passages: [], stats: {} };
    for (const row of data ?? []) existing.add(row.content_hash as string);
  }

  const fresh = parsed.questions.filter((q) => !existing.has(q.contentHash));
  if (!fresh.length) {
    return {
      ok: false,
      error: `All ${parsed.questions.length} parsed questions already exist in the database.`,
      staged: [], passages: [], stats: parsed.stats as unknown as Record<string, unknown>,
    };
  }

  // --- create the batch row --------------------------------------------
  const { data: batch, error: batchErr } = await db
    .from('ingestion_batches')
    .insert({
      batch_title: title,
      source_metadata: { notes: sourceNotes, strategy: parsed.stats.strategy },
      status: 'processing',
      total_questions_parsed: parsed.stats.parsed,
      total_questions_duplicate: parsed.stats.duplicatesInBatch + existing.size,
      total_questions_processed: fresh.length,
    })
    .select('id')
    .single();

  if (batchErr || !batch) {
    return { ok: false, error: `Could not create batch: ${batchErr?.message}`, staged: [], passages: [], stats: {} };
  }

  // --- solve -----------------------------------------------------------
  try {
    const provider = createProvider();
    const inputs: SolveInput[] = fresh.map((q, i) => ({
      ref: `q${i}`,
      questionText: q.questionText,
      options: q.options,
      stimulus: q.passageRef !== undefined ? parsed.passages[q.passageRef]?.body : undefined,
    }));

    const report = await solveAll(provider, inputs, { chunkSize: 25, votes: 3 });

    const byRef = new Map(report.solved.map((s) => [s.ref, s]));
    const staged: StagedQuestion[] = fresh.flatMap((q, i) => {
      const s = byRef.get(`q${i}`);
      if (!s) return [];
      return [{
        ref: `q${i}`,
        questionText: q.questionText,
        options: q.options as Record<string, string>,
        correctOption: s.correctOption,
        explanationAr: s.explanationAr,
        category: s.category,
        consensusRatio: s.consensusRatio,
        confidence: s.confidence,
        needsHumanReview: s.needsHumanReview,
        reviewReasons: s.reviewReasons,
        contentHash: q.contentHash,
        passageIndex: q.passageRef,
        sourceLine: q.sourceLine,
      }];
    });

    await db.from('ingestion_batches').update({ status: 'review' }).eq('id', batch.id);

    return {
      ok: true,
      batchId: batch.id as string,
      staged,
      passages: parsed.passages,
      stats: { ...parsed.stats, ...report.stats, alreadyInDb: existing.size },
    };
  } catch (err) {
    // Mark the batch failed so it shows up in history instead of hanging
    // in 'processing' forever.
    await db.from('ingestion_batches')
      .update({ status: 'failed', error_message: err instanceof Error ? err.message : String(err) })
      .eq('id', batch.id);
    return {
      ok: false,
      error: `AI processing failed: ${err instanceof Error ? err.message : String(err)}`,
      batchId: batch.id as string, staged: [], passages: [], stats: {},
    };
  }
}

/** Stage 2: commit the reviewed questions. */
export async function approveBatch(
  batchId: string,
  questions: StagedQuestion[],
  passages: Array<{ title?: string; body: string; contentHash: string }>,
): Promise<{ ok: boolean; saved?: number; error?: string }> {
  if (!questions.length) return { ok: false, error: 'Nothing to save' };
  const db = createServiceClient();

  // Insert passages first so questions can reference them.
  const passageIds: string[] = [];
  for (const p of passages) {
    const { data, error } = await db
      .from('passages')
      .upsert({ batch_id: batchId, title: p.title, body: p.body, content_hash: p.contentHash },
        { onConflict: 'content_hash' })
      .select('id')
      .single();
    if (error) return { ok: false, error: `Passage insert failed: ${error.message}` };
    passageIds.push(data.id as string);
  }

  const rows = questions.map((q) => ({
    batch_id: batchId,
    passage_id: q.passageIndex !== undefined ? passageIds[q.passageIndex] ?? null : null,
    category: q.category,
    question_text: q.questionText,
    options: q.options,
    correct_option: q.correctOption,
    explanation: q.explanationAr,
    content_hash: q.contentHash,
    ai_confidence: q.confidence,
    consensus_ratio: q.consensusRatio,
    answer_source: q.consensusRatio === 1 ? 'llm_consensus' : 'llm_single',
    needs_human_review: q.needsHumanReview,
  }));

  // ignoreDuplicates: a concurrent batch may have inserted the same hash
  // between staging and approval. Skipping is correct; erroring would
  // discard the whole batch over one collision.
  const { data, error } = await db
    .from('questions')
    .upsert(rows, { onConflict: 'content_hash', ignoreDuplicates: true })
    .select('id');

  if (error) return { ok: false, error: error.message };

  const saved = data?.length ?? 0;
  await db.from('ingestion_batches')
    .update({ status: 'completed', total_questions_saved: saved, completed_at: new Date().toISOString() })
    .eq('id', batchId);

  revalidatePath('/admin/history');
  return { ok: true, saved };
}

/** Cascade delete — batch row plus every question and passage under it. */
export async function deleteBatch(batchId: string): Promise<{ ok: boolean; error?: string; deleted?: number; title?: string }> {
  const db = createServiceClient();

  const { data, error } = await db.rpc('delete_ingestion_batch', { p_batch_id: batchId });
  if (error) return { ok: false, error: error.message };

  const row = Array.isArray(data) ? data[0] : data;
  revalidatePath('/admin/history');
  return {
    ok: true,
    deleted: row?.deleted_questions ?? 0,
    title: row?.deleted_batch_title,
  };
}
