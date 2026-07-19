'use client';

import { useMemo } from 'react';
import { ScoreHero } from './ScoreHero';
import { SectionBars } from './SectionBars';
import { TimeAnalysis } from './TimeAnalysis';
import { QuestionReview } from './QuestionReview';
import { SkillBreakdown } from './SkillBreakdown';
import { InsightsPanel, StudyPlanPanel } from './InsightsPanel';
import {
  analyzeTime, buildOutcomes, buildReviewRows, scoreSession, secondsPerQuestion,
} from '@/lib/exam/scoring';
import { buildStudyPlan, deriveInsights } from '@/lib/exam/insights';
import type { SessionState } from '@/lib/exam/session';

/**
 * Post-exam analytics.
 *
 * Ordered by what a candidate needs first: the score, then where the
 * marks went, then what to do about it, and only then the per-question
 * review. Everything is derived from this sitting — cross-attempt
 * trends live on the history page, which has the data for them.
 */
export function ResultsDashboard({
  session,
  onExit,
  onPractice,
}: {
  session: SessionState;
  onExit?: () => void;
  onPractice?: (section: string, count: number) => void;
}) {
  const score = useMemo(() => scoreSession(session), [session]);
  const timing = useMemo(() => analyzeTime(session), [session]);
  const rows = useMemo(() => buildReviewRows(session), [session]);
  const outcomes = useMemo(() => buildOutcomes(session), [session]);
  const insights = useMemo(() => deriveInsights(outcomes), [outcomes]);
  const plan = useMemo(() => buildStudyPlan(outcomes), [outcomes]);
  const perQuestionSeconds = useMemo(() => secondsPerQuestion(session), [session]);

  const flaggedCount = Object.keys(session.flags).length;

  return (
    <div className="space-y-5 pb-16">
      <ScoreHero
        score={score}
        usedSeconds={timing.totalUsed}
        allocatedSeconds={timing.totalAllocated}
        flaggedCount={flaggedCount}
        examName={session.exam.nameAr}
      />

      <div className="grid gap-5 lg:grid-cols-2">
        <SectionBars sections={score.bySection} />
        <TimeAnalysis analysis={timing} />
      </div>

      <InsightsPanel insights={insights} />

      <StudyPlanPanel plan={plan} onPractice={onPractice} />

      <SkillBreakdown skills={score.bySkill} weakest={score.weakestSkills} />

      <QuestionReview rows={rows} secondsPerQuestion={perQuestionSeconds} />

      {onExit && (
        <button
          type="button"
          onClick={onExit}
          className="glass w-full rounded-2xl py-4 font-bold text-[color:var(--app-brand)]"
        >
          العودة للرئيسية
        </button>
      )}
    </div>
  );
}
