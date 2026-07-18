'use client';

import { memo } from 'react';
import { SECTION_LABEL_AR, STATUS } from './palette';
import type { analyzeTime } from '@/lib/exam/engine';

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

/**
 * Time used against the Qiyas allocation, per part.
 *
 * The useful signal is not raw minutes but the RATIO: a part that hit
 * 100% because the clock expired is a very different diagnosis from one
 * finished in half the time, and both look similar as bare durations.
 */
export const TimeAnalysis = memo(function TimeAnalysis({
  analysis,
}: {
  analysis: ReturnType<typeof analyzeTime>;
}) {
  if (!analysis.parts.length) return null;

  const overall = analysis.totalAllocated
    ? (analysis.totalUsed / analysis.totalAllocated) * 100
    : 0;

  return (
    <section className="glass rounded-2xl p-6" aria-labelledby="time-title">
      <div className="mb-5 flex flex-wrap items-baseline gap-3">
        <h2 id="time-title" className="text-lg font-bold">إدارة الوقت</h2>
        <span className="flex-1" />
        <span className="text-sm text-[color:var(--app-muted)]">
          استخدمت <b className="tabular-nums text-[color:var(--app-ink)]">{clock(analysis.totalUsed)}</b> من{' '}
          <b className="tabular-nums text-[color:var(--app-ink)]">{clock(analysis.totalAllocated)}</b>{' '}
          ({overall.toFixed(0)}%)
        </span>
      </div>

      <div className="space-y-3">
        {analysis.parts.map((p) => {
          const tone = p.expired ? STATUS.critical : p.usagePct > 85 ? STATUS.warning : STATUS.good;
          return (
            <div key={p.partIndex}>
              <div className="mb-1 flex items-baseline gap-2 text-sm">
                <span className="font-semibold">
                  {SECTION_LABEL_AR[p.section] ?? p.section}
                  <span className="mr-1 text-xs text-[color:var(--app-muted)]"> — جزء {p.partNo}</span>
                </span>
                <span className="flex-1" />
                {p.expired && (
                  <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[0.7rem] font-bold text-red-700 dark:text-red-300">
                    انتهى الوقت
                  </span>
                )}
                <span className="tabular-nums text-xs text-[color:var(--app-muted)]">
                  {clock(p.usedSeconds)} / {clock(p.allocatedSeconds)}
                </span>
                <b className="tabular-nums">{p.usagePct.toFixed(0)}%</b>
              </div>

              <div
                className="h-2 w-full overflow-hidden rounded-full bg-black/[0.07] dark:bg-white/[0.09]"
                role="img"
                aria-label={`${SECTION_LABEL_AR[p.section]} جزء ${p.partNo}: استخدمت ${clock(p.usedSeconds)} من ${clock(p.allocatedSeconds)}${p.expired ? '، انتهى الوقت' : ''}`}
              >
                <div
                  className="h-full rounded-full transition-[width] duration-700 ease-out"
                  style={{ width: `${Math.max(1.5, Math.min(100, p.usagePct))}%`, background: tone }}
                />
              </div>

              <p className="mt-1 text-[0.7rem] text-[color:var(--app-muted)]">
                {p.questionCount} سؤال · {p.secondsPerQuestion.toFixed(0)} ثانية للسؤال
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
});
