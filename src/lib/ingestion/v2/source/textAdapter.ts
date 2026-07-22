import { normalize } from '../../normalize';
import type { SourceAdapter, SourceDocument, SourcePage } from './types';

/**
 * Plain text in — a paste, or a .txt export.
 *
 * Normalisation (mojibake repair, character canonicalisation) happens
 * HERE, at the boundary, so every parser downstream can assume canonical
 * text. Doing it per-parser would mean four chances to forget.
 */

/**
 * Page-break markers seen in text dumped from PDFs.
 *
 * Splitting on them costs nothing when absent and gives real page
 * numbers when present — which is what makes "chart skipped on page 412"
 * possible for a .txt export of a 700-page compilation.
 */
const PAGE_BREAK = /\f|^\s*-{0,3}\s*(?:page|صفحة)\s*\d+\s*-{0,3}\s*$/gim;

export const textAdapter: SourceAdapter<string> = {
  kind: 'paste',

  async load(input: string, name = 'pasted text'): Promise<SourceDocument> {
    const { text, mojibakeRepaired } = normalize(input);

    const chunks = text.split(PAGE_BREAK).filter((c) => c !== undefined);
    const pages: SourcePage[] = chunks
      .map((c, i) => ({ number: i + 1, text: c, artifacts: [] }))
      // A trailing empty chunk after the last page marker is not a page.
      .filter((p, i) => p.text.trim().length > 0 || i === 0);

    const warnings: string[] = [];
    if (mojibakeRepaired) {
      warnings.push('أُصلح ترميز معطوب في النص المصدر (mojibake).');
    }
    if (!text.trim()) warnings.push('النص المصدر فارغ.');

    return {
      name,
      kind: 'paste',
      pages: pages.length ? pages : [{ number: 1, text: '', artifacts: [] }],
      warnings,
    };
  },
};

/** Same pipeline, labelled as a file so the report can say so. */
export const textFileAdapter: SourceAdapter<string> = {
  kind: 'text-file',
  async load(input, name = 'text file') {
    const doc = await textAdapter.load(input, name);
    return { ...doc, kind: 'text-file' };
  },
};
