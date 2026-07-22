import { normalize } from '../../normalize';
import type { SourceAdapter, SourceDocument, SourcePage, SourceArtifact } from './types';

/**
 * PDF in — one page per PDF page, artifacts reported rather than dropped.
 *
 * NO PDF LIBRARY IS BUNDLED. Extraction is injected, so the choice of
 * pdf-parse / pdf.js / unpdf is made once at the call site and never
 * leaks into a parser. Everything a parser needs is already satisfied by
 * `SourceDocument`; wiring a real extractor changes this file only.
 *
 * To enable, install one and pass an extractor:
 *
 *   npm i unpdf
 *   import { extractText, getDocumentProxy } from 'unpdf';
 *   const doc = await pdfAdapter(unpdfExtractor).load(bytes, 'file.pdf');
 */

/**
 * What a PDF library must provide.
 *
 * Deliberately minimal — page text plus whatever visual objects were
 * found. A library that cannot report artifacts still works; the run
 * report then says zero images rather than claiming none existed.
 */
export interface PdfExtractor {
  readonly name: string;
  extract(bytes: Uint8Array): Promise<{
    pages: Array<{ text: string; artifacts?: SourceArtifact[] }>;
    warnings?: string[];
  }>;
}

export class PdfExtractorMissingError extends Error {
  constructor() {
    super(
      'لم تُضبط مكتبة قراءة PDF. ثبّت إحداها (unpdf أو pdf-parse) ومرّر PdfExtractor ' +
      'إلى pdfAdapter. طبقة القراءة منفصلة عن المُحلّلات عمدًا، فلا حاجة لتعديلها.',
    );
    this.name = 'PdfExtractorMissingError';
  }
}

/**
 * A page whose text is nearly empty but which carried visual objects is a
 * SCANNED page, not a blank one. Saying so is the difference between "we
 * imported everything" and "700 pages produced 12 questions because the
 * file is images and needs OCR".
 */
const SCANNED_PAGE_MAX_CHARS = 40;

export function pdfAdapter(extractor: PdfExtractor | null): SourceAdapter<Uint8Array> {
  return {
    kind: 'pdf',

    async load(bytes: Uint8Array, name = 'document.pdf'): Promise<SourceDocument> {
      if (!extractor) throw new PdfExtractorMissingError();

      const raw = await extractor.extract(bytes);
      const warnings = [...(raw.warnings ?? [])];

      const pages: SourcePage[] = raw.pages.map((p, i) => ({
        number: i + 1,
        // Normalise here, exactly as the text adapter does, so a parser
        // cannot tell which adapter it is reading from.
        text: normalize(p.text ?? '').text,
        artifacts: (p.artifacts ?? []).map((a) => ({ ...a, page: i + 1 })),
      }));

      const scanned = pages.filter(
        (p) => p.text.trim().length < SCANNED_PAGE_MAX_CHARS && p.artifacts.length > 0,
      );
      if (scanned.length) {
        warnings.push(
          `${scanned.length} صفحة تبدو ممسوحة ضوئيًا (صور بلا نص). تحتاج OCR — ` +
          `الصفحات: ${scanned.slice(0, 10).map((p) => p.number).join(', ')}` +
          (scanned.length > 10 ? ' …' : ''),
        );
      }

      const empty = pages.filter(
        (p) => !p.text.trim() && p.artifacts.length === 0,
      );
      if (empty.length) {
        warnings.push(`${empty.length} صفحة فارغة تمامًا تُخطّت.`);
      }

      return { name, kind: 'pdf', pages, warnings };
    },
  };
}
