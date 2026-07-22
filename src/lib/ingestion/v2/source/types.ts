/**
 * The input contract for the ingestion engine.
 *
 * Everything downstream — answer-key extraction, all four parsers, the
 * report — reads a `SourceDocument` and nothing else. A paste, a .txt
 * file, and a 700-page PDF differ only in which adapter produced this
 * shape, so adding PDF support means writing one adapter, not touching a
 * parser.
 *
 * Pages are preserved rather than concatenated. A 700-page compilation
 * needs per-page reporting ("pages scanned", "chart on page 412 skipped")
 * and a failed block is far more useful when it says which page it came
 * from.
 */

/** Something visual the text layer cannot represent. */
export interface SourceArtifact {
  kind: 'image' | 'chart' | 'table' | 'formula';
  /** 1-based page it appeared on. */
  page: number;
  /** Whatever the adapter could say about it — alt text, caption, size. */
  note?: string;
}

export interface SourcePage {
  /** 1-based. A paste is a single page 1. */
  number: number;
  text: string;
  /**
   * Non-text content detected on this page.
   *
   * Reported, never silently discarded: a question whose stem is an
   * image is a question the bank is missing, and the maintainer can only
   * chase it if the run says it existed.
   */
  artifacts: SourceArtifact[];
}

export interface SourceDocument {
  /** For the report and for tracing a block back to its origin. */
  name: string;
  kind: 'paste' | 'text-file' | 'pdf';
  pages: SourcePage[];
  /** Adapter-level problems that did not stop extraction. */
  warnings: string[];
}

/**
 * Turns some input into a SourceDocument.
 *
 * Async because a PDF adapter must be — the text one simply resolves.
 */
export interface SourceAdapter<TInput> {
  readonly kind: SourceDocument['kind'];
  load(input: TInput, name?: string): Promise<SourceDocument>;
}

/** Every page joined, for stages that genuinely need one string. */
export function fullText(doc: SourceDocument): string {
  return doc.pages.map((p) => p.text).join('\n');
}

/** Total artifacts by kind, for the run report. */
export function artifactCounts(doc: SourceDocument): Record<string, number> {
  const out: Record<string, number> = {};
  for (const page of doc.pages) {
    for (const a of page.artifacts) out[a.kind] = (out[a.kind] ?? 0) + 1;
  }
  return out;
}

/**
 * Map an offset in `fullText(doc)` back to its page.
 *
 * The parsers work on joined text because a question can straddle a page
 * break; the report needs the page number back. Linear scan is fine —
 * this runs once per emitted block, not per character.
 */
/**
 * Line index (0-based, into `fullText`) -> page number.
 *
 * Built once per run so every emitted question and passage can say which
 * page of the source it came from. A 700-page compilation is only
 * reviewable if a bad parse can be looked up in the original.
 */
export function buildLinePageMap(doc: SourceDocument): number[] {
  const map: number[] = [];
  for (const page of doc.pages) {
    // fullText joins pages with '\n', so each page contributes its own
    // lines plus that separator.
    const lineCount = page.text.split('\n').length;
    for (let i = 0; i < lineCount; i++) map.push(page.number);
  }
  return map;
}

export function pageAtOffset(doc: SourceDocument, offset: number): number {
  let seen = 0;
  for (const page of doc.pages) {
    // +1 for the '\n' that fullText inserts between pages.
    seen += page.text.length + 1;
    if (offset < seen) return page.number;
  }
  return doc.pages[doc.pages.length - 1]?.number ?? 1;
}
