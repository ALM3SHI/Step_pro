'use server';

import { revalidatePath } from 'next/cache';
import * as repo from '@/lib/content/repository';
import { requireAdmin } from '@/lib/auth/admin';
import { validateDraft, type DraftQuestion } from '@/lib/content/validation';
import type { OptionKey } from '@/lib/content/schema';
import type { SectionId } from '@/lib/content/taxonomy';

/**
 * The only write path for content.
 *
 * Every action re-validates server-side even though the browser already
 * did: the client check is for fast feedback, this one is the rule. A
 * crafted request that skips the UI must not be able to insert a
 * question with no skill or no answer key.
 *
 * And every action — reads included — calls `requireAdmin()` FIRST. A
 * server action is a public HTTP endpoint: hiding `/admin` in middleware
 * stops someone browsing to the panel, but not from POSTing straight to
 * `deleteBatchAction`. This line is the actual lock on the bank.
 */

export interface ActionResult<T = void> {
  ok: boolean;
  error?: string;
  /** Non-blocking notes worth showing (missing explanation, long prompt). */
  warnings?: string[];
  data?: T;
}

function fail(error: string): ActionResult<never> {
  return { ok: false, error };
}

// ---------------------------------------------------------------------
// Batches
// ---------------------------------------------------------------------

export async function listBatchesAction(): Promise<ActionResult<repo.BatchSummary[]>> {
  try {
    await requireAdmin();
    return { ok: true, data: await repo.listBatches() };
  } catch (e) {
    return fail(msg(e));
  }
}

export async function createBatchAction(
  title: string,
  notes: string,
): Promise<ActionResult<{ id: string }>> {
  try {
    await requireAdmin();
    if (!title.trim()) return fail('عنوان التجميعة مطلوب');
    const id = await repo.createBatch(title, notes);
    revalidatePath('/admin');
    return { ok: true, data: { id } };
  } catch (e) {
    return fail(msg(e));
  }
}

export async function deleteBatchAction(batchId: string): Promise<ActionResult<{ questions: number }>> {
  try {
    await requireAdmin();
    const res = await repo.deleteBatch(batchId);
    revalidatePath('/admin');
    return { ok: true, data: { questions: res.questions } };
  } catch (e) {
    return fail(msg(e));
  }
}

// ---------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------

export async function listQuestionsAction(
  batchId: string,
): Promise<ActionResult<repo.EditableQuestion[]>> {
  try {
    await requireAdmin();
    return { ok: true, data: await repo.listQuestions(batchId) };
  } catch (e) {
    return fail(msg(e));
  }
}

export interface SaveQuestionInput extends DraftQuestion {
  batchId: string;
  /** Present when editing; absent when creating. */
  questionId?: string;
  /** Save despite an exact-duplicate match. Requires an explicit choice. */
  allowDuplicate?: boolean;
}

export async function saveQuestionAction(
  input: SaveQuestionInput,
): Promise<ActionResult<repo.EditableQuestion>> {
  try {
    await requireAdmin();

    const result = validateDraft(input);
    if (!result.canSave) {
      return { ok: false, error: result.errors.map((e) => e.message).join(' · ') };
    }

    // Duplicate detection needs the database, so it sits outside
    // validateDraft. Reported, never auto-resolved: silently dropping a
    // question the author just typed is worse than asking.
    if (!input.allowDuplicate) {
      const dupe = await repo.findDuplicate(input.text, input.options, input.questionId);
      if (dupe) {
        return fail(
          `سؤال مطابق موجود مسبقًا: «${dupe.text.slice(0, 60)}…». ` +
          'عدّل النص أو اختر «حفظ رغم التكرار».',
        );
      }
    }

    const saved = input.questionId
      ? await repo.updateQuestion(input.questionId, input)
      : await repo.createQuestion(input, input.batchId);

    revalidatePath(`/admin/batch/${input.batchId}`);
    return {
      ok: true,
      data: saved,
      warnings: result.warnings.map((w) => w.message),
    };
  } catch (e) {
    return fail(msg(e));
  }
}

export async function deleteQuestionAction(
  id: string,
  batchId: string,
): Promise<ActionResult> {
  try {
    await requireAdmin();
    await repo.deleteQuestion(id);
    revalidatePath(`/admin/batch/${batchId}`);
    return { ok: true };
  } catch (e) {
    return fail(msg(e));
  }
}

/**
 * Move one question past its neighbour.
 *
 * Deliberately takes the two ids, not the whole new order: a nudge is a
 * swap, and sending the full list made every click rewrite the entire
 * batch. There is also no `revalidatePath` here — the editor already
 * applied the swap optimistically, and re-rendering the route would ship
 * all 1,100 question cards back down the wire to redraw two rows.
 */
