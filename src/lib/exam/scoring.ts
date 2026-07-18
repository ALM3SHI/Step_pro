/**
 * Scoring and analytics.
 *
 * Two numbers, deliberately kept apart:
 *
 *  - RAW / WEIGHTED accuracy: what the candidate actually got right,
 *    weighted by the official section percentages. Unambiguous.
 *  - ESTIMATED STEP SCORE: a projection onto the 20-100 STEP scale.
 *    This is a MODEL, not a measurement, and it is reported with a range
 *    rather than a single confident number.
 *
 * The old prototype reported ~88 for performance nearer 70 because it
 * showed weighted accuracy as if it were a STEP score. They are not the
 * same scale: STEP is a scaled score with a floor of ~20, and raw
 * percentage maps onto it non-linearly.
 */

import { SECTION_DEFS, SKILL_BY_ID, type SectionId } from '../content/taxonomy';
import type { SessionState } from './session';

export interface SectionScore {
  section: SectionId;
  correct: number;
  total: number;
  answered: number;
  accuracyPct: number;
  weightPct: number;
  /** Weighted points lost — what to fix first. */
  lostWeightedPoints: number;
}

export interface SkillScore {
  skillId: string;
  nameAr: string;
  section: SectionId;
  correct: number;
  total: number;
  accuracyPct: number;
}

export interface ExamScore {
  correct: number;
  total: number;
  answered: number;
  unanswered: number;
  rawPct: number;
  weightedPct: number;
  /** Projected STEP score, 20-100. */
  estimatedStep: number;
  estimatedStepRange: [number, number];
  bySection: SectionScore[];
  bySkill: SkillScore[];
  weakestSection?: SectionScore;
  weakestSkills: SkillScore[];
}

/**
 * Map weighted accuracy onto the STEP scale.
 *
 * STEP reports roughly 20-100, and the mapping is not the identity:
 *  - the floor is ~20, not 0 — a blank paper does not score 0;
 *  - the top is compressed — near-perfect accuracy is needed for 95+;
 *  - the middle is close to linear.
 *
 * This is a piecewise-linear approximation anchored on published band
 * descriptors, NOT a calibration against real score reports. It is
 * intentionally conservative: over-reporting a candidate's readiness is
 * the more harmful error. Replace the anchors once real paired data
 * (raw accuracy vs official score) is available.
 */
const STEP_ANCHORS: Array<[accuracyPct: number, stepScore: number]> = [
  [0, 20],
  [20, 33],
  [35, 45],
  [50, 56],
  [65, 68],
  [75, 76],
  [85, 84],
  [95, 92],
  [100, 97],
];

export function accuracyToStepScore(accuracyPct: number): number {
  const a = Math.max(0, Math.min(100, accuracyPct));
  for (let i = 1; i < STEP_ANCHORS.length; i++) {
    const [x0, y0] = STEP_ANCHORS[i - 1];
    const [x1, y1] = STEP_ANCHORS[i];
    if (a <= x1) {
      const t = x1 === x0 ? 0 : (a - x0) / (x1 - x0);
      return Math.round(y0 + t * (y1 - y0));
    }
  }
  return STEP_ANCHORS[STEP_ANCHORS.length - 1][1];
}

/**
 * Confidence band for the projection.
 *
 * A 100-question mock cannot pin a scaled score to the point. The band
 * widens when fewer questions were answered, because the estimate rests
 * on less evidence.
 */
function stepRange(step: number, answered: number, total: number): [number, number] {
  const coverage = total ? answered / total : 0;
  const spread = Math.round(4 + (1 - coverage) * 8);
  return [Math.max(20, step - spread), Math.min(100, step + spread)];
}

