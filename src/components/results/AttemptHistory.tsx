'use client';

import { memo } from 'react';
import { SECTION_LABEL_AR } from './palette';
import { Badge, Card, Delta, SectionTitle } from '@/components/ui';
import type { AttemptSummary } from '@/app/actions/analytics';

const clock = (s: number) => {
  const m = Math.floor(s / 60);
  return m >= 60 ? `${Math.floor(m / 60)}س ${m % 60}د` : `${m} د`;
};

/**
 * Every submitted attempt, newest first, with a sparkline of the score
 * over time.
 *
 * The line is drawn on the 20-100 STEP scale rather than auto-fitting to
 * the data range — auto-fit turns a 2-point wobble into a dramatic climb.
 */
export const AttemptHistory = memo(function AttemptHistory({
  attempts,
}: {
  attempts: AttemptSummary[];
}) {
  // Chronological for the chart; the list below stays newest-first.
  const chrono = [...attempts].reverse();

  return (
    <Card className="p-6" aria-labelledby="history-title">
      <SectionTitle id="history-title" hint={`${attempts.length} محاولة مكتملة`}>
        سجل المحاولات
      </SectionTitle>

      {chrono.length > 1 && <Sparkline attempts={chrono} />}

      <ul className="stagger mt-5 space-y-3">
        {attempts.map((a) => (
          <li key={a.id} className="rounded-xl bg-black/[0.03] p-4 dark:bg-white/[0.04]">
            <div className="mb-2 flex flex-wrap items-baseline gap-2">
              <b className="tabular-nums text-lg text-[color:var(--app-brand)]">
                {a.estimatedStep}
              </b>
              {a.deltaVsPrevious !== null && Math.abs(a.deltaVsPrevious) >= 3 && (
                <Delta value={a.deltaVsPrevious} />
              )}
              <span className="text-xs text-[color:var(--app-muted)]">{a.examName}</span>
              <span className="flex-1" />
              <span className="text-xs text-[color:var(--app-muted)]">
                {a.submittedAt
                  ? new Date(a.submittedAt).toLocaleDateString('ar-SA', {
                      year: 'numeric', month: 'short', day: 'numeric',
                    })
                  : '—'}
              </span>
            </div>

            <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[color:var(--app-muted)]">
              <span className="tabular-nums">{a.correctCount}/{a.totalQuestions} صحيحة</span>
              <span className="tabular-nums">{clock(a.elapsedSeconds)}</span>
              {a.flaggedCount > 0 && (
                <span className="tabular-nums">⚑ {a.flaggedCount}</span>
              )}
              {a.answeredCount < a.totalQuestions && (
                <span className="tabular-nums text-amber-700 dark:text-amber-300">
                  {a.totalQuestions - a.answeredCount} متروكة
                </span>
              )}
            </div>

            {/* Per-section split, so a single number never hides where
                the marks actually went. */}
            <div className="flex flex-wrap gap-1.5">
              {/* The section hue comes from the themed token, not the
                  light-mode constant — these chips were unreadable in
                  dark mode because the palette never followed the theme. */}
              {Object.entries(a.bySection).map(([sec, v]) => (
                <Badge key={sec} color={`var(--sec-${sec})`} className="tabular-nums">
                  {SECTION_LABEL_AR[sec] ?? sec} {v.pct.toFixed(0)}%
                </Badge>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
});

function Sparkline({ attempts }: { attempts: AttemptSummary[] }) {
  const W = 560;
  const H = 120;
  const PAD = 14;

  // Fixed 20-100 domain: the STEP scale, not the data range.
  const y = (score: number) =>
    H - PAD - ((Math.max(20, Math.min(100, score)) - 20) / 80) * (H - PAD * 2);
  const x = (i: number) =>
    PAD + (attempts.length === 1 ? (W - PAD * 2) / 2 : (i / (attempts.length - 1)) * (W - PAD * 2));

  const points = attempts.map((a, i) => `${x(i)},${y(a.estimatedStep)}`).join(' ');

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-[120px] w-full min-w-[320px]"
        role="img"
        aria-label={`تطوّر الدرجة عبر ${attempts.length} محاولات: ${attempts.map((a) => a.estimatedStep).join('، ')}`}
      >
        {[20, 40, 60, 80, 100].map((v) => (
          <g key={v}>
            <line
              x1={PAD} x2={W - PAD} y1={y(v)} y2={y(v)}
              className="stroke-black/[0.07] dark:stroke-white/[0.09]"
              strokeWidth="1"
            />
            <text
              x={W - PAD + 2} y={y(v) + 3}
              className="fill-current text-[9px] opacity-40"
            >
              {v}
            </text>
          </g>
        ))}

        <polyline
          points={points}
          fill="none"
          stroke="var(--app-brand)"
          strokeWidth="2.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {attempts.map((a, i) => (
          <circle
            key={a.id}
            cx={x(i)} cy={y(a.estimatedStep)} r="4.5"
            fill="var(--app-brand)"
            stroke="var(--app-surface)"
            strokeWidth="2"
          />
        ))}
      </svg>
    </div>
  );
}
