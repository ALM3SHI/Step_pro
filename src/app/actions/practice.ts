'use server';

import { getContentProvider } from '@/lib/content/activeProvider';
import { targetedPracticeBlueprint } from '@/lib/content/blueprint';
import { selectPool } from '@/lib/content/provider';
import { buildExam, type BuiltExam } from '@/lib/exam/buildExam';
import { SECTIONS, SKILL_BY_ID, type Difficulty, type SectionId } from '@/lib/content/taxonomy';
import { getProgressOverview } from './analytics';

/**
 * Targeted practice.
 *
 * Kept apart from `exam.ts` on purpose: the exam actions build a graded
 * STEP simulation and must stay boring. Practice narrows the pool by
 * skill and difficulty, which the simulation must never do.
 */

const provider = () => getContentProvider();

/** Below this, a skill's accuracy is noise and must not drive a drill. */
const RELIABLE_SAMPLE = 4;

export interface PracticeResult {
  ok: boolean;
  error?: string;
  exam?: BuiltExam;
  /** Skills the session actually drew from, for the header. */
  skillIds?: string[];
  /** Asked for more than the bank holds. Shown before starting. */
  shortfall?: { wanted: number; got: number };
}

// ---------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------

export interface SkillAvailability {
  skillId: string;
  nameAr: string;
  section: SectionId;
  /** Published questions, before any difficulty filter. */
  total: number;
  byDifficulty: Record<Difficulty, number>;
}

/**
 * What the bank can actually serve, per skill.
 *
 * The picker needs this before the learner commits: offering "20
 * questions on تحليل الحجج" when four exist wastes their time and reads
 * as a broken product rather than an empty shelf.
 */
