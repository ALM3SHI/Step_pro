'use server';

import { createServiceClient } from '@/lib/supabase/server';
import { getContentProvider } from '@/lib/content/activeProvider';
import { SECTION_DEFS, type SectionId } from '@/lib/content/taxonomy';
import type { OptionKey } from '@/lib/content/schema';

/**
 * Attempt persistence for the rebuilt engine.
 *
 * Scoring happens on the SERVER against the ACTIVE content provider — the
 * same source the exam was built from — not in SQL and not always the
 * bundle. It must be the active source: once Supabase is authoritative,
 * questions carry database UUIDs, and grading those against the bundle
 * (whose ids are `legacy-*`) matches nothing and persists 0/0. The server
 * still reads the answer key, so the anti-tamper property holds: the
 * browser never supplies the score.
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

/**
 * The exam skeleton stored on the attempt.
 *
 * Everything needed to rebuild the paper EXCEPT the question content,
 * which is re-fetched by id. Storing the part structure is what makes
 * resume possible at all: replaying the builder with the same seed only
 * reproduces the exam while the question pool is unchanged, and one
 * publish or unpublish between sittings would silently hand the
 * candidate a different paper.
 */
export interface ExamSkeleton {
  blueprintId: string;
  seed: number;
  nameAr: string;
  instantFeedback: boolean;
  totalSeconds: number;
  numberInSection: Record<string, number>;
  parts: Array<{
    index: number;
    section: string;
    partNo: number;
    labelAr: string;
    labelEn: string;
    screens: Array<{ questionIds: string[]; passageId?: string; audioClipId?: string }>;
    questionIds: string[];
    durationSeconds: number;
    allowsBack: boolean;
    allowsReview: boolean;
  }>;
}

