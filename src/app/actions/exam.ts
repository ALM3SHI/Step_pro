'use server';

import { BundleContentProvider } from '@/lib/content/bundleProvider';
import { FULL_STEP_BLUEPRINT, practiceBlueprint } from '@/lib/content/blueprint';
import { buildExam, poolSummary, type BuiltExam } from '@/lib/exam/buildExam';
import type { SectionId } from '@/lib/content/taxonomy';

/**
 * Content source for the runtime exam.
 *
 * The bundle provider is used today so the simulator works with no
 * database dependency. Swapping in a Supabase provider is a one-line
 * change here — nothing above this function knows the difference.
 */
const provider = new BundleContentProvider();

export interface StartExamResult {
  ok: boolean;
  error?: string;
  exam?: BuiltExam;
  /** Sections that could not be filled to blueprint. Shown before starting. */
  shortfalls?: BuiltExam['shortfalls'];
}

export async function startFullExam(seed?: number): Promise<StartExamResult> {
  try {
    const snapshot = await provider.load();
    const exam = buildExam(FULL_STEP_BLUEPRINT, snapshot, {
      // A time-derived seed gives a different paper each sitting while
      // staying reproducible from the value stored on the attempt.
      seed: seed ?? Math.floor(Date.now() / 1000),
    });

    if (!exam.totalQuestions) {
      return { ok: false, error: 'لا توجد أسئلة منشورة لبناء الاختبار.' };
    }
    return { ok: true, exam, shortfalls: exam.shortfalls };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function startPractice(
  section: SectionId,
  questionCount = 10,
  seed?: number,
): Promise<StartExamResult> {
  try {
    const snapshot = await provider.load();
    const exam = buildExam(practiceBlueprint(section, questionCount), snapshot, {
      seed: seed ?? Math.floor(Date.now() / 1000),
    });

    if (!exam.totalQuestions) {
      return { ok: false, error: 'لا توجد أسئلة منشورة في هذا القسم بعد.' };
    }
    return { ok: true, exam, shortfalls: exam.shortfalls };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Availability per section, for the start screen. */
export async function getPoolSummary(): Promise<Record<string, number>> {
  const snapshot = await provider.load();
  return poolSummary(snapshot);
}
