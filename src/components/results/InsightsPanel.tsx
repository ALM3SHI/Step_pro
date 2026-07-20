'use client';

import { memo } from 'react';
import { Alert, Button, Card, SectionTitle } from '@/components/ui';
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
    <Card className="p-6" aria-labelledby="insights-title">
      {insights.length === 0 ? (
        <>
          <SectionTitle id="insights-title">ما لاحظناه في أدائك</SectionTitle>
          <Alert>
            لا توجد أنماط واضحة في هذه المحاولة. عدد الأسئلة في كل مهارة غير كافٍ
            لاستنتاج شيء موثوق — أكمل اختبارًا كاملًا آخر وستظهر الأنماط.
          </Alert>
        </>
      ) : (
        <>
          <SectionTitle id="insights-title" hint="كل ملاحظة مبنية على أرقام فعلية من محاولتك، وليست تقديرًا.">
            ما لاحظناه في أدائك
          </SectionTitle>
          <ul className="stagger space-y-2.5">
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
    </Card>
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
    <Card className="p-6" aria-labelledby="plan-title">
      <SectionTitle id="plan-title" hint={plan.basedOn}>{plan.headline}</SectionTitle>

      {plan.tasks.length === 0 ? (
        <Alert>لا توجد بيانات كافية لبناء خطة.</Alert>
      ) : (
        <ol className="stagger space-y-2.5">
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
                <Button
                  variant="accent"
                  size="sm"
                  onClick={() => onPractice(t.section!, t.questionCount ?? 10)}
                >
                  ابدأ التدريب
                </Button>
              )}
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
});
