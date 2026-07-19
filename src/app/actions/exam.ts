'use server';

import { getContentProvider } from '@/lib/content/activeProvider';
import { FULL_STEP_BLUEPRINT, practiceBlueprint } from '@/lib/content/blueprint';
import { buildExam, poolSummary, type BuiltExam } from '@/lib/exam/buildExam';
import type { SectionId } from '@/lib/content/taxonomy';
import type { ExamSkeleton } from './attempts';

/**
 * Content source is resolved centrally: Supabase when configured, the
 * built bundle otherwise. Nothing in this file knows which is live.
 */
const provider = () => getContentProvider();

export interface StartExamResult {
  ok: boolean;
  error?: string;
  exam?: BuiltExam;
  /** Sections that could not be filled to blueprint. Shown before starting. */
  shortfalls?: BuiltExam['shortfalls'];
}

export async function startFullExam(seed?: number): Promise<StartExamResult> {
  try {
    const snapshot = await provider().load();
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
    const snapshot = await provider().load();
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
  const snapshot = await provider().load();
  return poolSummary(snapshot);
}

/**
 * Rebuild a paper from a stored skeleton.
 *
 * Content is re-fetched by id rather than replayed through the builder:
 * the builder samples the live pool, so a single publish or unpublish
 * between sittings would hand the candidate a different exam on resume.
 *
 * A question that has since been unpublished is dropped from its screen
 * and reported. Leaving a dangling id would render a blank card the
 * candidate cannot answer but the scorer still counts.
 */
export async function rehydrateExam(skeleton: ExamSkeleton): Promise<{
  ok: boolean;
  exam?: BuiltExam;
  missing?: string[];
  error?: string;
}> {
  try {
    const snapshot = await provider().load();
    const byId = new Map(snapshot.questions.map((q) => [q.id, q]));

    const questions: BuiltExam['questions'] = {};
    const passages: BuiltExam['passages'] = {};
    const audioUrls: BuiltExam['audioUrls'] = {};
    const missing: string[] = [];

    const parts: BuiltExam['parts'] = skeleton.parts.map((p) => {
      const screens = p.screens
        .map((s) => {
          const ids = s.questionIds.filter((id) => {
            const q = byId.get(id);
            if (!q) { missing.push(id); return false; }
            questions[id] = q;
            return true;
          });

          if (s.passageId) {
            const passage = snapshot.passages.get(s.passageId);
            if (passage) passages[s.passageId] = passage;
          }
          if (s.audioClipId) {
            const clip = snapshot.audioClips.get(s.audioClipId);
            if (clip) audioUrls[s.audioClipId] = `/listening/${clip.storagePath}`;
          }

          return { questionIds: ids, passageId: s.passageId, audioClipId: s.audioClipId };
        })
        // A screen whose every question vanished would render empty.
        .filter((s) => s.questionIds.length > 0);

      return {
        index: p.index,
        section: p.section as BuiltExam['parts'][number]['section'],
        partNo: p.partNo,
        labelAr: p.labelAr,
        labelEn: p.labelEn,
        screens,
        questionIds: screens.flatMap((s) => s.questionIds),
        durationSeconds: p.durationSeconds,
        allowsBack: p.allowsBack,
        allowsReview: p.allowsReview,
      };
    }).filter((p) => p.questionIds.length > 0);

    if (!parts.length) {
      return { ok: false, error: 'لم يعد أي سؤال من هذا الاختبار متاحًا' };
    }

    const exam: BuiltExam = {
      blueprintId: skeleton.blueprintId,
      nameAr: skeleton.nameAr,
      instantFeedback: skeleton.instantFeedback,
      parts,
      questions,
      passages,
      audioUrls,
      numberInSection: skeleton.numberInSection,
      totalQuestions: parts.reduce((n, p) => n + p.questionIds.length, 0),
      totalSeconds: skeleton.totalSeconds,
      seed: skeleton.seed,
      shortfalls: [],
    };

    return { ok: true, exam, missing };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