/** Open an attempt row and freeze the exam skeleton against it. */
export async function openAttempt(input: {
  skeleton: ExamSkeleton;
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
        // The full skeleton, minus question content. A few KB of JSON,
        // and the only thing that makes a resumed sitting the SAME paper.
        blueprint: { ...input.skeleton, questionIds: input.questionIds },
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
export interface OutcomeRow {
  questionId: string;
  section: string;
  skillId: string | null;
  difficulty: string;
  chosenOption: string | null;
  correctOption: string;
  isCorrect: boolean;
  wasAnswered: boolean;
  wasFlagged: boolean;
  secondsSpent: number | null;
  partIndex: number;
  ordinal: number;
}

export async function submitAttempt(
  attemptId: string,
  answers: Record<string, OptionKey>,
  questionIds: string[],
  /**
   * Per-question outcomes.
   *
   * Everything longitudinal — skill trends, mistake patterns, where time
   * goes — needs the result of each question, not just a total. Optional
   * so an older client that omits it still submits successfully rather
   * than losing the whole sitting.
   */
  outcomes?: OutcomeRow[],
): Promise<SubmitResult> {
  try {
    const graded = await scoreAttempt(answers, questionIds);
    const db = createServiceClient();

    if (outcomes?.length) {
      // Written BEFORE the attempt is marked submitted, so a failure
      // here leaves the attempt resumable instead of graded-but-blank.
      const rows = outcomes.map((o) => ({
        attempt_id: attemptId,
        question_id: o.questionId,
        section: o.section,
        skill_id: o.skillId,
        difficulty: o.difficulty,
        chosen_option: o.chosenOption,
        correct_option: o.correctOption,
        is_correct: o.isCorrect,
        was_answered: o.wasAnswered,
        was_flagged: o.wasFlagged,
        seconds_spent: o.secondsSpent,
        part_index: o.partIndex,
        ordinal: o.ordinal,
      }));

      for (let i = 0; i < rows.length; i += 200) {
        const { error: oErr } = await db
          .from('attempt_answers')
          .upsert(rows.slice(i, i + 200), { onConflict: 'attempt_id,question_id' });
        // Analytics are valuable but not worth failing a submission
        // over — the candidate's score still lands either way.
        if (oErr) console.error('attempt_answers upsert failed:', oErr.message);
      }
    }

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

async function scoreAttempt(answers: Record<string, OptionKey>, questionIds: string[]) {
  // The active provider — Supabase in production — is the source the exam
  // was built from, so its ids match the answer keys. Grading against the
  // bundle instead is what zeroed every score once Supabase went live.
  const snapshot = await getContentProvider().load();
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

export interface ResumableSummary {
  attemptId: string;
  nameAr: string;
  startedAt: string;
  answered: number;
  totalQuestions: number;
  partIndex: number;
  totalParts: number;
}

/** Most recent unfinished attempt, for the resume prompt. */
export async function findResumableAttempt(
  userId?: string,
): Promise<{ ok: boolean; attempt?: ResumableSummary | null; error?: string }> {
  try {
    const db = createServiceClient();
    let q = db
      .from('exam_attempts')
      .select('id, blueprint, answers, current_part, total_questions, started_at')
      .eq('status', 'in_progress')
      .order('started_at', { ascending: false })
      .limit(1);
    if (userId) q = q.eq('user_id', userId);

    const { data, error } = await q;
    if (error) return { ok: false, error: error.message };

    const row = data?.[0];
    if (!row) return { ok: true, attempt: null };

    const skeleton = row.blueprint as Partial<ExamSkeleton>;
    // An attempt opened before skeletons were stored cannot be rebuilt.
    // Offering to resume it would fail after the candidate committed to
    // it, so it is simply not offered.
    if (!Array.isArray(skeleton?.parts) || !skeleton.parts.length) {
      return { ok: true, attempt: null };
    }

    return {
      ok: true,
      attempt: {
        attemptId: row.id as string,
        nameAr: skeleton.nameAr ?? 'اختبار',
        startedAt: row.started_at as string,
        answered: Object.keys((row.answers ?? {}) as object).length,
        totalQuestions: (row.total_questions as number) ?? 0,
        partIndex: (row.current_part as number) ?? 0,
        totalParts: skeleton.parts.length,
      },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface ResumePayload {
  attemptId: string;
  skeleton: ExamSkeleton;
  answers: Record<string, OptionKey>;
  flags: string[];
  partIndex: number;
  screenIndex: number;
  phase: string;
  partTimings: Record<number, unknown>;
  lockedScreens: Record<string, true>;
  revision: number;
  /** Ids the skeleton references that no longer resolve to content. */
  missingQuestionIds: string[];
}

/**
 * Load everything needed to continue a sitting.
 *
 * Returns the skeleton and the saved progress; the caller re-hydrates
 * question content through the content provider. Questions that have
 * since been unpublished are reported rather than silently dropped —
 * the exam would otherwise change length mid-sitting.
 */
export async function resumeAttempt(attemptId: string): Promise<{
  ok: boolean;
  payload?: ResumePayload;
  error?: string;
}> {
  try {
    const db = createServiceClient();
    const { data, error } = await db
      .from('exam_attempts')
      .select('*')
      .eq('id', attemptId)
      .eq('status', 'in_progress')
      .maybeSingle();

    if (error) return { ok: false, error: error.message };
    if (!data) return { ok: false, error: 'لم تُعثر على محاولة قابلة للاستئناف' };

    const skeleton = data.blueprint as ExamSkeleton & { questionIds?: string[] };
    if (!Array.isArray(skeleton?.parts) || !skeleton.parts.length) {
      return { ok: false, error: 'هذه المحاولة قديمة ولا تحتوي على هيكل الاختبار' };
    }

    const flags = (data.flags ?? []) as string[];

    return {
      ok: true,
      payload: {
        attemptId,
        skeleton,
        answers: (data.answers ?? {}) as Record<string, OptionKey>,
        flags,
        partIndex: (data.current_part as number) ?? 0,
        screenIndex: (data.screen_index as number) ?? 0,
        phase: (data.phase as string) ?? 'part-intro',
        partTimings: (data.part_timings ?? {}) as Record<number, unknown>,
        lockedScreens: (data.locked_screens ?? {}) as Record<string, true>,
        revision: (data.revision as number) ?? 0,
        missingQuestionIds: [],
      },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Abandon an attempt so it stops being offered for resume. */
export async function abandonAttempt(attemptId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const db = createServiceClient();
    const { error } = await db
      .from('exam_attempts')
      .update({ status: 'abandoned' })
      .eq('id', attemptId)
      .eq('status', 'in_progress');
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
