'use client';

import { useMemo } from 'react';
import { SectionBars } from './SectionBars';
import { TimeAnalysis } from './TimeAnalysis';
import { QuestionReview } from './QuestionReview';
import { SkillBreakdown } from './SkillBreakdown';
import { bandFor, STATUS } from './palette';
import { analyzeTime, buildReviewRows, scoreSession } from '@/lib/exam/scoring';
import { SECTION_DEFS } from '@/lib/content/taxonomy';
import type { SessionState } from '@/lib/exam/session';

/**
 * Post-exam analytics.
 *
 * The headline is the ESTIMATED STEP SCORE with its uncertainty band,
 * not raw accuracy. Showing accuracy as if it were a STEP score is what
 * made the old prototype report ~88 for performance nearer 70.
 */
export function ResultsDashboard({
  session,
  onExit,
}: {
  session: SessionState;
  onExit?: () => void;
}) {
  const score = useMemo(() => scoreSession(session), [session]);
  const timing = useMemo(() => analyzeTime(session), [session]);
  const rows = useMemo(() => buildReviewRows(session), [session]);

  const band = bandFor(score.weightedPct);
  const [lo, hi] = score.estimatedStepRange;

  return (
    <div className="space-y-5 pb-16">
      {/* ---------- hero ---------- */}
      <section className="glass rounded-2xl p-8 text-center">
        <p className="mb-1 text-sm text-[color:var(--app-muted)]">درجة STEP التقديرية</p>

        <div className="flex items-baseline justify-center gap-2">
          <b className="text-6xl font-extrabold tabular-nums leading-none" style={{ color: STATUS[band.tone] }}>
            {score.estimatedStep}
          </b>
        </div>

        <p className="mt-1 text-sm text-[color:var(--app-muted)]">
          النطاق المتوقّع <b className="tabular-nums">{lo}–{hi}</b>
        </p>
        <p className="mt-1 text-xs text-[color:var(--app-muted)]">
          تقدير تقريبي مبني على أدائك، وليس درجة رسمية.
        </p>

        <div className="mt-4 flex flex-wrap items-center justify-center gap-x-6 gap-y-1 text-sm">
          <span>الدقة الموزونة <b className="tabular-nums">{score.weightedPct.toFixed(0)}%</b></span>
          <span className="text-[color:var(--app-muted)]">
            {score.correct} من {score.total} صحيحة
          </span>
          <span className="text-[color:var(--app-muted)]">
            الدرجة الخام {score.rawPct.toFixed(0)}%
          </span>
        </div>

        {score.unanswered > 0 && (
          <p className="mt-3 text-xs text-amber-700 dark:text-amber-300">
            تركت {score.unanswered} سؤالًا دون إجابة — وتُحتسب خطأً.
          </p>
        )}

        {score.weakestSection && (
          <p className="mx-auto mt-4 max-w-md rounded-xl bg-black/[0.04] px-4 py-3 text-sm leading-[1.9] dark:bg-white/[0.05]">
            أكبر مكسب ممكن لدرجتك في قسم{' '}
            <b>{SECTION_DEFS[score.weakestSection.section].nameAr}</b> — وزنه{' '}
            {score.weakestSection.weightPct}% ونسبتك فيه{' '}
            {score.weakestSection.accuracyPct.toFixed(0)}%.
          </p>
        )}

        {onExit && (
          <button
            type="button"
            onClick={onExit}
            className="mt-5 rounded-xl bg-[color:var(--app-brand)] px-6 py-2.5 font-bold text-white"
          >
            العودة للرئيسية
          </button>
        )}
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <SectionBars sections={score.bySection} />
        <TimeAnalysis analysis={timing} />
      </div>

      <SkillBreakdown skills={score.bySkill} weakest={score.weakestSkills} />

      <QuestionReview rows={rows} />
    </div>
  );
}