export function scoreSession(state: SessionState): ExamScore {
  const sectionAcc = new Map<SectionId, { correct: number; total: number; answered: number }>();
  const skillAcc = new Map<string, { correct: number; total: number; section: SectionId }>();

  let correct = 0;
  let total = 0;
  let answered = 0;

  for (const part of state.exam.parts) {
    for (const id of part.questionIds) {
      const q = state.exam.questions[id];
      if (!q) continue;

      const given = state.answers[id];
      // An unanswered question is wrong. STEP has no partial credit and
      // no penalty-free omission, so treating it as neutral would
      // flatter the candidate.
      const isRight = Boolean(given && given === q.correctOption);

      total++;
      if (given) answered++;
      if (isRight) correct++;

      const sec = sectionAcc.get(part.section) ?? { correct: 0, total: 0, answered: 0 };
      sec.total++;
      if (given) sec.answered++;
      if (isRight) sec.correct++;
      sectionAcc.set(part.section, sec);

      const sk = skillAcc.get(q.skillId) ?? { correct: 0, total: 0, section: part.section };
      sk.total++;
      if (isRight) sk.correct++;
      skillAcc.set(q.skillId, sk);
    }
  }

  const bySection: SectionScore[] = [...sectionAcc.entries()]
    .map(([section, v]) => {
      const weightPct = SECTION_DEFS[section].weightPct;
      const accuracyPct = v.total ? (v.correct / v.total) * 100 : 0;
      return {
        section,
        correct: v.correct,
        total: v.total,
        answered: v.answered,
        accuracyPct,
        weightPct,
        lostWeightedPoints: ((100 - accuracyPct) / 100) * weightPct,
      };
    })
    .sort((a, b) => SECTION_DEFS[a.section].displayOrder - SECTION_DEFS[b.section].displayOrder);

  // Weight only over the sections actually present, so a single-section
  // practice drill still reports a sensible number.
  const weightSum = bySection.reduce((n, s) => n + s.weightPct, 0);
  const weightedPct = weightSum
    ? bySection.reduce((n, s) => n + s.accuracyPct * s.weightPct, 0) / weightSum
    : 0;

  const bySkill: SkillScore[] = [...skillAcc.entries()]
    .map(([skillId, v]) => ({
      skillId,
      nameAr: SKILL_BY_ID[skillId]?.nameAr ?? skillId,
      section: v.section,
      correct: v.correct,
      total: v.total,
      accuracyPct: v.total ? (v.correct / v.total) * 100 : 0,
    }))
    .sort((a, b) => a.accuracyPct - b.accuracyPct);

  const estimatedStep = accuracyToStepScore(weightedPct);

  return {
    correct,
    total,
    answered,
    unanswered: total - answered,
    rawPct: total ? (correct / total) * 100 : 0,
    weightedPct,
    estimatedStep,
    estimatedStepRange: stepRange(estimatedStep, answered, total),
    bySection,
    bySkill,
    // Ranked by weighted points lost, not raw accuracy: 60% in Reading
    // costs far more than 60% in Writing.
    weakestSection: [...bySection].sort((a, b) => b.lostWeightedPoints - a.lostWeightedPoints)[0],
    // Needs at least 3 attempts to be a signal rather than noise.
    weakestSkills: bySkill.filter((s) => s.total >= 3 && s.accuracyPct < 70).slice(0, 5),
  };
}

// ---------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------

export interface PartTimeAnalysis {
  partIndex: number;
  section: SectionId;
  labelAr: string;
  partNo: number;
  allocatedSeconds: number;
  usedSeconds: number;
  usagePct: number;
  expired: boolean;
  questionCount: number;
  secondsPerQuestion: number;
}

export function analyzeTime(state: SessionState) {
  const parts: PartTimeAnalysis[] = [];

  for (const part of state.exam.parts) {
    const t = state.partTimings[part.index];
    if (!t) continue;

    const end = t.endedAt ?? Date.now();
    // Clamp to the allocation: a backgrounded tab reports wall-clock
    // beyond the deadline, which would render as >100% for everyone.
    const used = Math.min(Math.max(0, Math.round((end - t.startedAt) / 1000)), t.allocatedSeconds);

    parts.push({
      partIndex: part.index,
      section: part.section,
      labelAr: part.labelAr,
      partNo: part.partNo,
      allocatedSeconds: t.allocatedSeconds,
      usedSeconds: used,
      usagePct: t.allocatedSeconds ? (used / t.allocatedSeconds) * 100 : 0,
      expired: t.expired,
      questionCount: part.questionIds.length,
      secondsPerQuestion: part.questionIds.length ? used / part.questionIds.length : 0,
    });
  }

  return {
    parts,
    totalAllocated: parts.reduce((n, p) => n + p.allocatedSeconds, 0),
    totalUsed: parts.reduce((n, p) => n + p.usedSeconds, 0),
  };
}

// ---------------------------------------------------------------------
// Review rows
// ---------------------------------------------------------------------

export interface ReviewRow {
  id: string;
  number: number;
  section: SectionId;
  skillNameAr: string;
  questionText: string;
  options: Record<string, string>;
  chosen?: string;
  correct: string;
  isCorrect: boolean;
  answered: boolean;
  flagged: boolean;
  explanationAr?: string;
  passageText?: string;
  imageUrl?: string;
  imageAlt?: string;
}

export function buildReviewRows(state: SessionState): ReviewRow[] {
  const rows: ReviewRow[] = [];
  for (const part of state.exam.parts) {
    for (const id of part.questionIds) {
      const q = state.exam.questions[id];
      if (!q) continue;
      const chosen = state.answers[id];
      rows.push({
        id,
        number: state.exam.numberInSection[id],
        section: part.section,
        skillNameAr: SKILL_BY_ID[q.skillId]?.nameAr ?? q.skillId,
        questionText: q.text,
        options: q.options,
        chosen,
        correct: q.correctOption,
        isCorrect: Boolean(chosen && chosen === q.correctOption),
        answered: Boolean(chosen),
        flagged: Boolean(state.flags[id]),
        explanationAr: q.explanationAr,
        passageText: q.passageId ? state.exam.passages[q.passageId]?.body : undefined,
        imageUrl: q.imageUrl,
        imageAlt: q.imageAlt,
      });
    }
  }
  return rows;
}
