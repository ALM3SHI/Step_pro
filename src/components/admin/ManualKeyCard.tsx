'use client';

import { memo } from 'react';
import type { OptionKey } from '@/lib/ingestion/fastkey';

export interface ManualKeyQuestion {
  ref: string;
  questionText: string;
  options: Partial<Record<OptionKey, string>>;
  correctOption?: OptionKey;
  explanationAr?: string;
  /** Set when a Fast-Key paste filled this in, rather than a human click. */
  source?: 'fastkey' | 'manual';
}

export interface ManualKeyCardProps {
  index: number;
  question: ManualKeyQuestion;
  included: boolean;
  onToggleInclude: () => void;
  onSetOption: (option: OptionKey) => void;
  onSetExplanation: (text: string) => void;
}

const ORDER: OptionKey[] = ['A', 'B', 'C', 'D'];

/**
 * A staged question with clickable answer keys.
 *
 * The whole row is the click target, not just the radio — at 100
 * questions the difference between a 20px and a 400px target is minutes
 * of work and a lot of misclicks.
 *
 * A card with no key set is visually loud (amber rail): the failure mode
 * to prevent is saving a batch where a handful of questions quietly have
 * no answer.
 */
export const ManualKeyCard = memo(function ManualKeyCard({
  index,
  question: q,
  included,
  onToggleInclude,
  onSetOption,
  onSetExplanation,
}: ManualKeyCardProps) {
  const keys = ORDER.filter((k) => q.options[k]?.trim());
  const unset = !q.correctOption;

  return (
    <article
      className={`glass rounded-2xl p-5 transition-opacity ${included ? '' : 'opacity-45'} ${
        unset ? 'border-r-4 border-r-amber-500' : 'border-r-4 border-r-emerald-500'
      }`}
    >
      <header className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-sm font-bold tabular-nums text-[color:var(--app-muted)]">#{index + 1}</span>

        {q.correctOption ? (
          <span className="rounded-full bg-emerald-500/15 px-3 py-0.5 text-xs font-bold text-emerald-700 dark:text-emerald-300">
            الإجابة {q.correctOption}
            {q.source === 'fastkey' && <span className="mr-1 opacity-70">· تلقائي</span>}
          </span>
        ) : (
          <span className="rounded-full bg-amber-500/20 px-3 py-0.5 text-xs font-bold text-amber-800 dark:text-amber-200">
            لم تُحدَّد الإجابة
          </span>
        )}

        <span className="flex-1" />

        <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold">
          <input type="checkbox" checked={included} onChange={onToggleInclude} className="h-4 w-4 accent-emerald-600" />
          إدراج
        </label>
      </header>

      <p dir="ltr" className="mb-3 text-left font-serif text-[1.02rem] font-semibold">
        {q.questionText}
      </p>

      <div role="radiogroup" aria-label={`الإجابة الصحيحة للسؤال ${index + 1}`} className="mb-3 space-y-1.5">
        {keys.map((k) => {
          const selected = q.correctOption === k;
          return (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onSetOption(k)}
              dir="ltr"
              className={`flex w-full items-start gap-3 rounded-xl px-3 py-2 text-left font-serif text-[0.97rem] transition-colors ${
                selected
                  ? 'bg-emerald-500/15 font-semibold text-emerald-800 dark:text-emerald-200'
                  : 'bg-black/[0.03] hover:bg-black/[0.06] dark:bg-white/[0.04] dark:hover:bg-white/[0.08]'
              }`}
            >
              <span
                aria-hidden
                className={`mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border-2 ${
                  selected ? 'border-emerald-600 bg-emerald-600' : 'border-[color:var(--app-line)]'
                }`}
              >
                {selected && <span className="h-2 w-2 rounded-full bg-white" />}
              </span>
              <span className="min-w-[18px] font-bold">{k}</span>
              <span className="flex-1">{q.options[k]}</span>
            </button>
          );
        })}
      </div>

      <textarea
        defaultValue={q.explanationAr ?? ''}
        onBlur={(e) => onSetExplanation(e.target.value)}
        dir="rtl"
        rows={2}
        placeholder="الشرح بالعربية (اختياري)"
        className="w-full rounded-xl border border-[color:var(--app-line)] bg-transparent p-3 text-sm"
      />
    </article>
  );
});
