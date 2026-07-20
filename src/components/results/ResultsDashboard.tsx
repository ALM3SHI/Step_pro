'use client';

import { useMemo } from 'react';
import { ScoreHero } from './ScoreHero';
import { SectionBars } from './SectionBars';
import { TimeAnalysis } from './TimeAnalysis';
import { QuestionReview } from './QuestionReview';
import { SkillBreakdown } from './SkillBreakdown';
import { InsightsPanel, StudyPlanPanel } from './InsightsPanel';
import { PracticeSummary, type SkillBaseline } from './PracticeSummary';
import {
  analyzeTime, buildOutcomes, buildReviewRows, scoreSession, secondsPerQuestion,
} from '@/lib/exam/scoring';
import { buildStudyPlan, deriveInsights } from '@/lib/exam/insights';
import { UNTIMED_SECONDS } from '@/lib/content/blueprint';
import { Button } from '@/components/ui';
import type { SessionState } from '@/lib/exam/session';

/**
 * Post-exam analytics.
 *
 * Ordered by what a candidate needs first: the score, then where the
 * marks went, then what to do about it, and only then the per-question
 * review. Everything is derived from this sitting — cross-attempt
 * trends live on the history page, which has the data for them.
 */
export type { SkillBaseline };

export function ResultsDashboard({
  session,
  onExit,
  onPractice,
  skillBaseline,
}: {
  session: SessionState;
  onExit?: () => void;
  onPractice?: (section: string, count: number) => void;
  /**
   * Present only for targeted practice. When supplied, the drill's
   * effect on each skill is shown ahead of the generic breakdown —
   * that comparison is the whole point of a practice session, and the
   * exam has no baseline to compare against.
   */
  skillBaseline?: SkillBaseline[];
}) {
  const score = useMemo(() => scoreSession(session), [session]);
  const timing = useMemo(() => analyzeTime(session), [session]);
  const rows = useMemo(() => buildReviewRows(session), [session]);
  const outcomes = useMemo(() => buildOutcomes(session), [session]);
  const insights = useMemo(() => deriveInsights(outcomes), [outcomes]);
  const plan = useMemo(() => buildStudyPlan(outcomes), [outcomes]);
  const perQuestionSeconds = useMemo(() => secondsPerQuestion(session), [session]);

  const flaggedCount = Object.keys(session.flags).length;

  /**
   * Untimed sessions must not report time *management*.
   *
   * Targeted practice runs on a 12-hour clock that exists only to keep
   * the engine's single timing path. Rendering "استغلال الوقت 0%" and
   * "من 720:00" against it turns a deliberate non-constraint into what
   * looks like a catastrophic result.
   */
  const untimed = useMemo(
    () => session.exam.parts.every((p) => p.durationSeconds >= UNTIMED_SECONDS),
    [session.exam.parts],
  );

  return (
    <div className="space-y-5 pb-16">
      <ScoreHero
        score={score}
        usedSeconds={timing.totalUsed}
        allocatedSeconds={timing.totalAllocated}
        flaggedCount={flaggedCount}
        examName={session.exam.nameAr}
        untimed={untimed}
      />

      <div className={untimed ? '' : 'grid gap-5 lg:grid-cols-2'}>
        <SectionBars sections={score.bySection} />
        {!untimed && <TimeAnalysis analysis={timing} />}
      </div>

      {skillBaseline && (
        <PracticeSummary skills={score.bySkill} baseline={skillBaseline} />
      )}

      <InsightsPanel insights={insights} />

      <StudyPlanPanel plan={plan} onPractice={onPractice} />

      <SkillBreakdown skills={score.bySkill} weakest={score.weakestSkills} />

      <QuestionReview rows={rows} secondsPerQuestion={perQuestionSeconds} />

      {onExit && (
        <Button size="lg" block onClick={onExit} className="text-[color:var(--app-brand)]">
          العودة للرئيسية
        </Button>
      )}
    </div>
  );
}
