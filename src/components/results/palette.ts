/**
 * Categorical palette for the four STEP sections.
 *
 * Validated with the data-viz validator (light mode, surface #fcfcfb):
 *   lightness band PASS · chroma floor PASS
 *   CVD separation PASS — worst adjacent pair ΔE 47.2 protan / 21.6 tritan
 *   contrast WARN — two slots sit under 3:1, which is why every bar
 *   carries a visible direct label rather than relying on colour alone.
 *
 * Colour follows the SECTION, never its rank: sorting the chart by score
 * must not repaint the bars.
 */
export const SECTION_COLOR_LIGHT: Record<string, string> = {
  reading: '#2a78d6',
  grammar: '#1baf7a',
  listening: '#eda100',
  writing: '#4a3aa7',
};

export const SECTION_COLOR_DARK: Record<string, string> = {
  reading: '#3987e5',
  grammar: '#199e70',
  listening: '#c98500',
  writing: '#9085e9',
};

export const SECTION_LABEL_AR: Record<string, string> = {
  reading: 'فهم المقروء',
  grammar: 'القواعد والتراكيب',
  listening: 'فهم المسموع',
  writing: 'التحليل الكتابي',
};

/** Status colours are reserved and never reused as a series hue. */
export const STATUS = {
  good: '#008300',
  warning: '#eda100',
  critical: '#e34948',
} as const;

export function bandFor(pct: number): { label: string; tone: keyof typeof STATUS } {
  if (pct >= 80) return { label: 'ممتاز', tone: 'good' };
  if (pct >= 60) return { label: 'جيد', tone: 'warning' };
  return { label: 'يحتاج تحسين', tone: 'critical' };
}
