'use client';

import { memo, useState } from 'react';
import { SECTION_LABEL_AR, STATUS } from './palette';
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
      <section className="glass rounded-2xl p-6">
        <h2 className="mb-2 text-lg font-bold">تحليل المهارات</h2>
        <p className="text-sm text-[color:var(--app-muted)]">
          لم تُسجَّل نتائج مهارات بعد.
        </p>
      </section>
    );
  }

  const reliable = skills.filter((s) => s.attempted >= RELIABLE_SAMPLE);
  const thin = skills.filter((s) => s.attempted < RELIABLE_SAMPLE);
  const visible = showAll ? skills : reliable.slice(0, 10);

  return (
    <section className="glass rounded-2xl p-6" aria-labelledby="skills-title">
      <div className="mb-1 flex flex-wrap items-baseline gap-2">
        <h2 id="skills-title" className="text-lg font-bold">تحليل المهارات</h2>
        <span className="text-xs text-[color:var(--app-muted)]">
          {reliable.length} مهارة بعينة كافية من أصل 27
        </span>
      </div>
      <p className="mb-5 text-sm text-[color:var(--app-muted)]">
        مرتّبة من الأضعف. المهارات ذات المحاولات القليلة معروضة دون حكم.
      </p>

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

                {!isThin && (
                  <span
                    className="rounded-full px-2 py-0.5 text-[0.65rem] font-bold"
                    style={{ background: `${tone}22`, color: tone }}
                  >
                    {MASTERY_LABEL[s.mastery]}
                  </span>
                )}

                {/* Direction only when there is a second sitting to compare. */}
                {hasTrend && s.deltaPct !== null && Math.abs(s.deltaPct) >= 10 && (
                  <span
                    className={`text-xs font-bold tabular-nums ${
                      s.deltaPct > 0
                        ? 'text-emerald-700 dark:text-emerald-300'
                        : 'text-red-700 dark:text-red-300'
                    }`}
                  >
                    {s.deltaPct > 0 ? '▲' : '▼'} {Math.abs(s.deltaPct)}%
                  </span>
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

              <div
                className="h-2 w-full overflow-hidden rounded-full bg-black/[0.07] dark:bg-white/[0.09]"
                role="img"
                aria-label={`${s.nameAr}: ${s.accuracyPct.toFixed(0)} بالمئة، ${s.correct} من ${s.attempted}`}
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

      {!showAll && (reliable.length > 10 || thin.length > 0) && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="mt-4 w-full rounded-xl border border-[color:var(--app-line)] py-2 text-sm font-semibold"
        >
          عرض كل المهارات ({skills.length})
        </button>
      )}
    </section>
  );
});
