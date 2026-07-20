'use client';

import { memo } from 'react';
import { SECTION_LABEL_AR } from './palette';
import { Card, Meter, SectionTitle } from '@/components/ui';
import type { SectionScore } from '@/lib/exam/scoring';

/**
 * Accuracy by section.
 *
 * Horizontal bars rather than a radar: the job here is comparing
 * magnitudes across four categories, and bars on a shared baseline are
 * read accurately while radar area is not. A radar also implies the axes
 * form a cycle, which these four independent sections do not.
 *
 * Direct labels on every bar because the validated palette warns on
 * contrast for two of the four slots — identity must never be
 * colour-alone.
 */
export const SectionBars = memo(function SectionBars({ sections }: { sections: SectionScore[] }) {
  // Stable order: by exam weight, never by score. Sorting by result
  // would repaint the chart every time performance changes, and colour
  // must follow the section rather than its rank.
  const rows = [...sections].sort((a, b) => b.weightPct - a.weightPct);

  return (
    <Card className="p-6" aria-labelledby="section-bars-title">
      <SectionTitle id="section-bars-title" hint="النسبة داخل كل قسم، مرتّبة حسب وزن القسم في الاختبار.">
        الأداء حسب القسم
      </SectionTitle>

      <div className="space-y-4">
        {rows.map((r) => (
          <div key={r.section}>
            <div className="mb-1.5 flex items-baseline gap-2 text-sm">
              <span
                aria-hidden
                className="inline-block h-3 w-3 flex-shrink-0 rounded-sm"
                style={{ background: `var(--sec-${r.section})` }}
              />
              <span className="font-semibold">{SECTION_LABEL_AR[r.section] ?? r.section}</span>
              <span className="text-xs text-[color:var(--app-muted)]">وزنه {r.weightPct}%</span>
              <span className="flex-1" />
              <b className="tabular-nums">{r.accuracyPct.toFixed(0)}%</b>
              <span className="text-xs tabular-nums text-[color:var(--app-muted)]">
                {r.correct}/{r.total}
              </span>
            </div>

            <Meter
              value={r.accuracyPct}
              color={`var(--sec-${r.section})`}
              label={`${SECTION_LABEL_AR[r.section]}: ${r.accuracyPct.toFixed(0)} بالمئة، ${r.correct} من ${r.total}`}
            />
          </div>
        ))}
      </div>
    </Card>
  );
});
