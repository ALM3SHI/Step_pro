'use client';

import { memo, useMemo } from 'react';
import { bandFor, STATUS } from './palette';
import { Alert, Card, Stat } from '@/components/ui';
import type { AttemptSummary } from '@/app/actions/analytics';

/**
 * The learner's current standing.
 *
 * Direction is only claimed when there is more than one attempt AND the
 * change clears a threshold — a 1-point move between two sittings is
 * noise, and telling someone they are "improving" on that basis is a
 * fabrication dressed as encouragement.
 */
export const LevelCard = memo(function LevelCard({
  attempts,
  hasTrend,
}: {
  attempts: AttemptSummary[];
  hasTrend: boolean;
}) {
  // Newest first.
  const latest = attempts[0];
  const band = bandFor(latest.weightedScore);
  const tone = STATUS[band.tone];

  const trend = useMemo(() => {
    if (!hasTrend || attempts.length < 2) return null;
    const delta = latest.estimatedStep - attempts[1].estimatedStep;
    // Below 3 scale points, the estimate's own uncertainty is larger
    // than the movement.
    if (Math.abs(delta) < 3) {
      return { label: 'مستقر', detail: 'لا تغيّر يُذكر عن المحاولة السابقة', tone: 'flat' as const };
    }
    return delta > 0
      ? { label: `+${delta}`, detail: 'تحسّن عن المحاولة السابقة', tone: 'up' as const }
      : { label: String(delta), detail: 'انخفاض عن المحاولة السابقة', tone: 'down' as const };
  }, [attempts, hasTrend, latest]);

  const best = useMemo(
    () => attempts.reduce((m, a) => (a.estimatedStep > m.estimatedStep ? a : m), latest),
    [attempts, latest],
  );

  return (
    <Card className="p-6" aria-labelledby="level-title">
      <div className="flex flex-wrap items-start gap-6">
        <div>
          <p className="text-xs text-[color:var(--app-muted)]">مستواك الحالي</p>
          <div className="flex items-baseline gap-2">
            <b className="text-5xl font-extrabold tabular-nums leading-none" style={{ color: tone }}>
              {latest.estimatedStep}
            </b>
            <span className="text-sm text-[color:var(--app-muted)]">/ 100</span>
          </div>
          <h2 id="level-title" className="mt-1 text-sm font-bold" style={{ color: tone }}>
            {band.label}
          </h2>
        </div>

        <div className="flex flex-wrap gap-2 [&>*]:min-w-[104px]">
          {trend && (
            <Stat
              label="الاتجاه"
              value={trend.label}
              hint={trend.detail}
              tone={trend.tone === 'up' ? 'good' : trend.tone === 'down' ? 'bad' : undefined}
            />
          )}
          <Stat label="أفضل نتيجة" value={String(best.estimatedStep)} />
          <Stat label="عدد المحاولات" value={String(attempts.length)} />
        </div>
      </div>

      {!hasTrend && (
        <div className="mt-4">
          <Alert>
            هذه محاولتك الأولى، فلا يوجد اتجاه بعد. أكمل محاولة ثانية وسيظهر هنا هل أداؤك
            يتحسّن أم ينخفض، ولكل مهارة على حدة.
          </Alert>
        </div>
      )}
    </Card>
  );
});
