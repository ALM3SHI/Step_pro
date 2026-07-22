import type { PdfExtractor } from './pdfAdapter';
import type { SourceArtifact } from './types';

/**
 * The concrete PDF text extractor.
 *
 * Deliberately the ONLY file that knows unpdf exists. `pdfAdapter` takes
 * a `PdfExtractor`, so swapping to pdf-parse, pdfjs-dist, or an OCR
 * service later means writing a sibling to this file and changing one
 * call site — no parser is touched.
 *
 * unpdf is pure JavaScript with no native build step, which matters
 * because ingestion has to run in a Vercel serverless function.
 */

/**
 * A page with almost no text but real dimensions is a scan.
 *
 * unpdf reports no image objects, so a page of pictures looks identical
 * to an empty one. Recording a synthetic artifact is what lets the run
 * report say "these pages need OCR" instead of silently returning a
 * near-empty document — the difference between a diagnosis and a
 * mystery.
 */
const SCANNED_PAGE_MAX_CHARS = 40;

export const unpdfExtractor: PdfExtractor = {
  name: 'unpdf',

  async extract(bytes: Uint8Array) {
    // Imported lazily so the bundle only pulls in a PDF stack when a PDF
    // is actually processed.
    const { extractText, getDocumentProxy } = await import('unpdf');

    const pdf = await getDocumentProxy(bytes);
    const { text } = await extractText(pdf, { mergePages: false });

    const pages = Array.isArray(text) ? text : [String(text)];
    const warnings: string[] = [];

    const out = pages.map((pageText) => {
      const t = String(pageText ?? '');
      const artifacts: SourceArtifact[] = [];

      if (t.trim().length < SCANNED_PAGE_MAX_CHARS) {
        // page is filled in by the adapter, which knows the index.
        artifacts.push({
          kind: 'image',
          page: 0,
          note: 'صفحة بلا نص تقريبًا — على الأرجح ممسوحة ضوئيًا وتحتاج OCR',
        });
      }

      return { text: t, artifacts };
    });

    const blankish = out.filter((p) => p.artifacts.length).length;
    if (blankish) {
      warnings.push(
        `${blankish} من ${out.length} صفحة بلا نص قابل للاستخراج. ` +
        'إن كان الملف ممسوحًا ضوئيًا فلن يُستخرج منه شيء بدون OCR.',
      );
    }

    return { pages: out, warnings };
  },
};
