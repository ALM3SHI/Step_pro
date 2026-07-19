/**
 * Pattern detection over an attempt.
 *
 * The rule this file exists to enforce: an insight is only emitted when
 * the data actually supports it. Every detector carries a minimum sample
 * size and a minimum effect size, and says nothing when either is
 * unmet — a dashboard that invents "you rush in Grammar" from three
 * questions is worse than one that stays quiet, because the learner acts
 * on it.
 *
 * Nothing here is AI. These are arithmetic rules over measured values,
 * and each one names the evidence it is based on so the learner can
 * judge it.
 */

import { SECTION_DEFS, SKILL_BY_ID, type SectionId } from '../content/taxonomy';
import type { QuestionOutcome } from './scoring';

export type InsightKind = 'strength' | 'weakness' | 'pace' | 'behaviour';

export interface Insight {
  kind: InsightKind;
  /** One sentence, in Arabic, stating what was observed. */
  text: string;
  /** The numbers behind it, so the claim is checkable. */
  evidence: string;
  /** Higher shows first. */
  weight: number;
}

/** Below these, a pattern is noise. */
const MIN_SKILL_SAMPLE = 4;
const MIN_SECTION_SAMPLE = 6;
const MIN_TIMED_SAMPLE = 5;

function pct(correct: number, total: number): number {
  return total ? (correct / total) * 100 : 0;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function deriveInsights(outcomes: QuestionOutcome[]): Insight[] {
  const insights: Insight[] = [];
  if (outcomes.length < MIN_SECTION_SAMPLE) return insights;

  const overallAccuracy = pct(outcomes.filter((o) => o.isCorrect).length, outcomes.length);

  // --- per skill --------------------------------------------------------
  const bySkill = new Map<string, QuestionOutcome[]>();
  for (const o of outcomes) {
    if (!o.skillId) continue;
    bySkill.set(o.skillId, [...(bySkill.get(o.skillId) ?? []), o]);
  }

  for (const [skillId, items] of bySkill) {
    if (items.length < MIN_SKILL_SAMPLE) continue;
    const acc = pct(items.filter((o) => o.isCorrect).length, items.length);
    const name = SKILL_BY_ID[skillId]?.nameAr ?? skillId;

    // Only call it a weakness if it is clearly below the candidate's own
    // average — otherwise it is just where they are, not a gap.
    if (acc <= 40 && acc < overallAccuracy - 15) {
      insights.push({
        kind: 'weakness',
        text: `أخطاؤك تتركّز في مهارة «${name}».`,
        evidence: `${items.filter((o) => o.isCorrect).length} من ${items.length} صحيحة (${acc.toFixed(0)}%) مقابل متوسطك العام ${overallAccuracy.toFixed(0)}%`,
        weight: 100 - acc,
      });
    }

    if (acc >= 85 && items.length >= MIN_SKILL_SAMPLE) {
      insights.push({
        kind: 'strength',
        text: `مهارة «${name}» من نقاط قوتك.`,
        evidence: `${items.filter((o) => o.isCorrect).length} من ${items.length} صحيحة (${acc.toFixed(0)}%)`,
        weight: acc / 2,
      });
    }
  }

  // --- pace, per section ------------------------------------------------
  const bySection = new Map<SectionId, QuestionOutcome[]>();
  for (const o of outcomes) {
    bySection.set(o.section, [...(bySection.get(o.section) ?? []), o]);
  }

  for (const [section, items] of bySection) {
    const timed = items.filter((o) => o.secondsSpent !== null && o.secondsSpent > 0);
    if (timed.length < MIN_TIMED_SAMPLE) continue;

    const name = SECTION_DEFS[section].nameAr;
    const med = median(timed.map((o) => o.secondsSpent!));
    const acc = pct(items.filter((o) => o.isCorrect).length, items.length);

    // Rushing is only meaningful when speed comes WITH poor accuracy.
    // Fast and correct is not a problem to report.
    if (med < 20 && acc < 55) {
      insights.push({
        kind: 'pace',
        text: `تتسرّع في قسم ${name} — السرعة تأتي على حساب الدقة.`,
        evidence: `متوسط ${med.toFixed(0)} ثانية للسؤال مع دقة ${acc.toFixed(0)}%`,
        weight: 70,
      });
    }

    // Slow and accurate is a time-management note, not an error.
    if (med > 90) {
      insights.push({
        kind: 'pace',
        text: acc >= 70
          ? `تستهلك وقتًا طويلًا في قسم ${name} رغم دقتك الجيدة فيه.`
          : `تستهلك وقتًا طويلًا في قسم ${name} دون أن ينعكس على الدقة.`,
        evidence: `متوسط ${med.toFixed(0)} ثانية للسؤال · الدقة ${acc.toFixed(0)}%`,
        weight: acc >= 70 ? 45 : 65,
      });
    }
  }

  // --- unanswered -------------------------------------------------------
  const unanswered = outcomes.filter((o) => !o.wasAnswered);
  if (unanswered.length >= 3) {
    const bySec = new Map<SectionId, number>();
    for (const o of unanswered) bySec.set(o.section, (bySec.get(o.section) ?? 0) + 1);
    const [worstSection, count] = [...bySec.entries()].sort((a, b) => b[1] - a[1])[0];

    insights.push({
      kind: 'behaviour',
      text: count >= unanswered.length * 0.6
        ? `معظم الأسئلة المتروكة في قسم ${SECTION_DEFS[worstSection].nameAr} — غالبًا نفد الوقت قبل إكماله.`
        : 'تركت عددًا من الأسئلة دون إجابة، وكلها تُحتسب خطأً.',
      evidence: `${unanswered.length} سؤالًا دون إجابة من ${outcomes.length}`,
      weight: 80,
    });
  }

  // --- accuracy decay ---------------------------------------------------
  // Compares the first and last third by position. Needs a real gap, not
  // a couple of percentage points.
  if (outcomes.length >= 15) {
    const sorted = [...outcomes].sort((a, b) => a.ordinal - b.ordinal);
    const third = Math.floor(sorted.length / 3);
    const first = sorted.slice(0, third);
    const last = sorted.slice(-third);
    const firstAcc = pct(first.filter((o) => o.isCorrect).length, first.length);
    const lastAcc = pct(last.filter((o) => o.isCorrect).length, last.length);

    if (firstAcc - lastAcc >= 20) {
      insights.push({
        kind: 'behaviour',
        text: 'دقتك تنخفض مع تقدّم الاختبار — قد يكون إرهاقًا أو ضغط وقت في الأجزاء الأخيرة.',
        evidence: `${firstAcc.toFixed(0)}% في الثلث الأول مقابل ${lastAcc.toFixed(0)}% في الثلث الأخير`,
        weight: 75,
      });
    }
  }

  // --- flags ------------------------------------------------------------
  const flagged = outcomes.filter((o) => o.wasFlagged);
  if (flagged.length >= 3) {
    const flaggedAcc = pct(flagged.filter((o) => o.isCorrect).length, flagged.length);
    const unflagged = outcomes.filter((o) => !o.wasFlagged);
    const unflaggedAcc = pct(unflagged.filter((o) => o.isCorrect).length, unflagged.length);

    if (unflaggedAcc - flaggedAcc >= 20) {
      insights.push({
        kind: 'behaviour',
        text: 'حدسك في تحديد الأسئلة الصعبة دقيق — الأسئلة التي علّمتها هي فعلًا التي أخطأت فيها أكثر.',
        evidence: `دقة ${flaggedAcc.toFixed(0)}% في المعلَّمة مقابل ${unflaggedAcc.toFixed(0)}% في غيرها`,
        weight: 40,
      });
    }
  }

  return insights.sort((a, b) => b.weight - a.weight);
}

// ---------------------------------------------------------------------
// Study plan
// ---------------------------------------------------------------------

export interface StudyTask {
  label: string;
  detail: string;
  /** Section to drill, when the task maps to practice mode. */
  section?: SectionId;
  skillId?: string;
  questionCount?: number;
}

export interface StudyPlan {
  headline: string;
  tasks: StudyTask[];
  /** Empty when there is not enough evidence to plan from. */
  basedOn: string;
}

/**
 * Build a plan from measured weaknesses.
 *
 * Rule-based and deliberately modest: it targets the sections and skills
 * where the candidate actually lost the most weighted marks. When the
 * sample is too small to rank anything, it says so instead of producing
 * a plausible-looking schedule with no basis.
 */
export function buildStudyPlan(outcomes: QuestionOutcome[]): StudyPlan {
  if (outcomes.length < MIN_SECTION_SAMPLE) {
    return {
      headline: 'أكمل اختبارًا كاملًا للحصول على خطة',
      tasks: [],
      basedOn: 'عدد الأسئلة غير كافٍ لبناء خطة موثوقة',
    };
  }

  const tasks: StudyTask[] = [];

  // Sections ranked by WEIGHTED marks lost — 60% in Reading costs four
  // times what 60% in Writing does.
  const bySection = new Map<SectionId, QuestionOutcome[]>();
  for (const o of outcomes) bySection.set(o.section, [...(bySection.get(o.section) ?? []), o]);

  const sectionLoss = [...bySection.entries()]
    .filter(([, items]) => items.length >= 3)
    .map(([section, items]) => {
      const acc = pct(items.filter((o) => o.isCorrect).length, items.length);
      return { section, acc, lost: ((100 - acc) / 100) * SECTION_DEFS[section].weightPct };
    })
    .sort((a, b) => b.lost - a.lost);

  for (const s of sectionLoss.slice(0, 2)) {
    if (s.acc >= 85) continue; // already strong; drilling it is low value
    tasks.push({
      label: `${SECTION_DEFS[s.section].nameAr} — ${s.section === 'reading' ? 'قطعتان' : '20 سؤالًا'}`,
      detail: `دقتك ${s.acc.toFixed(0)}% ووزن القسم ${SECTION_DEFS[s.section].weightPct}%`,
      section: s.section,
      questionCount: s.section === 'reading' ? 10 : 20,
    });
  }

  // Then the individual skills with enough attempts to be trustworthy.
  const bySkill = new Map<string, QuestionOutcome[]>();
  for (const o of outcomes) {
    if (o.skillId) bySkill.set(o.skillId, [...(bySkill.get(o.skillId) ?? []), o]);
  }

  const weakSkills = [...bySkill.entries()]
    .filter(([, items]) => items.length >= MIN_SKILL_SAMPLE)
    .map(([skillId, items]) => ({
      skillId,
      acc: pct(items.filter((o) => o.isCorrect).length, items.length),
      n: items.length,
    }))
    .filter((s) => s.acc < 60)
    .sort((a, b) => a.acc - b.acc)
    .slice(0, 3);

  for (const s of weakSkills) {
    const def = SKILL_BY_ID[s.skillId];
    tasks.push({
      label: `مراجعة ${def?.nameAr ?? s.skillId}`,
      detail: `${s.acc.toFixed(0)}% في ${s.n} أسئلة`,
      section: def?.section,
      skillId: s.skillId,
    });
  }

  if (!tasks.length) {
    return {
      headline: 'أداؤك متوازن — لا توجد نقطة ضعف واضحة',
      tasks: [{
        label: 'اختبار كامل آخر',
        detail: 'أعد الاختبار لتثبيت مستواك وكشف أي تذبذب',
      }],
      basedOn: `${outcomes.length} سؤالًا في هذه المحاولة`,
    };
  }

  return {
    headline: 'خطة اليوم',
    tasks,
    basedOn: `مبنية على ${outcomes.length} سؤالًا في هذه المحاولة`,
  };
}
