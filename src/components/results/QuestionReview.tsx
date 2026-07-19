'use client';

import { memo, useMemo, useState } from 'react';
import { SECTION_LABEL_AR } from './palette';
import type { ReviewRow } from '@/lib/exam/scoring';

type Filter = 'all' | 'wrong' | 'skipped' | 'flagged';

const ORDER = ['A', 'B', 'C', 'D'] as const;

/**
 * Post-exam question review.
 *
 * Defaults to the WRONG filter. After a 40-question exam the learning is
 * concentrated in the handful missed; opening on "all" buries it and the
 * explanations go unread.
 */
export const QuestionReview = memo(function QuestionReview({
  rows,
  secondsPerQuestion = {},
}: {
  rows: ReviewRow[];
  /** Averaged across a screen when several questions share one. */
  secondsPerQuestion?: Record<string, number>;
}) {
  const [filter, setFilter] = useState<Filter>('wrong');
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const counts = useMemo(() => ({
    all: rows.length,
    wrong: rows.filter((r) => r.answered && !r.isCorrect).length,
    skipped: rows.filter((r) => !r.answered).length,
    flagged: rows.filter((r) => r.flagged).length,
  }), [rows]);

  const visible = useMemo(() => {
    switch (filter) {
      case 'wrong': return rows.filter((r) => r.answered && !r.isCorrect);
      case 'skipped': return rows.filter((r) => !r.answered);
      case 'flagged': return rows.filter((r) => r.flagged);
      default: return rows;
    }
  }, [rows, filter]);

  const TABS: Array<[Filter, string]> = [
    ['wrong', 'أخطأت فيها'],
    ['skipped', 'لم تُجب'],
    ['flagged', 'المعلَّمة'],
    ['all', 'الكل'],
  ];

  return (
    <section className="glass rounded-2xl p-6" aria-labelledby="review-title">
      <h2 id="review-title" className="mb-1 text-lg font-bold">مراجعة الأسئلة</h2>
      <p className="mb-4 text-sm text-[color:var(--app-muted)]">
        اضغط على أي سؤال لعرض الشرح بالعربية.
      </p>

      <div className="mb-5 flex flex-wrap gap-2">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            disabled={counts[key] === 0}
            className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-colors disabled:opacity-40 ${
              filter === key
                ? 'bg-[color:var(--app-brand)] text-white'
                : 'border border-[color:var(--app-line)]'
            }`}
          >
            {label} ({counts[key]})
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <p className="rounded-xl bg-emerald-500/10 px-4 py-6 text-center text-emerald-700 dark:text-emerald-300">
          لا توجد أسئلة في هذا التصنيف 🎉
        </p>
      ) : (
        <ul className="space-y-3">
          {visible.map((r) => (
            <ReviewItem
              key={r.id}
              row={r}
              seconds={secondsPerQuestion[r.id]}
              expanded={Boolean(open[r.id])}
              onToggle={() => setOpen((o) => ({ ...o, [r.id]: !o[r.id] }))}
            />
          ))}
        </ul>
      )}
    </section>
  );
});

function ReviewItem({
  row,
  seconds,
  expanded,
  onToggle,
}: {
  row: ReviewRow;
  seconds?: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const keys = ORDER.filter((k) => row.options[k]?.trim());

  const rail = row.isCorrect
    ? 'border-r-emerald-500'
    : row.answered
      ? 'border-r-red-500'
      : 'border-r-slate-400';

  return (
    <li className={`rounded-xl border-r-4 bg-black/[0.03] dark:bg-white/[0.04] ${rail}`}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full items-start gap-3 p-4 text-right"
      >
        <span className="mt-0.5 flex-shrink-0 text-sm">
          {row.isCorrect ? '✅' : row.answered ? '❌' : '⭕'}
        </span>
        <span className="min-w-0 flex-1">
          <span className="mb-1 flex flex-wrap items-center gap-2 text-xs text-[color:var(--app-muted)]">
            <span className="font-bold">سؤال {row.number}</span>
            <span>{SECTION_LABEL_AR[row.section] ?? row.section}</span>
            <span>· {row.skillNameAr}</span>
            {seconds !== undefined && seconds > 0 && (
              <span className="tabular-nums">· {Math.round(seconds)} ث</span>
            )}
            {row.flagged && <span className="text-amber-600 dark:text-amber-400">⚑ معلَّم</span>}
            {!row.answered && <span className="text-slate-500">لم تُجب</span>}
          </span>
          <span dir="ltr" className="block text-left font-serif text-[0.98rem] font-semibold">
            {row.questionText}
          </span>
        </span>
        <span className="mt-0.5 flex-shrink-0 text-xs text-[color:var(--app-muted)]">
          {expanded ? '▲' : '▼'}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-[color:var(--app-line)] px-4 pb-4 pt-3">
          {row.imageUrl && (
            <figure className="mb-3">
              <img src={row.imageUrl} alt={row.imageAlt ?? ''} className="max-w-full rounded-lg border border-[color:var(--app-line)] bg-white" />
            </figure>
          )}

          {row.passageText && (
            <details className="mb-3">
              <summary className="cursor-pointer text-xs font-semibold text-[color:var(--app-muted)]">
                عرض النص
              </summary>
              <p dir="ltr" className="mt-2 whitespace-pre-line rounded-lg bg-black/[0.03] p-3 text-left font-serif text-sm leading-[1.85] dark:bg-white/[0.04]">
                {row.passageText}
              </p>
            </details>
          )}

          <ul className="mb-3 space-y-1.5">
            {keys.map((k) => {
              const isCorrect = k === row.correct;
              const isChosen = k === row.chosen;
              return (
                <li
                  key={k}
                  dir="ltr"
                  className={`flex items-start gap-3 rounded-lg px-3 py-2 text-left font-serif text-[0.95rem] ${
                    isCorrect
                      ? 'bg-emerald-500/15 font-semibold text-emerald-800 dark:text-emerald-200'
                      : isChosen
                        ? 'bg-red-500/15 text-red-800 dark:text-red-200'
                        : ''
                  }`}
                >
                  <span className="min-w-[20px] font-bold">{k}</span>
                  <span className="flex-1">{row.options[k]}</span>
                  {/* Icon + text, never colour alone. */}
                  {isCorrect && <span className="text-xs whitespace-nowrap">✓ الصحيحة</span>}
                  {isChosen && !isCorrect && <span className="text-xs whitespace-nowrap">✗ إجابتك</span>}
                </li>
              );
            })}
          </ul>

          {row.explanationAr ? (
            <div dir="rtl" className="rounded-xl bg-[color:var(--app-brand)]/10 px-4 py-3 text-[0.95rem] leading-[1.9]">
              <b className="mb-1 block text-sm text-[color:var(--app-brand)]">الشرح</b>
              {row.explanationAr}
            </div>
          ) : (
            <p className="text-xs text-[color:var(--app-muted)]">لا يوجد شرح متاح لهذا السؤال بعد.</p>
          )}
        </div>
      )}
    </li>
  );
}
