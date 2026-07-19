'use client';

import { memo } from 'react';
import type { Insight, StudyPlan } from '@/lib/exam/insights';

const KIND_STYLE: Record<Insight['kind'], { icon: string; ring: string }> = {
  strength: { icon: '★', ring: 'border-r-emerald-500' },
  weakness: { icon: '!', ring: 'border-r-red-500' },
  pace: { icon: '⏱', ring: 'border-r-amber-500' },
  behaviour: { icon: '◆', ring: 'border-r-sky-500' },
};

/**
 * Observed patterns.
 *
 * Every item shows the numbers it came from. An analytics claim a
 * learner cannot check is a claim they either over-trust or ignore, and
 * both are worse than a visible "3 of 8 correct" beside the sentence.
 */
export const InsightsPanel = memo(function InsightsPanel({
  insights,
}: {
  insights: Insight[];
}) {
  return (
    <section className="glass rounded-2xl p-6" aria-labelledby="insights-title">
      <h2 id="insights-title" className="mb-1 text-lg font-bold">ما لاحظناه في أدائك</h2>

      {insights.length === 0 ? (
        <p className="mt-3 rounded-xl bg-black/[0.04] px-4 py-4 text-sm leading-[1.9] text-[color:var(--app-muted)] dark:bg-white/[0.05]">
          لا توجد أنماط واضحة في هذه المحاولة. عدد الأسئلة في كل مهارة غير كافٍ
          لاستنتاج شيء موثوق — أكمل اختبارًا كاملًا آخر وستظهر الأنماط.
        </p>
      ) : (
        <>
          <p className="mb-4 text-sm text-[color:var(--app-muted)]">
            كل ملاحظة مبنية على أرقام فعلية من محاولتك، وليست تقديرًا.
          </p>
          <ul className="space-y-2.5">
            {insights.map((ins, i) => {
              const s = KIND_STYLE[ins.kind];
              return (
                <li
                  key={i}
                  className={`rounded-xl border-r-4 bg-black/[0.03] px-4 py-3 dark:bg-white/[0.04] ${s.ring}`}
                >
                  <p className="text-[0.97rem] leading-[1.8]">
                    <span aria-hidden className="ml-1.5 opacity-60">{s.icon}</span>
                    {ins.text}
                  </p>
                  <p className="mt-1 text-xs tabular-nums text-[color:var(--app-muted)]">
                    {ins.evidence}
                  </p>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
});

export const StudyPlanPanel = memo(function StudyPlanPanel({
  plan,
  onPractice,
}: {
  plan: StudyPlan;
  onPractice?: (section: string, count: number) => void;
}) {
  return (
    <section className="glass rounded-2xl p-6" aria-labelledby="plan-title">
      <h2 id="plan-title" className="mb-1 text-lg font-bold">{plan.headline}</h2>
      <p className="mb-4 text-xs text-[color:var(--app-muted)]">{plan.basedOn}</p>

      {plan.tasks.length === 0 ? (
        <p className="rounded-xl bg-black/[0.04] px-4 py-4 text-sm text-[color:var(--app-muted)] dark:bg-white/[0.05]">
          لا توجد بيانات كافية لبناء خطة.
        </p>
      ) : (
        <ol className="space-y-2.5">
          {plan.tasks.map((t, i) => (
            <li
              key={i}
              className="flex flex-wrap items-center gap-3 rounded-xl bg-black/[0.03] px-4 py-3 dark:bg-white/[0.04]"
            >
              <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-[color:var(--app-brand)] text-xs font-bold text-white">
                {i + 1}
              </span>
              <span className="min-w-0 flex-1">
                <b className="block text-[0.97rem]">{t.label}</b>
                <span className="text-xs text-[color:var(--app-muted)]">{t.detail}</span>
              </span>
              {onPractice && t.section && (
                <button
                  type="button"
                  onClick={() => onPractice(t.section!, t.questionCount ?? 10)}
                  className="rounded-lg bg-[color:var(--app-accent)] px-4 py-1.5 text-xs font-bold text-[#221503]"
                >
                  ابدأ التدريب
                </button>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
});