export async function getSkillAvailability(): Promise<{
  ok: boolean;
  error?: string;
  skills?: SkillAvailability[];
  bySection?: Record<string, number>;
}> {
  try {
    const snapshot = await provider().load();
    const skills = new Map<string, SkillAvailability>();
    const bySection: Record<string, number> = {};

    for (const section of SECTIONS) {
      const pool = selectPool(snapshot, { section });
      bySection[section] = pool.length;

      for (const q of pool) {
        const def = SKILL_BY_ID[q.skillId];
        if (!def) continue;

        let entry = skills.get(q.skillId);
        if (!entry) {
          entry = {
            skillId: q.skillId,
            nameAr: def.nameAr,
            section,
            total: 0,
            byDifficulty: { easy: 0, medium: 0, hard: 0 },
          };
          skills.set(q.skillId, entry);
        }
        entry.total++;
        entry.byDifficulty[q.difficulty]++;
      }
    }

    return { ok: true, skills: [...skills.values()], bySection };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------
// Building a session
// ---------------------------------------------------------------------

export interface TargetedPracticeConfig {
  sections: Array<{ section: SectionId; questionCount: number; skillIds?: string[] }>;
  difficulties?: Difficulty[];
  nameAr?: string;
}

export async function startTargetedPractice(
  config: TargetedPracticeConfig,
  seed?: number,
): Promise<PracticeResult> {
  try {
    const wanted = config.sections.reduce((n, s) => n + s.questionCount, 0);
    if (!wanted) return { ok: false, error: 'اختر عدد الأسئلة أولًا.' };

    const snapshot = await provider().load();
    const exam = buildExam(
      targetedPracticeBlueprint({
        sections: config.sections,
        difficulties: config.difficulties,
        nameAr: config.nameAr,
      }),
      snapshot,
      { seed: seed ?? Math.floor(Date.now() / 1000) },
    );

    if (!exam.totalQuestions) {
      return {
        ok: false,
        error: 'لا توجد أسئلة منشورة تطابق هذا الاختيار. جرّب صعوبة أخرى أو مهارات أوسع.',
      };
    }

    const skillIds = [
      ...new Set(Object.values(exam.questions).map((q) => q.skillId).filter(Boolean)),
    ];

    return {
      ok: true,
      exam,
      skillIds,
      // Report rather than silently shipping a short drill — the learner
      // asked for 20 and is getting 9.
      shortfall:
        exam.totalQuestions < wanted
          ? { wanted, got: exam.totalQuestions }
          : undefined,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------
// Smart practice
// ---------------------------------------------------------------------

export interface WeakSkillPick {
  skillId: string;
  nameAr: string;
  section: SectionId;
  accuracyPct: number;
  attempted: number;
}

/**
 * The skills a drill should target, weakest first.
 *
 * Two exclusions carry the weight here. A skill with fewer than four
 * recorded attempts is dropped — 0/1 is not a weakness, and sending
 * someone to study on that evidence wastes the session. And a skill the
 * bank cannot serve is dropped even if it is genuinely weak, because a
 * drill that builds zero questions is worse than one that says why.
 */
export async function getWeakestSkills(limit = 5): Promise<{
  ok: boolean;
  error?: string;
  skills?: WeakSkillPick[];
  /** Why the list is short or empty, for the UI to explain. */
  reason?: string;
}> {
  const progress = await getProgressOverview();
  if (!progress.ok || !progress.data) {
    return { ok: false, error: progress.error ?? 'تعذّر قراءة سجل التقدّم' };
  }

  const availability = await getSkillAvailability();
  const servable = new Map(
    (availability.skills ?? []).map((s) => [s.skillId, s.total]),
  );

  const reliable = progress.data.skills.filter((s) => s.attempted >= RELIABLE_SAMPLE);
  if (!reliable.length) {
    return {
      ok: true,
      skills: [],
      reason: progress.data.skills.length
        ? `لا توجد مهارة بعدد محاولات كافٍ (${RELIABLE_SAMPLE} على الأقل) لتحديد ضعفك بثقة.`
        : 'لم تُكمل أي اختبار بعد، فلا توجد بيانات لاختيار مهاراتك الأضعف.',
    };
  }

  const picks = reliable
    .filter((s) => (servable.get(s.skillId) ?? 0) > 0)
    .sort((a, b) => a.accuracyPct - b.accuracyPct)
    .slice(0, limit)
    .map((s) => ({
      skillId: s.skillId,
      nameAr: s.nameAr,
      section: s.section,
      accuracyPct: s.accuracyPct,
      attempted: s.attempted,
    }));

  return {
    ok: true,
    skills: picks,
    reason: picks.length
      ? undefined
      : 'مهاراتك الأضعف لا توجد لها أسئلة منشورة في البنك بعد.',
  };
}

/** Build a drill straight from the weakest-skill picks. */
export async function startWeakestSkillPractice(
  questionCount = 10,
  seed?: number,
): Promise<PracticeResult & { targeted?: WeakSkillPick[] }> {
  const weak = await getWeakestSkills();
  if (!weak.ok) return { ok: false, error: weak.error };
  if (!weak.skills?.length) return { ok: false, error: weak.reason };

  // Spread the count across the weak skills' sections, so a learner weak
  // in both grammar and reading drills both rather than only the worst.
  const bySection = new Map<SectionId, string[]>();
  for (const s of weak.skills) {
    bySection.set(s.section, [...(bySection.get(s.section) ?? []), s.skillId]);
  }

  const sections = [...bySection.entries()];
  const per = Math.floor(questionCount / sections.length);
  const extra = questionCount % sections.length;

  const result = await startTargetedPractice(
    {
      sections: sections.map(([section, skillIds], i) => ({
        section,
        skillIds,
        questionCount: per + (i < extra ? 1 : 0),
      })),
      nameAr: 'تدريب: أضعف مهاراتي',
    },
    seed,
  );

  return { ...result, targeted: weak.skills };
}

// ---------------------------------------------------------------------
// Post-session comparison
// ---------------------------------------------------------------------

export interface SkillProgressRow {
  skillId: string;
  nameAr: string;
  /** Accuracy across every earlier recorded attempt on this skill. */
  priorAccuracyPct: number | null;
  priorAttempted: number;
}

/**
 * Each targeted skill's standing BEFORE this session.
 *
 * Read before the session is submitted, so the comparison afterwards is
 * against history rather than against a number this very drill moved.
 */
export async function getSkillBaseline(skillIds: string[]): Promise<{
  ok: boolean;
  error?: string;
  rows?: SkillProgressRow[];
}> {
  if (!skillIds.length) return { ok: true, rows: [] };

  const progress = await getProgressOverview();
  if (!progress.ok || !progress.data) {
    // No history is not an error here — a first-ever drill has no
    // baseline, and the UI simply omits the comparison.
    return { ok: true, rows: skillIds.map((id) => ({
      skillId: id,
      nameAr: SKILL_BY_ID[id]?.nameAr ?? id,
      priorAccuracyPct: null,
      priorAttempted: 0,
    })) };
  }

  const byId = new Map(progress.data.skills.map((s) => [s.skillId, s]));

  return {
    ok: true,
    rows: skillIds.map((id) => {
      const prior = byId.get(id);
      return {
        skillId: id,
        nameAr: SKILL_BY_ID[id]?.nameAr ?? id,
        priorAccuracyPct: prior ? prior.accuracyPct : null,
        priorAttempted: prior?.attempted ?? 0,
      };
    }),
  };
}
