'use client';

import { memo } from 'react';
import { SECTION_LABEL_AR, STATUS } from './palette';
import { Alert, Card, Meter, SectionTitle } from '@/components/ui';
import type { SkillScore } from '@/lib/exam/scoring';

/**
 * Per-skill accuracy — the layer the study plan is built on.
 *
 * Skills with fewer than 3 attempts are shown but visually de-emphasised
 * and never called a weakness: 0/1 is noise, and telling a learner to go
 * study a topic on that evidence wastes their time.
 */
export const SkillBreakdown = memo(function SkillBreakdown({
  skills,
  weakest,
}: {
  skills: SkillScore[];
  weakest: SkillScore[];
}) {
  if (!skills.length) return null;

  const weakIds = new Set(weakest.map((s) => s.skillId));

  return (
    <Card className="p-6" aria-labelledby="skills-title">
      <SectionTitle id="skills-title" hint="مرتّبة من الأضعف. المهارات ذات المحاولات القليلة غير كافية للحكم.">
        تحليل المهارات
      </SectionTitle>

      {weakest.length > 0 && (
        <div className="mb-5">
          <Alert tone="warn">
            <b className="mb-1 block">ابدأ من هنا</b>
            <ul className="space-y-0.5">
              {weakest.map((s) => (
                <li key={s.skillId}>
                  {s.nameAr} — {s.correct}/{s.total} ({s.accuracyPct.toFixed(0)}%)
                </li>
              ))}
            </ul>
          </Alert>
        </div>
      )}

      <ul className="space-y-2.5">
        {skills.map((s) => {
          const thin = s.total < 3;
          const tone = thin
            ? 'var(--app-muted)'
            : s.accuracyPct >= 75 ? STATUS.good
              : s.accuracyPct >= 50 ? STATUS.warning
                : STATUS.critical;

          return (
            <li key={s.skillId} className={thin ? 'opacity-55' : ''}>
              <div className="mb-1 flex items-baseline gap-2 text-sm">
                <span className={weakIds.has(s.skillId) ? 'font-bold' : ''}>{s.nameAr}</span>
                <span className="text-xs text-[color:var(--app-muted)]">
                  {SECTION_LABEL_AR[s.section]}
                </span>
                <span className="flex-1" />
                <b className="tabular-nums">{s.accuracyPct.toFixed(0)}%</b>
                <span className="text-xs tabular-nums text-[color:var(--app-muted)]">
                  {s.correct}/{s.total}
                </span>
                {thin && <span className="text-[0.65rem] text-[color:var(--app-muted)]">عينة صغيرة</span>}
              </div>
              <Meter
                value={s.accuracyPct}
                color={tone}
                label={`${s.nameAr}: ${s.accuracyPct.toFixed(0)} بالمئة، ${s.correct} من ${s.total}`}
              />
            </li>
          );
        })}
      </ul>
    </Card>
  );
});
