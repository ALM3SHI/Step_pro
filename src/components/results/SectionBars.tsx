'use client';

import { memo } from 'react';
import { SECTION_COLOR_DARK, SECTION_COLOR_LIGHT, SECTION_LABEL_AR } from './palette';
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
    <section className="glass rounded-2xl p-6" aria-labelledby="section-bars-title">
      <h2 id="section-bars-title" className="mb-1 text-lg font-bold">الأداء حسب القسم</h2>
      <p className="mb-5 text-sm text-[color:var(--app-muted)]">
        النسبة داخل كل قسم، مرتّبة حسب وزن القسم في الاختبار.
      </p>

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

            <div
              className="h-2.5 w-full overflow-hidden rounded-full bg-black/[0.07] dark:bg-white/[0.09]"
              role="img"
              aria-label={`${SECTION_LABEL_AR[r.section]}: ${r.accuracyPct.toFixed(0)} بالمئة، ${r.correct} من ${r.total}`}
            >
              <div
                className="h-full rounded-full transition-[width] duration-700 ease-out"
                style={{ width: `${Math.max(1.5, r.accuracyPct)}%`, background: `var(--sec-${r.section})` }}
              />
            </div>
          </div>
        ))}
      </div>

      <style>{`
        .glass {
          --sec-reading: ${SECTION_COLOR_LIGHT.reading};
          --sec-grammar: ${SECTION_COLOR_LIGHT.grammar};
          --sec-listening: ${SECTION_COLOR_LIGHT.listening};
          --sec-writing: ${SECTION_COLOR_LIGHT.writing};
        }
        @media (prefers-color-scheme: dark) {
          :root:not([data-theme="light"]) .glass {
            --sec-reading: ${SECTION_COLOR_DARK.reading};
            --sec-grammar: ${SECTION_COLOR_DARK.grammar};
            --sec-listening: ${SECTION_COLOR_DARK.listening};
            --sec-writing: ${SECTION_COLOR_DARK.writing};
          }
        }
        :root[data-theme="dark"] .glass {
          --sec-reading: ${SECTION_COLOR_DARK.reading};
          --sec-grammar: ${SECTION_COLOR_DARK.grammar};
          --sec-listening: ${SECTION_COLOR_DARK.listening};
          --sec-writing: ${SECTION_COLOR_DARK.writing};
        }
      `}</style>
    </section>
  );
});
