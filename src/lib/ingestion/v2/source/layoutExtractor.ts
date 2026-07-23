import type { PdfExtractor } from './pdfAdapter';
import type { SourceArtifact } from './types';

/**
 * Coordinate-aware PDF extraction.
 *
 * `unpdf.extractText` returns text in the PDF's content-stream order and
 * merges runs that share a Y band. On a two-column page that glues the
 * columns together — "They ...... here since 2010.The capital of France
 * is" — which is why the grammar PDF parsed to almost nothing while its
 * text was perfectly copyable. The failure was reading ORDER, not
 * extraction.
 *
 * This extractor reads each text item's (x, y) from pdf.js and rebuilds
 * reading order:
 *
 *   1. detect columns from the distribution of line-start X positions;
 *   2. assign every item to a column;
 *   3. within a column, group items into lines by Y, order by X;
 *   4. read column 1 top-to-bottom, then column 2.
 *
 * Same PdfExtractor interface as the plain adapter, so it drops into the
 * existing seam — the parsers never learn which one ran.
 */

export interface TextItem { str: string; x: number; y: number; w: number; h: number }
type Item = TextItem;

/**
 * Two items belong to the same visual line when their baselines are
 * within this many points. STEP exports use ~11pt text; 3pt tolerates
 * sub/superscript jitter without merging adjacent lines.
 */
const LINE_TOLERANCE = 3;

/**
 * A gap wider than this fraction of page width, with text on both sides,
 * is a column boundary rather than ordinary word spacing.
 */
const COLUMN_GAP_FRACTION = 0.06;

/** Below this many characters, a page is treated as a scan needing OCR. */
const SCANNED_PAGE_MAX_CHARS = 40;

function detectColumnBoundaries(items: Item[], pageWidth: number): number[] {
  if (items.length < 8) return [];

  // Build an occupancy histogram across the page width; a column gutter
  // shows up as a run of empty bins with ink on both sides.
  const BINS = 60;
  const binWidth = pageWidth / BINS;
  const occupied = new Array(BINS).fill(false);

  for (const it of items) {
    const from = Math.max(0, Math.floor(it.x / binWidth));
    const to = Math.min(BINS - 1, Math.floor((it.x + it.w) / binWidth));
    for (let b = from; b <= to; b++) occupied[b] = true;
  }

  const minGutter = Math.max(2, Math.round((COLUMN_GAP_FRACTION * pageWidth) / binWidth));
  const boundaries: number[] = [];
  let run = 0;
  let leftHasInk = false;

  for (let b = 0; b < BINS; b++) {
    if (occupied[b]) {
      // A wide empty run, with ink before AND after it, is a gutter.
      if (run >= minGutter && leftHasInk) {
        boundaries.push((b - run / 2) * binWidth);
      }
      run = 0;
      leftHasInk = true;
    } else {
      run++;
    }
  }
  return boundaries;
}

function columnOf(x: number, boundaries: number[]): number {
  let col = 0;
  for (const b of boundaries) { if (x >= b) col++; else break; }
  return col;
}

