'use client';

import { useMemo } from 'react';
import { SectionBars } from './SectionBars';
import { TimeAnalysis } from './TimeAnalysis';
import { QuestionReview } from './QuestionReview';
import { bandFor, STATUS } from './palette';
import { analyzeTime, buildReviewRows, scoreExam } from '@/lib/exam/engine';
import type { ExamState } from '@/lib/exam/types';

export interface ResultsDashboardProps {
  state: ExamState;
  /** Server-computed score. Authoritative when present. */
  serverScore?: { correct: number; total: number; weighted: number };
  saveStatus?: string;
  onRetake?: () => void;
}

/**
 * Post-exam analytics.
 *
 * The headline is the WEIGHTED score, because that is the number the real
 * exam reports; the raw fraction sits beside it as supporting detail. A
 * candidate at 70% raw but weak in Reading (40% of the exam) scores worse
 * than the raw figure suggests, and showing raw alone hides that.
 */
export function ResultsDashboard({ state, serverScore, saveStatus, onRetake }: ResultsDashboardProps) {
  const score = useMemo(() => scoreExam(state), [state]);
  const timing = useMemo(() => analyzeTime(state), [state]);
  const rows = useMemo(() => buildReviewRows(state), [state]);

  // Prefer the server's number: the client's is computed from keys the
  // browser can see, so it is display-only until the server confirms.
  const weighted = serverScore?.weighted ?? score.weightedPct;
  const band = bandFor(weighted);

  const weakest = useMemo(() => {
    const entries = Object.entries(score.bySection).filter(([, v]) => v.total > 0);
    if (!entries.length) return null;
    // Rank by lost weighted points, not by raw percentage: a 60% in
    // Reading costs far more than a 40% in Writing.
    return entries
      .map(([sec, v]) => ({ sec, ...v, lostPoints: ((100 - v.pct) / 100) * v.weightPct }))
      .sort((a, b) => b.lostPoints - a.lostPoints)[0];
  }, [score]);

  return (
    <div className="space-y-5">
      {/* ---------- hero ---------- */}
      <section className="glass rounded-2xl p-8 text-center">
        <p className="mb-1 text-sm text-[color:var(--app-muted)]">درجتك الموزونة</p>

        <div className="flex items-baseline justify-center gap-2">
          <b className="text-6xl font-extrabold tabular-nums leading-none" style={{ color: STATUS[band.tone] }}>
            {weighted.toFixed(0)}
          </b>
          <span className="text-2xl font-bold text-[color:var(--app-muted)]">%</span>
        </div>

        <p className="mt-2 text-sm font-bold" style={{ color: STATUS[band.tone] }}>{band.label}</p>

        <p className="mt-3 text-sm text-[color:var(--app-muted)]">
          {serverScore?.correct ?? score.correct} من {serverScore?.total ?? score.total} إجابة صحيحة
          <span className="mx-2">·</span>
          الدرجة الخام {score.rawPct.toFixed(0)}%
        </p>

        {score.answered < score.total && (
          <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
            تركت {score.total - score.answered} سؤالًا دون إجابة — وتُحتسب خطأً.
          </p>
        )}

        {weakest && (
          <p className="mx-auto mt-4 max-w-md rounded-xl bg-black/[0.04] px-4 py-3 text-sm leading-[1.9] dark:bg-white/[0.05]">
            أكبر مكسب ممكن لدرجتك في قسم{' '}
            <b>{({ reading: 'فهم المقروء', grammar: 'القواعد', listening: 'فهم المسموع', writing: 'التحليل الكتابي' })[weakest.sec] ?? weakest.sec}</b>
            {' '}— وزنه {weakest.weightPct}% ونسبتك فيه {weakest.pct.toFixed(0)}%.
          </p>
        )}

        <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
          {onRetake && (
            <button
              type="button"
              onClick={onRetake}
              className="rounded-xl bg-[color:var(--app-brand)] px-6 py-2.5 font-bold text-white"
            >
              اختبار جديد
            </button>
          )}
          {saveStatus && (
            <span className="text-xs text-[color:var(--app-muted)]">{saveStatus}</span>
          )}
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <SectionBars score={score} />
        <TimeAnalysis analysis={timing} />
      </div>

      <QuestionReview rows={rows} />
    </div>
  );
}
