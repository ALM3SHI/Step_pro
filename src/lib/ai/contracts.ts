/**
 * AI service contracts.
 *
 * Types and interfaces ONLY — no implementation, no API key, no network.
 * The purpose is that every page which will eventually show AI output
 * can be written against these shapes today, so wiring a real provider
 * later is a new implementation of an interface rather than a redesign
 * of the pages that consume it.
 *
 * Each service takes the analytics we already compute (outcomes,
 * insights, skill trends) as INPUT. That is deliberate: the model
 * should reason over measured facts, not re-derive them from raw
 * answers, and it keeps the deterministic layer authoritative.
 */

import type { Insight, StudyPlan } from '../exam/insights';
import type { QuestionOutcome } from '../exam/scoring';
import type { SkillTrend } from '@/app/actions/analytics';
import type { SectionId } from '../content/taxonomy';

/** Every AI response carries provenance so the UI can label it. */
export interface AiEnvelope<T> {
  data: T;
  meta: {
    provider: string;
    model: string;
    /** Model's own confidence, when it reports one. Advisory only. */
    confidence?: number;
    generatedAt: string;
    /** True when served from cache rather than freshly generated. */
    cached?: boolean;
  };
}

export type AiResult<T> =
  | { ok: true; value: AiEnvelope<T> }
  | { ok: false; error: string; retryable: boolean };

// ---------------------------------------------------------------------
// 1. Performance analysis
// ---------------------------------------------------------------------

export interface PerformanceAnalysisInput {
  outcomes: QuestionOutcome[];
  /** What the rule engine already found. The model adds to it. */
  deterministicInsights: Insight[];
  skillTrends?: SkillTrend[];
  attemptCount: number;
}

export interface PerformanceAnalysis {
  /** 2-4 sentences in Arabic. */
  summaryAr: string;
  /** Additional patterns the rules did not catch. */
  observations: Array<{ textAr: string; evidence: string }>;
  /** Where the model is uncertain — shown rather than hidden. */
  caveats: string[];
}

export interface AiPerformanceAnalyst {
  readonly name: string;
  analyse(input: PerformanceAnalysisInput): Promise<AiResult<PerformanceAnalysis>>;
}

// ---------------------------------------------------------------------
// 2. Study plan
// ---------------------------------------------------------------------

export interface StudyPlanInput {
  outcomes: QuestionOutcome[];
  skillTrends: SkillTrend[];
  /** The rule-based plan. The model refines; it does not start blank. */
  basePlan: StudyPlan;
  targetScore?: number;
  daysUntilExam?: number;
  minutesPerDay?: number;
}

export interface AiStudyPlan {
  headlineAr: string;
  days: Array<{
    dayNumber: number;
    tasks: Array<{
      labelAr: string;
      detailAr: string;
      section?: SectionId;
      skillId?: string;
      questionCount?: number;
      estimatedMinutes?: number;
    }>;
  }>;
  rationaleAr: string;
}

export interface AiStudyPlanner {
  readonly name: string;
  plan(input: StudyPlanInput): Promise<AiResult<AiStudyPlan>>;
}

// ---------------------------------------------------------------------
// 3. Question explanation
// ---------------------------------------------------------------------

export interface ExplanationInput {
  questionText: string;
  options: Record<string, string>;
  correctOption: string;
  chosenOption?: string;
  passageText?: string;
  skillId?: string;
  /** An existing explanation to improve rather than replace. */
  existingExplanationAr?: string;
}

export interface QuestionExplanation {
  explanationAr: string;
  /** Why the specific wrong answer was tempting. */
  whyYourAnswerWasWrongAr?: string;
  ruleAr?: string;
}

export interface AiExplainer {
  readonly name: string;
  explain(input: ExplanationInput): Promise<AiResult<QuestionExplanation>>;
  explainBatch(inputs: ExplanationInput[]): Promise<AiResult<QuestionExplanation[]>>;
}

// ---------------------------------------------------------------------
// 4. Coach / chat
// ---------------------------------------------------------------------

export interface CoachMessage {
  role: 'user' | 'assistant';
  content: string;
  at: string;
}

export interface CoachContext {
  /** Facts the coach may cite. It must not invent numbers beyond these. */
  latestScore?: number;
  weakestSkills?: Array<{ nameAr: string; accuracyPct: number; attempted: number }>;
  attemptCount: number;
  targetScore?: number;
}

export interface AiCoach {
  readonly name: string;
  reply(
    history: CoachMessage[],
    context: CoachContext,
  ): Promise<AiResult<{ replyAr: string; suggestedActions?: string[] }>>;
}

// ---------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------

export interface AiServices {
  analyst?: AiPerformanceAnalyst;
  planner?: AiStudyPlanner;
  explainer?: AiExplainer;
  coach?: AiCoach;
}

/**
 * No provider is registered yet.
 *
 * Callers check for undefined and fall back to the deterministic layer,
 * which is why every AI feature degrades to something useful rather than
 * to an empty panel.
 */
export function getAiServices(): AiServices {
  return {};
}

export function isAiEnabled(): boolean {
  const s = getAiServices();
  return Boolean(s.analyst || s.planner || s.explainer || s.coach);
}
