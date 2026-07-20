'use client';

import { memo, useState } from 'react';
import { SECTION_LABEL_AR, STATUS } from './palette';
import { Badge, Button, Card, Delta, EmptyState, Meter, SectionTitle } from '@/components/ui';
import type { SkillTrend } from '@/app/actions/analytics';

const MASTERY_LABEL: Record<SkillTrend['mastery'], string> = {
  strong: 'متقن',
  developing: 'قيد التحسّن',
  weak: 'يحتاج عملًا',
};

const MASTERY_TONE: Record<SkillTrend['mastery'], string> = {
  strong: STATUS.good,
  developing: STATUS.warning,
  weak: STATUS.critical,
};

/** Fewer attempts than this and the percentage is noise. */
const RELIABLE_SAMPLE = 4;

/**
 * The 27 skills, ranked weakest first.
 *
 * Two things are deliberately withheld: a mastery verdict on a skill
 * with fewer than four attempts, and a direction arrow when there is
 * only one sitting to look at. Both would be inventing certainty the
 * data does not carry.
 */
export const SkillTrendTable = memo(function SkillTrendTable({
  skills,
  hasTrend,
}: {
  skills: SkillTrend[];
  hasTrend: boolean;
}) {
  const [showAll, setShowAll] = useState(false);

  if (!skills.length) {
    return (
      <Card className="p-6">
        <SectionTitle>تحليل المهارات</SectionTitle>
        <EmptyState icon="🧭" title="لم تُسجَّل نتائج مهارات بعد" />
      </Card>
    );
  }

  const reliable = skills.filter((s) => s.attempted >= RELIABLE_SAMPLE);
  const thin = skills.filter((s) => s.attempted < RELIABLE_SAMPLE);
  const visible = showAll ? skills : reliable.slice(0, 10);

  return (
    <Card className="p-6" aria-labelledby="skills-title">
      <SectionTitle
        id="skills-title"
        hint={`مرتّبة من الأضعف. المهارات ذات المحاولات القليلة معروضة دون حكم. ${reliable.length} مهارة بعينة كافية من أصل 27.`}
      >
        تحليل المهارات
      </SectionTitle>

      <ul className="space-y-3">
        {visible.map((s) => {
          const isThin = s.attempted < RELIABLE_SAMPLE;
          const tone = isThin ? 'var(--app-muted)' : MASTERY_TONE[s.mastery];

          return (
            <li key={s.skillId} className={isThin ? 'opacity-55' : ''}>
              <div className="mb-1 flex flex-wrap items-baseline gap-2 text-sm">
                <b>{s.nameAr}</b>
                <span className="text-xs text-[color:var(--app-muted)]">
                  {SECTION_LABEL_AR[s.section] ?? s.section}
                </span>

                {!isThin && <Badge color={tone}>{MASTERY_LABEL[s.mastery]}</Badge>}

                {/* Direction only when there is a second sitting to compare. */}
                {hasTrend && s.deltaPct !== null && Math.abs(s.deltaPct) >= 10 && (
                  <Delta value={s.deltaPct} suffix="%" />
                )}

                <span className="flex-1" />
                <b className="tabular-nums">{s.accuracyPct.toFixed(0)}%</b>
                <span className="text-xs tabular-nums text-[color:var(--app-muted)]">
                  {s.correct}/{s.attempted}
                </span>
                {s.avgSeconds !== null && (
                  <span className="text-xs tabular-nums text-[color:var(--app-muted)]">
                    · {Math.round(s.avgSeconds)} ث
                  </span>
                )}
                {isThin && (
                  <span className="text-[0.62rem] text-[color:var(--app-muted)]">عينة صغيرة</span>
                )}
              </div>

              <Meter
                value={s.accuracyPct}
                color={tone}
                label={`${s.nameAr}: ${s.accuracyPct.toFixed(0)} بالمئة، ${s.correct} من ${s.attempted}`}
              />
            </li>
          );
        })}
      </ul>

      {!showAll && (reliable.length > 10 || thin.length > 0) && (
        <Button block className="mt-4" onClick={() => setShowAll(true)}>
          عرض كل المهارات ({skills.length})
        </Button>
      )}
    </Card>
  );
});
