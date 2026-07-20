/**
 * Exam blueprints.
 *
 * A blueprint is DATA: how many questions per section, how they split
 * into parts, and how long each part runs. The engine reads it and has
 * no opinion of its own, so producing a shorter mock or a section drill
 * is a config change rather than an engine change.
 */

import { SECTION_DEFS, SECTION_LIST, SKILLS_BY_SECTION, type Difficulty, type SectionId } from './taxonomy';

export interface PartSpec {
  section: SectionId;
  /** 1-based within the section. */
  partNo: number;
  questionCount: number
  durationSeconds: number;
  /**
   * Targeted-practice narrowing. Absent on the real exam, which must
   * sample the whole section — a STEP paper that drew only from one
   * skill would not be a STEP paper.
   */
  skillIds?: string[];
  difficulties?: Difficulty[];
}

export interface Blueprint {
  id: string;
  nameAr: string;
  nameEn: string;
  totalQuestions: number;
  totalSeconds: number;
  parts: PartSpec[];
  /** Practice mode shows the answer and explanation after each question. */
  instantFeedback: boolean;
}

/**
 * The full STEP simulation.
 *
 * 100 questions over 120 minutes, weighted 40/30/20/10, each section
 * split into 3 parts. Section time is allocated by weight, then divided
 * evenly across that section's parts.
 *
 * Listening gets less time per question by design: the recording paces
 * the candidate, so extra minutes there would not be spent thinking.
 */
const SECTION_MINUTES: Record<SectionId, number> = {
  reading: 45,   // 40 questions — the heaviest reading load
  grammar: 30,   // 30 questions
  listening: 25, // 20 questions, paced by the audio
  writing: 20,   // 10 questions, but each requires close analysis
};

const SECTION_QUESTIONS: Record<SectionId, number> = {
  reading: 40,
  grammar: 30,
  listening: 20,
  writing: 10,
};

const PARTS_PER_SECTION = 3;

function buildParts(
  questionsBySection: Record<SectionId, number>,
  minutesBySection: Record<SectionId, number>,
  partsPerSection: number,
): PartSpec[] {
  const parts: PartSpec[] = [];

  for (const section of SECTION_LIST) {
    const total = questionsBySection[section.id];
    if (!total) continue;

    const partCount = Math.min(partsPerSection, total);
    const perPart = Math.floor(total / partCount);
    const remainder = total % partCount;

    const sectionSeconds = minutesBySection[section.id] * 60;
    const secondsPerPart = Math.floor(sectionSeconds / partCount);
    const secondsRemainder = sectionSeconds % partCount;

    for (let i = 0; i < partCount; i++) {
      parts.push({
        section: section.id,
        partNo: i + 1,
        // Spread the remainder over the leading parts so the counts sum
        // exactly to the blueprint instead of silently losing questions.
        questionCount: perPart + (i < remainder ? 1 : 0),
        durationSeconds: secondsPerPart + (i < secondsRemainder ? 1 : 0),
      });
    }
  }

  return parts;
}

export const FULL_STEP_BLUEPRINT: Blueprint = {
  id: 'step-full-100',
  nameAr: 'محاكي STEP الكامل',
  nameEn: 'Full STEP Simulation',
  totalQuestions: 100,
  totalSeconds: 120 * 60,
  parts: buildParts(SECTION_QUESTIONS, SECTION_MINUTES, PARTS_PER_SECTION),
  instantFeedback: false,
};

/** A single-section drill. Practice mode, with feedback after each item. */
export function practiceBlueprint(section: SectionId, questionCount = 10): Blueprint {
  const def = SECTION_DEFS[section];
  // Practice is untimed in spirit but keeps a generous clock so the
  // engine's timer path is the same one the real exam uses — a separate
  // untimed code path would be a second thing to keep correct.
  const seconds = Math.max(300, questionCount * 90);

  return {
    id: `practice-${section}-${questionCount}`,
    nameAr: `تدريب: ${def.nameAr}`,
    nameEn: `Practice: ${def.nameEn}`,
    totalQuestions: questionCount,
    totalSeconds: seconds,
    parts: [{ section, partNo: 1, questionCount, durationSeconds: seconds }],
    instantFeedback: true,
  };
}

// ---------------------------------------------------------------------
// Targeted practice
// ---------------------------------------------------------------------

