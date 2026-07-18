'use server';

import { createServiceClient } from '@/lib/supabase/server';
import type { ExamPart, ExamState, OptionKey } from '@/lib/exam/types';

export interface AttemptBlueprint {
  parts: Array<Pick<ExamPart, 'index' | 'section' | 'labelEn' | 'partNo' | 'screens' | 'questionIds' | 'durationSeconds'>>;
  questionIds: string[];
  totalMinutes: number;
}

export interface StartAttemptResult {
  ok: boolean;
  attemptId?: string;
  error?: string;
}

/**
 * Open an attempt.
 *
 * The blueprint is frozen here rather than rebuilt on resume: the
 * question pool grows as new batches are ingested, so re-deriving parts
 * later would silently reshuffle a half-finished exam.
 */
export async function startAttempt(
  blueprint: AttemptBlueprint,
  userId?: string,
): Promise<StartAttemptResult> {
  if (!blueprint.parts.length) return { ok: false, error: 'Blueprint has no parts' };

  const db = createServiceClient();
  const { data, error } = await db
    .from('exam_attempts')
    .insert({
      user_id: userId ?? null,
      status: 'in_progress',
      blueprint,
      total_questions: blueprint.questionIds.length,
      current_part: 0,
      max_part_index: 0,
      revision: 0,
    })
    .select('id')
    .single();

  if (error || !data) return { ok: false, error: error?.message ?? 'insert failed' };
  return { ok: true, attemptId: data.id as string };
}

export interface SyncPayload {
  attemptId: string;
  revision: number;
  answers: Record<string, OptionKey>;
  flags: string[];
  currentPart: number;
  screenIndex: number;
  phase: string;
  partTimings: ExamState['partTimings'];
  lockedScreens: Record<string, true>;
}

/**
 * Persist progress. Fire-and-forget from the client's perspective.
 *
 * `applied: false` is a normal outcome, not an error — it means a newer
 * revision already landed. The caller must not retry or surface it.
 */
export async function syncAttempt(
  payload: SyncPayload,
): Promise<{ ok: boolean; applied: boolean; storedRevision?: number; error?: string }> {
  const db = createServiceClient();

  const { data, error } = await db.rpc('sync_exam_attempt', {
    p_attempt_id: payload.attemptId,
    p_revision: payload.revision,
    p_answers: payload.answers,
    p_flags: payload.flags,
    p_current_part: payload.currentPart,
    p_screen_index: payload.screenIndex,
    p_phase: payload.phase,
    p_part_timings: payload.partTimings,
    p_locked_screens: payload.lockedScreens,
  });

  if (error) return { ok: false, applied: false, error: error.message };

  const row = Array.isArray(data) ? data[0] : data;
  return { ok: true, applied: Boolean(row?.applied), storedRevision: row?.stored_revision };
}

export interface SubmitResult {
  ok: boolean;
  correct?: number;
  total?: number;
  weighted?: number;
  error?: string;
}

/**
 * Final submission.
 *
 * Scoring happens in SQL against the stored answer keys. The client also
 * computes a score for instant display, but that one is advisory — a
 * score the browser reports is a score the browser can choose.
 */
export async function submitAttempt(
  attemptId: string,
  answers: Record<string, OptionKey>,
): Promise<SubmitResult> {
  const db = createServiceClient();

  const { data, error } = await db.rpc('submit_exam_attempt', {
    p_attempt_id: attemptId,
    p_answers: answers,
  });

  if (error) return { ok: false, error: error.message };

  const row = Array.isArray(data) ? data[0] : data;
  return {
    ok: true,
    correct: row?.correct ?? 0,
    total: row?.total ?? 0,
    weighted: Number(row?.weighted ?? 0),
  };
}

/** Load a previous attempt for the results screen. */
export async function loadAttempt(attemptId: string) {
  const db = createServiceClient();
  const { data, error } = await db
    .from('exam_attempts')
    .select('*')
    .eq('id', attemptId)
    .single();

  if (error) return { ok: false as const, error: error.message };
  return { ok: true as const, attempt: data };
}