/** Order items within one column into lines, top-to-bottom. */
function readColumn(items: Item[]): string {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: Item[][] = [];

  for (const it of sorted) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last[0].y - it.y) <= LINE_TOLERANCE) last.push(it);
    else lines.push([it]);
  }

  return lines
    .map((line) => line.sort((a, b) => a.x - b.x).map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

/**
 * Reading-order text from positioned items.
 *
 * Exported so the reconstruction can be tested on synthetic coordinates
 * without rendering a PDF — the column and line logic is the part that
 * matters, and it is pure geometry.
 */
export function reconstructPage(items: Item[], pageWidth: number): string {
  const real = items.filter((i) => i.str && i.str.trim());
  if (!real.length) return '';

  const boundaries = detectColumnBoundaries(real, pageWidth);
  if (!boundaries.length) return readColumn(real);

  // Group by column, then read columns left to right.
  const byColumn = new Map<number, Item[]>();
  for (const it of real) {
    const c = columnOf(it.x, boundaries);
    byColumn.set(c, [...(byColumn.get(c) ?? []), it]);
  }

  return [...byColumn.keys()]
    .sort((a, b) => a - b)
    .map((c) => readColumn(byColumn.get(c)!))
    .join('\n');
}

export const layoutExtractor: PdfExtractor = {
  name: 'pdfjs-layout',

  async extract(bytes: Uint8Array) {
    const { getDocumentProxy, getResolvedPDFJS } = await import('unpdf');
    // pdf.js transfers (detaches) the input buffer to its worker, so the
    // caller's bytes become unusable afterwards. Copy first, so the same
    // file can be handed to another extractor for comparison.
    const pdf = await getDocumentProxy(bytes.slice());

    // Image counting via getOperatorList throws a DataCloneError in the
    // Node worker on some builds. Reading order does not need it, so it
    // is attempted once and dropped permanently on failure rather than
    // taking the whole extraction down with it.
    let OPS: Record<string, number> | null = null;
    try { OPS = (await getResolvedPDFJS()).OPS as unknown as Record<string, number>; } catch { OPS = null; }
    let imageOpsUsable = OPS !== null;

    const pages: Array<{ text: string; artifacts: SourceArtifact[] }> = [];
    const warnings: string[] = [];

    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const viewport = page.getViewport({ scale: 1 });

      const content = await page.getTextContent();
      const items: Item[] = (content.items as Array<{ str: string; transform: number[]; width: number; height: number }>)
        .filter((i) => typeof i.str === 'string')
        .map((i) => ({
          str: i.str,
          x: i.transform[4],
          y: i.transform[5],
          w: i.width ?? 0,
          h: i.height ?? 0,
        }));

      const text = reconstructPage(items, viewport.width);

      const artifacts: SourceArtifact[] = [];
      let imageOps = 0;
      if (imageOpsUsable && OPS) {
        try {
          const ops = await page.getOperatorList();
          for (const fn of ops.fnArray) {
            if (
              fn === OPS.paintImageXObject ||
              fn === OPS.paintInlineImageXObject ||
              fn === OPS.paintImageMaskXObject
            ) imageOps++;
          }
        } catch {
          // First failure disables it for the rest of the document.
          imageOpsUsable = false;
        }
      }

      // A page with images and almost no text is a scan. When image
      // counting is unavailable, near-zero text ALONE still flags it —
      // the diagnosis "this page yielded no text" holds either way.
      const nearEmpty = text.trim().length < SCANNED_PAGE_MAX_CHARS;
      if (nearEmpty && (imageOps > 0 || !imageOpsUsable)) {
        artifacts.push({
          kind: 'image',
          page: p,
          note: imageOps > 0
            ? `صفحة بها ${imageOps} صورة وبلا نص تقريبًا — على الأرجح ممسوحة ضوئيًا (تحتاج OCR)`
            : 'صفحة بلا نص قابل للاستخراج — على الأرجح ممسوحة ضوئيًا أو خطوط بلا ToUnicode',
        });
      } else if (imageOps > 0) {
        artifacts.push({ kind: 'image', page: p, note: `${imageOps} صورة على الصفحة` });
      }

      pages.push({ text, artifacts });
    }

    const scanned = pages.filter((p) =>
      p.text.trim().length < SCANNED_PAGE_MAX_CHARS && p.artifacts.length > 0).length;
    if (scanned) {
      warnings.push(
        `${scanned} من ${pages.length} صفحة بلا نص قابل للاستخراج. إن كانت ممسوحة ضوئيًا فتحتاج OCR.`,
      );
    }
    if (!imageOpsUsable) {
      warnings.push('تعذّر عدّ الصور عبر pdf.js في هذه البيئة — اعتُمد على غياب النص للكشف عن الصفحات الممسوحة.');
    }

    return { pages, warnings };
  },
};
