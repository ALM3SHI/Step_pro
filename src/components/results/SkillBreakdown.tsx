'use client';

import { memo } from 'react';
import { SECTION_LABEL_AR, STATUS } from './palette';
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
    <section className="glass rounded-2xl p-6" aria-labelledby="skills-title">
      <h2 id="skills-title" className="mb-1 text-lg font-bold">تحليل المهارات</h2>
      <p className="mb-5 text-sm text-[color:var(--app-muted)]">
        مرتّبة من الأضعف. المهارات ذات المحاولات القليلة غير كافية للحكم.
      </p>

      {weakest.length > 0 && (
        <div className="mb-5 rounded-xl bg-amber-500/10 px-4 py-3">
          <b className="mb-1 block text-sm text-amber-900 dark:text-amber-200">
            ابدأ من هنا
          </b>
          <ul className="space-y-0.5 text-sm text-amber-900 dark:text-amber-200">
            {weakest.map((s) => (
              <li key={s.skillId}>
                {s.nameAr} — {s.correct}/{s.total} ({s.accuracyPct.toFixed(0)}%)
              </li>
            ))}
          </ul>
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
              <div
                className="h-2 w-full overflow-hidden rounded-full bg-black/[0.07] dark:bg-white/[0.09]"
                role="img"
                aria-label={`${s.nameAr}: ${s.accuracyPct.toFixed(0)} بالمئة، ${s.correct} من ${s.total}`}
              >
                <div
                  className="h-full rounded-full transition-[width] duration-700 ease-out"
                  style={{ width: `${Math.max(1.5, s.accuracyPct)}%`, background: tone }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
});