export async function swapQuestionOrderAction(
  idA: string,
  idB: string,
): Promise<ActionResult> {
  try {
    await requireAdmin();
    if (!idA || !idB || idA === idB) return fail('يلزم سؤالان مختلفان');
    await repo.swapQuestionOrder(idA, idB);
    return { ok: true };
  } catch (e) {
    return fail(msg(e));
  }
}

/** Repair a batch whose ordinals collide or were never assigned. */
export async function renumberBatchAction(
  batchId: string,
): Promise<ActionResult<{ written: number }>> {
  try {
    await requireAdmin();
    if (!batchId) return fail('التجميعة مطلوبة');
    const written = await repo.renumberBatchOrdinals(batchId);
    revalidatePath(`/admin/batch/${batchId}`);
    return { ok: true, data: { written } };
  } catch (e) {
    return fail(msg(e));
  }
}

export async function moveQuestionsAction(
  ids: string[],
  targetBatchId: string,
): Promise<ActionResult> {
  try {
    await requireAdmin();
    if (!ids.length) return fail('لم تُحدَّد أسئلة');
    await repo.moveQuestions(ids, targetBatchId);
    revalidatePath('/admin');
    return { ok: true };
  } catch (e) {
    return fail(msg(e));
  }
}

export async function setStatusAction(
  ids: string[],
  status: repo.ContentStatus,
  batchId: string,
): Promise<ActionResult> {
  try {
    await requireAdmin();
    if (!ids.length) return fail('لم تُحدَّد أسئلة');
    await repo.setStatus(ids, status);
    revalidatePath(`/admin/batch/${batchId}`);
    return { ok: true };
  } catch (e) {
    return fail(msg(e));
  }
}

// ---------------------------------------------------------------------
// Stimuli
// ---------------------------------------------------------------------

export async function listPassagesAction(): Promise<ActionResult<repo.PassageRef[]>> {
  try {
    await requireAdmin();
    return { ok: true, data: await repo.listPassages() };
  } catch (e) {
    return fail(msg(e));
  }
}

export async function createPassageAction(input: {
  title?: string;
  body: string;
  batchId: string;
}): Promise<ActionResult<repo.PassageRef>> {
  try {
    await requireAdmin();
    if (!input.body.trim()) return fail('نص القطعة مطلوب');
    return { ok: true, data: await repo.createPassage(input) };
  } catch (e) {
    return fail(msg(e));
  }
}

export async function listAudioClipsAction(): Promise<ActionResult<repo.AudioClipRef[]>> {
  try {
    await requireAdmin();
    return { ok: true, data: await repo.listAudioClips() };
  } catch (e) {
    return fail(msg(e));
  }
}

export async function createAudioClipAction(input: {
  audioKey: string;
  storagePath: string;
  batchId: string;
  durationMs?: number;
}): Promise<ActionResult<repo.AudioClipRef>> {
  try {
    await requireAdmin();
    return { ok: true, data: await repo.createAudioClip(input) };
  } catch (e) {
    return fail(msg(e));
  }
}

// ---------------------------------------------------------------------
// Bulk entry
// ---------------------------------------------------------------------

export interface BulkQuestionInput {
  section: SectionId;
  skillId: string;
  difficulty: string;
  status: string;
  text: string;
  options: Partial<Record<OptionKey, string>>;
  correctOption?: OptionKey | '';
  explanationAr?: string;
  tags?: string[];
  passageId?: string | null;
  audioClipId?: string | null;
}

export interface BulkResult {
  saved: number;
  skippedDuplicate: number;
  failed: Array<{ index: number; reason: string }>;
}

/**
 * Save many questions at once.
 *
 * The seam the Fast-Key flow, a bulk importer, and any future AI
 * pipeline write through. Partial success is the normal outcome: one bad
 * row must not discard the other ninety-nine, so failures are collected
 * and reported per index rather than thrown.
 */
export async function saveBulkAction(
  batchId: string,
  questions: BulkQuestionInput[],
): Promise<ActionResult<BulkResult>> {
  try {
    await requireAdmin();
  } catch (e) {
    return fail(msg(e));
  }

  if (!batchId) return fail('التجميعة مطلوبة');
  if (!questions.length) return fail('لا توجد أسئلة للحفظ');

  const out: BulkResult = { saved: 0, skippedDuplicate: 0, failed: [] };

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const validation = validateDraft(q);
    if (!validation.canSave) {
      out.failed.push({ index: i, reason: validation.errors.map((e) => e.message).join(' · ') });
      continue;
    }

    try {
      const dupe = await repo.findDuplicate(q.text, q.options);
      if (dupe) { out.skippedDuplicate++; continue; }

      await repo.createQuestion({ ...q, ordinal: i + 1 }, batchId);
      out.saved++;
    } catch (e) {
      out.failed.push({ index: i, reason: msg(e) });
    }
  }

  revalidatePath(`/admin/batch/${batchId}`);
  return { ok: true, data: out };
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
