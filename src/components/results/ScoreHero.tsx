'use client';

import { memo } from 'react';
import { bandFor, STATUS } from './palette';
import type { ExamScore } from '@/lib/exam/scoring';

const clock = (s: number) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}س ${m}د` : `${m} دقيقة`;
};

export interface ScoreHeroProps {
  score: ExamScore;
  usedSeconds: number;
  allocatedSeconds: number;
  flaggedCount: number;
  examName: string;
}

/**
 * The headline.
 *
 * The estimated STEP score leads, with its confidence range directly
 * beneath — the range is not a footnote. Raw accuracy and the weighted
 * figure sit below as supporting numbers, because presenting accuracy
 * AS a STEP score is exactly what made the old prototype report ~88 for
 * performance nearer 70.
 */
export const ScoreHero = memo(function ScoreHero({
  score, usedSeconds, allocatedSeconds, flaggedCount, examName,
}: ScoreHeroProps) {
  const band = bandFor(score.weightedPct);
  const [lo, hi] = score.estimatedStepRange;
  const tone = STATUS[band.tone];

  // Arc runs 20-100, matching the STEP scale rather than 0-100 — a
  // blank paper does not score zero, and showing it that way misleads.
  const progress = Math.max(0, Math.min(1, (score.estimatedStep - 20) / 80));
  const R = 78;
  const CIRC = 2 * Math.PI * R;

  return (
    <section className="glass rounded-2xl p-6 sm:p-8" aria-labelledby="score-title">
      <p className="mb-6 text-center text-xs text-[color:var(--app-muted)]">{examName}</p>

      <div className="flex flex-col items-center gap-8 sm:flex-row sm:justify-center">
        {/* --- dial --- */}
        <div className="relative flex-shrink-0">
          <svg width="190" height="190" viewBox="0 0 190 190" role="img"
            aria-label={`الدرجة التقديرية ${score.estimatedStep} من 100، النطاق ${lo} إلى ${hi}`}>
            <circle
              cx="95" cy="95" r={R} fill="none" strokeWidth="13"
              className="stroke-black/[0.07] dark:stroke-white/[0.09]"
            />
            <circle
              cx="95" cy="95" r={R} fill="none" strokeWidth="13" stroke={tone}
              strokeLinecap="round"
              strokeDasharray={`${CIRC * progress} ${CIRC}`}
              transform="rotate(-90 95 95)"
              style={{ transition: 'stroke-dasharray .9s cubic-bezier(.2,.8,.2,1)' }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <b className="text-5xl font-extrabold tabular-nums leading-none" style={{ color: tone }}>
              {score.estimatedStep}
            </b>
            <span className="mt-1 text-[0.7rem] text-[color:var(--app-muted)]">
              درجة STEP التقديرية
            </span>
            <span className="mt-0.5 text-xs font-bold tabular-nums" style={{ color: tone }}>
              {lo}–{hi}
            </span>
          </div>
        </div>

        {/* --- supporting stats --- */}
        <div className="w-full max-w-sm">
          <h2 id="score-title" className="mb-1 text-lg font-bold" style={{ color: tone }}>
            {band.label}
          </h2>
          <p className="mb-4 text-xs leading-[1.8] text-[color:var(--app-muted)]">
            تقدير تقريبي مبني على أدائك في هذه المحاولة، وليس درجة رسمية من قياس.
          </p>

          <dl className="grid grid-cols-2 gap-2">
            <Stat label="الدقة الموزونة" value={`${score.weightedPct.toFixed(0)}%`} />
            <Stat label="الدرجة الخام" value={`${score.rawPct.toFixed(0)}%`} />
            <Stat label="إجابات صحيحة" value={`${score.correct} / ${score.total}`} />
            <Stat label="الوقت المستغرق" value={clock(usedSeconds)}
              hint={`من ${clock(allocatedSeconds)}`} />
            <Stat label="أجبت عنها" value={String(score.answered)} />
            <Stat
              label="تركتها"
              value={String(score.unanswered)}
              tone={score.unanswered > 0 ? 'warn' : undefined}
              hint={score.unanswered > 0 ? 'تُحتسب خطأً' : undefined}
            />
            <Stat label="علّمتها للمراجعة" value={String(flaggedCount)} />
            <Stat
              label="استغلال الوقت"
              value={allocatedSeconds ? `${Math.round((usedSeconds / allocatedSeconds) * 100)}%` : '—'}
            />
          </dl>
        </div>
      </div>
    </section>
  );
});

function Stat({
  label, value, hint, tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'warn';
}) {
  return (
    <div className="rounded-xl bg-black/[0.04] px-3 py-2.5 dark:bg-white/[0.05]">
      <dt className="text-[0.68rem] leading-tight text-[color:var(--app-muted)]">{label}</dt>
      <dd
        className={`text-base font-bold tabular-nums ${
          tone === 'warn' ? 'text-amber-700 dark:text-amber-300' : ''
        }`}
      >
        {value}
        {hint && (
          <span className="mr-1 text-[0.65rem] font-normal text-[color:var(--app-muted)]">
            {hint}
          </span>
        )}
      </dd>
    </div>
  );
}
