'use server';

import { createServiceClient } from '@/lib/supabase/server';
import { loadBundleSnapshot } from '@/lib/content/bundleProvider';
import { SECTION_DEFS, type SectionId } from '@/lib/content/taxonomy';
import type { OptionKey } from '@/lib/content/schema';

/**
 * Attempt persistence for the rebuilt engine.
 *
 * Scoring happens on the SERVER against the content bundle, not in SQL
 * against the `questions` table. That table is empty until the seed runs,
 * so the SQL path would silently grade every attempt 0/0. Grading from
 * the bundle keeps the anti-tamper property that matters — the browser
 * never supplies the score — while working today.
 *
 * When the seed lands, `scoreAgainstBundle` can be swapped for the SQL
 * function without touching the client.
 */

export interface AttemptSnapshot {
  attemptId: string;
  revision: number;
  answers: Record<string, OptionKey>;
  flags: string[];
  partIndex: number;
  screenIndex: number;
  phase: string;
  partTimings: Record<number, unknown>;
  lockedScreens: Record<string, true>;
}

export interface OpenAttemptResult {
  ok: boolean;
  attemptId?: string;
  error?: string;
}

/** Open an attempt row and freeze the exam blueprint against it. */
export async function openAttempt(input: {
  blueprintId: string;
  seed: number;
  questionIds: string[];
  totalQuestions: number;
  userId?: string;
}): Promise<OpenAttemptResult> {
  if (!input.questionIds.length) return { ok: false, error: 'Exam has no questions' };

  try {
    const db = createServiceClient();
    const { data, error } = await db
      .from('exam_attempts')
      .insert({
        user_id: input.userId ?? null,
        status: 'in_progress',
        // Store the seed and ids, not the whole exam: the exam is
        // reproducible from (blueprintId, seed) plus the bundle version,
        // and a full BuiltExam would bloat every row.
        blueprint: {
          blueprintId: input.blueprintId,
          seed: input.seed,
          questionIds: input.questionIds,
        },
        total_questions: input.totalQuestions,
        current_part: 0,
        max_part_index: 0,
        revision: 0,
        phase: 'briefing',
      })
      .select('id')
      .single();

    if (error || !data) return { ok: false, error: error?.message ?? 'insert failed' };
    return { ok: true, attemptId: data.id as string };
  } catch (err) {
    // Persistence is best-effort: a Supabase outage must not stop
    // someone sitting an exam. The runner falls back to local-only.
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Persist progress.
 *
 * `applied: false` is normal, not an error — it means a newer revision
 * already landed and this payload lost the race. The caller must not
 * retry or surface it.
 */
export async function saveAttempt(
  snap: AttemptSnapshot,
): Promise<{ ok: boolean; applied: boolean; storedRevision?: number; error?: string }> {
  try {
    const db = createServiceClient();
    const { data, error } = await db.rpc('sync_exam_attempt', {
      p_attempt_id: snap.attemptId,
      p_revision: snap.revision,
      p_answers: snap.answers,
      p_flags: snap.flags,
      p_current_part: snap.partIndex,
      p_screen_index: snap.screenIndex,
      p_phase: snap.phase,
      p_part_timings: snap.partTimings,
      p_locked_screens: snap.lockedScreens,
    });

    if (error) return { ok: false, applied: false, error: error.message };
    const row = Array.isArray(data) ? data[0] : data;
    return { ok: true, applied: Boolean(row?.applied), storedRevision: row?.stored_revision };
  } catch (err) {
    return { ok: false, applied: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface SubmitResult {
  ok: boolean;
  error?: string;
  correct?: number;
  total?: number;
  weightedPct?: number;
}

/**
 * Grade and close the attempt.
 *
 * Reads the answer keys from the bundle on the server. A score the
 * browser reports is a score the browser can choose.
 */
export async function submitAttempt(
  attemptId: string,
  answers: Record<string, OptionKey>,
  questionIds: string[],
): Promise<SubmitResult> {
  try {
    const graded = scoreAgainstBundle(answers, questionIds);
    const db = createServiceClient();

    const { error } = await db
      .from('exam_attempts')
      .update({
        status: 'submitted',
        answers,
        correct_count: graded.correct,
        total_questions: graded.total,
        weighted_score: Number(graded.weightedPct.toFixed(2)),
        submitted_at: new Date().toISOString(),
      })
      .eq('id', attemptId)
      // Never re-grade a submitted paper: a stale tab must not reopen it.
      .eq('status', 'in_progress');

    if (error) return { ok: false, error: error.message };
    return { ok: true, ...graded };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function scoreAgainstBundle(answers: Record<string, OptionKey>, questionIds: string[]) {
  const snapshot = loadBundleSnapshot();
  const byId = new Map(snapshot.questions.map((q) => [q.id, q]));

  const bySection = new Map<SectionId, { correct: number; total: number }>();
  let correct = 0;
  let total = 0;

  for (const id of questionIds) {
    const q = byId.get(id);
    if (!q) continue;
    total++;

    const acc = bySection.get(q.section) ?? { correct: 0, total: 0 };
    acc.total++;
    // Unanswered counts as wrong: STEP has no penalty-free omission.
    if (answers[id] && answers[id] === q.correctOption) {
      correct++;
      acc.correct++;
    }
    bySection.set(q.section, acc);
  }

  let weightedSum = 0;
  let weightTotal = 0;
  for (const [section, v] of bySection) {
    const weight = SECTION_DEFS[section].weightPct;
    weightedSum += (v.total ? (v.correct / v.total) * 100 : 0) * weight;
    weightTotal += weight;
  }

  return {
    correct,
    total,
    weightedPct: weightTotal ? weightedSum / weightTotal : 0,
  };
}

/** Load a stored attempt, for resume or a results re-view. */
export async function loadAttempt(attemptId: string) {
  try {
    const db = createServiceClient();
    const { data, error } = await db
      .from('exam_attempts')
      .select('*')
      .eq('id', attemptId)
      .single();
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const, attempt: data };
  } catch (err) {
    return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Most recent unfinished attempt, for a "resume" prompt. */
export async function findResumableAttempt(userId?: string) {
  try {
    const db = createServiceClient();
    let q = db
      .from('exam_attempts')
      .select('id, blueprint, current_part, revision, started_at')
      .eq('status', 'in_progress')
      .order('started_at', { ascending: false })
      .limit(1);
    if (userId) q = q.eq('user_id', userId);

    const { data, error } = await q;
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const, attempt: data?.[0] ?? null };
  } catch (err) {
    return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
  }
}