/**
 * Effectively no clock.
 *
 * Targeted practice is for working through a weakness, not for pacing,
 * so the timer must never end the session. This is a DATA value rather
 * than a second timing path in the engine: the runner keeps one code
 * path, and 12 hours is longer than any real sitting.
 */
export const UNTIMED_SECONDS = 12 * 60 * 60;

export interface TargetedPracticeSpec {
  /** One entry per section to draw from. Mixed practice passes several. */
  sections: Array<{
    section: SectionId;
    questionCount: number;
    /** Empty means the whole section. */
    skillIds?: string[];
  }>;
  difficulties?: Difficulty[];
  nameAr?: string;
}

/**
 * A drill narrowed to chosen skills and/or a difficulty band.
 *
 * One part per section and no split: the parts array exists because the
 * engine reads it, but a single part per section means the candidate
 * never hits a part boundary or a lock.
 */
export function targetedPracticeBlueprint(spec: TargetedPracticeSpec): Blueprint {
  const entries = spec.sections.filter((s) => s.questionCount > 0);
  const totalQuestions = entries.reduce((n, s) => n + s.questionCount, 0);

  const parts: PartSpec[] = entries.map((s) => ({
    section: s.section,
    partNo: 1,
    questionCount: s.questionCount,
    durationSeconds: UNTIMED_SECONDS,
    skillIds: s.skillIds?.length ? s.skillIds : undefined,
    difficulties: spec.difficulties?.length ? spec.difficulties : undefined,
  }));

  const label = spec.nameAr
    ?? (entries.length === 1
      ? `تدريب: ${SECTION_DEFS[entries[0].section].nameAr}`
      : 'تدريب مختلط');

  return {
    id: `targeted-${entries.map((s) => s.section).join('-')}-${totalQuestions}`,
    nameAr: label,
    nameEn: 'Targeted Practice',
    totalQuestions,
    totalSeconds: UNTIMED_SECONDS * parts.length,
    parts,
    instantFeedback: true,
  };
}

/** Skills that actually have questions behind them, for the picker. */
export function skillsForSection(section: SectionId) {
  return SKILLS_BY_SECTION[section] ?? [];
}

// ---------------------------------------------------------------------
// Integrity
// ---------------------------------------------------------------------

export interface BlueprintCheck {
  ok: boolean;
  problems: string[];
  questionsBySection: Record<string, number>;
  secondsBySection: Record<string, number>;
}

/**
 * A blueprint whose parts do not sum to its own totals produces an exam
 * that is silently the wrong length, so this runs in tests and at build
 * time rather than being assumed.
 */
export function checkBlueprint(bp: Blueprint): BlueprintCheck {
  const problems: string[] = [];
  const questionsBySection: Record<string, number> = {};
  const secondsBySection: Record<string, number> = {};

  for (const p of bp.parts) {
    questionsBySection[p.section] = (questionsBySection[p.section] ?? 0) + p.questionCount;
    secondsBySection[p.section] = (secondsBySection[p.section] ?? 0) + p.durationSeconds;
    if (p.questionCount < 1) problems.push(`${p.section} part ${p.partNo} has no questions`);
    if (p.durationSeconds < 30) problems.push(`${p.section} part ${p.partNo} has under 30s`);
  }

  const totalQ = Object.values(questionsBySection).reduce((a, b) => a + b, 0);
  if (totalQ !== bp.totalQuestions) {
    problems.push(`parts sum to ${totalQ} questions, blueprint declares ${bp.totalQuestions}`);
  }

  const totalS = Object.values(secondsBySection).reduce((a, b) => a + b, 0);
  if (totalS !== bp.totalSeconds) {
    problems.push(`parts sum to ${totalS}s, blueprint declares ${bp.totalSeconds}s`);
  }

  // For the full exam, question counts must match the official weights.
  if (bp.id === FULL_STEP_BLUEPRINT.id) {
    for (const section of SECTION_LIST) {
      const got = questionsBySection[section.id] ?? 0;
      const want = Math.round((section.weightPct / 100) * bp.totalQuestions);
      if (got !== want) {
        problems.push(`${section.id}: ${got} questions but weight ${section.weightPct}% implies ${want}`);
      }
    }
  }

  return { ok: problems.length === 0, problems, questionsBySection, secondsBySection };
}
