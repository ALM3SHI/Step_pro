'use client';

import { useState } from 'react';
import type { StagedQuestion } from '@/app/admin/actions';

const CATEGORY_STYLE: Record<string, string> = {
  grammar: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  reading: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  listening: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  writing: 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
};

export interface QuickReviewCardProps {
  index: number;
  question: StagedQuestion;
  included: boolean;
  onToggle: () => void;
  onEdit: (patch: Partial<StagedQuestion>) => void;
}

/**
 * One staged question, built for scanning at a glance ("شوفة سريعة").
 *
 * Anything the solver flagged gets an amber rail and its reasons shown
 * inline — the whole point of review is to make the ~2% that need a human
 * findable without reading the 98% that don't.
 */
export function QuickReviewCard({ index, question: q, included, onToggle, onEdit }: QuickReviewCardProps) {
  const [editing, setEditing] = useState(false);
  const keys = Object.keys(q.options).filter((k) => q.options[k]?.trim()).sort();

  return (
    <article
      className={`glass rounded-2xl p-5 transition-opacity ${included ? '' : 'opacity-45'} ${
        q.needsHumanReview ? 'border-l-4 border-l-amber-500' : ''
      }`}
    >
      <header className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-sm font-bold tabular-nums text-[color:var(--app-muted)]">#{index + 1}</span>

        <span className={`rounded-full px-3 py-0.5 text-xs font-bold ${CATEGORY_STYLE[q.category] ?? ''}`}>
          {q.category}
        </span>

        <span
          className={`rounded-full px-3 py-0.5 text-xs font-bold tabular-nums ${
            q.consensusRatio === 1 ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
              : 'bg-amber-500/20 text-amber-800 dark:text-amber-200'
          }`}
          title="Share of self-consistency voters that agreed"
        >
          إجماع {Math.round(q.consensusRatio * 100)}%
        </span>

        <span className="text-xs text-[color:var(--app-muted)]" title="Line in the original paste">
          سطر {q.sourceLine}
        </span>

        <span className="flex-1" />

        <button
          type="button"
          onClick={() => setEditing((v) => !v)}
          className="rounded-lg border border-[color:var(--app-line)] px-3 py-1 text-xs font-semibold"
        >
          {editing ? 'إغلاق' : 'تعديل'}
        </button>

        <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold">
          <input type="checkbox" checked={included} onChange={onToggle} className="h-4 w-4 accent-emerald-600" />
          إدراج
        </label>
      </header>

      {q.needsHumanReview && (
        <ul className="mb-3 space-y-1 rounded-xl bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
          {q.reviewReasons.map((r, i) => <li key={i}>⚠ {r}</li>)}
        </ul>
      )}

      {editing ? (
        <textarea
          defaultValue={q.questionText}
          onBlur={(e) => onEdit({ questionText: e.target.value })}
          dir="ltr"
          className="mb-3 w-full rounded-xl border border-[color:var(--app-line)] bg-transparent p-3 text-left font-serif"
          rows={3}
        />
      ) : (
        <p dir="ltr" className="mb-3 text-left font-serif text-[1.02rem] font-semibold">{q.questionText}</p>
      )}

      <ul className="mb-3 space-y-1.5">
        {keys.map((k) => {
          const correct = k === q.correctOption;
          return (
            <li
              key={k}
              dir="ltr"
              className={`flex items-start gap-3 rounded-xl px-3 py-2 text-left font-serif text-[0.97rem] ${
                correct ? 'bg-emerald-500/15 font-semibold text-emerald-800 dark:text-emerald-200' : 'bg-black/[0.03] dark:bg-white/[0.04]'
              }`}
            >
              <button
                type="button"
                onClick={() => onEdit({ correctOption: k })}
                title="اجعل هذا هو الجواب الصحيح"
                className={`min-w-[22px] font-bold ${correct ? 'text-emerald-700 dark:text-emerald-300' : 'text-[color:var(--app-muted)]'}`}
              >
                {k}
              </button>
              <span>{q.options[k]}</span>
              {correct && <span className="ml-auto text-xs">✓</span>}
            </li>
          );
        })}
      </ul>

      {editing ? (
        <textarea
          defaultValue={q.explanationAr}
          onBlur={(e) => onEdit({ explanationAr: e.target.value })}
          dir="rtl"
          className="w-full rounded-xl border border-[color:var(--app-line)] bg-transparent p-3"
          rows={4}
        />
      ) : (
        <p dir="rtl" className="rounded-xl bg-black/[0.03] px-4 py-3 text-[0.95rem] leading-[1.9] dark:bg-white/[0.04]">
          {q.explanationAr}
        </p>
      )}
    </article>
  );
}
