/**
 * Cross-corpus validation.
 *
 * Answers one question: is the engine GENERAL, or was it tuned to
 * reading_bank.txt? Four parser rules were changed while looking at that
 * one file, which is exactly how a parser silently overfits.
 *
 * Every corpus here is real project material, not a fixture. Where a
 * corpus states its own item count — the "N / M" markers a quiz export
 * prints — that number is the ground truth and the report compares
 * against it rather than against the engine's own opinion.
 *
 *   npx tsx scripts/validate-corpora.ts
 *   npx tsx scripts/validate-corpora.ts --verbose   (show failure samples)
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { textFileAdapter } from '../src/lib/ingestion/v2/source/textAdapter';
import { pdfAdapter } from '../src/lib/ingestion/v2/source/pdfAdapter';
import { unpdfExtractor } from '../src/lib/ingestion/v2/source/unpdfExtractor';
import { ingest } from '../src/lib/ingestion/v2/engine';
import { normalize } from '../src/lib/ingestion/normalize';
import type { SectionId } from '../src/lib/content/taxonomy';
import type { SourceDocument } from '../src/lib/ingestion/v2/source/types';

const VERBOSE = process.argv.includes('--verbose');

interface Corpus {
  file: string;
  label: string;
  section: SectionId;
  /** Format, so a failure can be attributed to a shape rather than a file. */
  shape: string;
}

/**
 * PDFs to validate.
 *
 * Any .pdf dropped in `corpora/` is picked up automatically, so adding a
 * file from another academy needs no code change. Section comes from the
 * filename: `reading-*.pdf`, `grammar-*.pdf`, `listening-*.pdf`,
 * `writing-*.pdf`. Unprefixed files default to reading and say so.
 */
const PDF_DIR = 'corpora';

function sectionFromName(name: string): { section: SectionId; guessed: boolean } {
  const lower = name.toLowerCase();
  for (const s of ['reading', 'grammar', 'listening', 'writing'] as SectionId[]) {
    if (lower.includes(s)) return { section: s, guessed: false };
  }
  return { section: 'reading', guessed: true };
}

function discoverPdfs(): Array<Corpus & { isPdf: true }> {
  if (!existsSync(PDF_DIR)) return [];
  return readdirSync(PDF_DIR)
    .filter((f) => f.toLowerCase().endsWith('.pdf'))
    .map((f) => {
      const { section, guessed } = sectionFromName(f);
      return {
        file: path.join(PDF_DIR, f),
        label: f.replace(/\.pdf$/i, '').slice(0, 15),
        section,
        shape: `PDF${guessed ? ' (section guessed from filename — rename to override)' : ''}`,
        isPdf: true as const,
      };
    });
}

const CORPORA: Corpus[] = [
  {
    file: 'reading_bank.txt',
    label: 'Reading bank',
    section: 'reading',
    shape: 'passage reprinted per item; bare options; "N / 150" trailing marker',
  },
  {
    file: 'gramer_bank.txt',
    label: 'Grammar bank',
    section: 'grammar',
    shape: 'no passages; "N / 150" LEADING marker; bare options; mojibake present',
  },
];

/**
 * Ground truth from the document itself.
 *
 * A quiz export numbers every item "N / M". Counting the distinct N it
 * prints is an independent count the parser cannot influence.
 */
function declaredItemCount(text: string): { total: number | null; seen: number; missing: number[] } {
  const seen = new Set<number>();
  let declared: number | null = null;

  for (const line of text.split('\n')) {
    const m = line.trim().match(/^(\d{1,4})\s*\/\s*(\d{1,4})$/);
    if (!m) continue;
    seen.add(Number(m[1]));
    declared = Number(m[2]);
  }
  if (declared === null) return { total: null, seen: 0, missing: [] };

  const missing: number[] = [];
  for (let i = 1; i <= declared; i++) if (!seen.has(i)) missing.push(i);
  return { total: declared, seen: seen.size, missing };
}

interface Row {
  label: string;
  actual: number | null;
  extracted: number;
  passages: number;
  artifacts: number;
  linked: number;
  unlinked: number;
  failed: number;
  emptyPassages: number;
  recall: number | null;
}

const rows: Row[] = [];
let hardFailures = 0;

const pdfs = discoverPdfs();
const ALL: Array<Corpus & { isPdf?: boolean }> = [...CORPORA, ...pdfs];

for (const corpus of ALL) {
  if (!existsSync(corpus.file)) {
    console.log(`SKIP ${corpus.file} — not present`);
    continue;
  }

  let doc: SourceDocument;
  let truth: ReturnType<typeof declaredItemCount>;

  if (corpus.isPdf) {
    const bytes = new Uint8Array(readFileSync(corpus.file));
    doc = await pdfAdapter(unpdfExtractor).load(bytes, path.basename(corpus.file));
    // Ground truth comes from the extracted text, since a PDF has no
    // separate manifest of what it contains.
    truth = declaredItemCount(doc.pages.map((p) => p.text).join('\n'));
  } else {
    const raw = readFileSync(corpus.file, 'utf8');
    truth = declaredItemCount(normalize(raw).text);
    doc = await textFileAdapter.load(raw, corpus.file);
  }
  const plan = ingest(doc, { section: corpus.section, assignTemporarySkill: true });
  const r = plan.report;

  const linked = plan.questions.filter((q) => q.passageRef !== undefined).length;
  const artifacts = r.imagesSkipped + r.chartsSkipped + r.tablesSkipped;
  const recall = truth.total ? plan.questions.length / truth.total : null;

  rows.push({
    label: corpus.label,
    actual: truth.total,
    extracted: plan.questions.length,
    passages: plan.passages.length,
    artifacts,
    linked,
    unlinked: plan.unlinked.length,
    failed: plan.failed.length,
    emptyPassages: plan.emptyPassages.length,
    recall,
  });

  console.log('='.repeat(74));
  console.log(`${corpus.label}  (${corpus.file})`);
  console.log(`shape: ${corpus.shape}`);
  console.log('='.repeat(74));
  console.log(`  questions actually present  : ${truth.total ?? '(source does not state)'}`
    + (truth.total ? `   [${truth.seen} distinct markers seen]` : ''));
  console.log(`  questions extracted         : ${plan.questions.length}`);
  console.log(`  passages                    : ${plan.passages.length}`);
  console.log(`  images / charts / tables    : ${artifacts}`);
  console.log(`  questions linked to passage : ${linked}`);
  console.log(`  questions NOT linked        : ${plan.unlinked.length}`);
  console.log(`  failed blocks               : ${plan.failed.length}`);
  console.log(`  empty passages              : ${plan.emptyPassages.length}`);
  if (recall !== null) {
    console.log(`  RECALL                      : ${(recall * 100).toFixed(1)}%`);
  }
  console.log(`  answer keys found           : ${r.answerKeysFound}`);
  console.log(`  temporary skills            : ${r.temporarySkills}`);
  console.log(`  confidence  high/med/low    : ${r.confidence.high}/${r.confidence.medium}/${r.confidence.low}`);

  /**
   * Quality: the ways a recall number can be faked.
   *
   * The stem-length ceiling is section-specific. In reading, a 200-
   * character stem means passage text leaked into a question. In
   * grammar and writing it means nothing — sentence-ordering and
   * error-identification items legitimately carry a paragraph in the
   * stem, so a shared threshold would flag correct parses as defects.
   */
  const stemCeiling = corpus.section === 'reading' ? 200 : 600;
  const overlong = plan.questions.filter((q) => q.text.length > stemCeiling).length;
  const fewOptions = plan.questions.filter((q) => Object.keys(q.options).length < 2).length;
  const noOptions = plan.questions.filter((q) => Object.keys(q.options).length === 0).length;
  const emptyStems = plan.questions.filter((q) => !q.text.trim()).length;

  console.log(`  -- quality --`);
  console.log(`  stems over ${stemCeiling} chars        : ${overlong}`
    + (corpus.section === 'reading' ? '   (passage text read as a question)' : ''));
  console.log(`  questions with <2 options   : ${fewOptions}`);
  console.log(`  questions with 0 options    : ${noOptions}`);
  console.log(`  empty stems                 : ${emptyStems}`);

  if (overlong > 0 || noOptions > 0 || emptyStems > 0) hardFailures++;
  if (recall !== null && recall < 0.9) hardFailures++;

  if (VERBOSE) {
    if (plan.failed.length) {
      console.log(`\n  failed block samples:`);
      for (const f of plan.failed.slice(0, 5)) {
        console.log(`    L${f.sourceLine}  ${f.reason}`);
        console.log(`      "${f.text.slice(0, 90).replace(/\n/g, ' / ')}"`);
      }
    }
    if (plan.unlinked.length) {
      console.log(`\n  unlinked samples:`);
      for (const u of plan.unlinked.slice(0, 5)) {
        console.log(`    L${u.sourceLine}  ${u.reason}  "${u.text.slice(0, 60)}"`);
      }
    }
    if (truth.missing.length && truth.missing.length <= 20) {
      console.log(`\n  source item numbers with no marker: ${truth.missing.join(', ')}`);
    }
  }
  console.log('');
}

// --- summary ---------------------------------------------------------
console.log('='.repeat(74));
console.log('SUMMARY');
console.log('='.repeat(74));
console.log(
  'corpus'.padEnd(16) + 'actual'.padStart(8) + 'got'.padStart(7) +
  'recall'.padStart(9) + 'linked'.padStart(8) + 'unlink'.padStart(8) +
  'failed'.padStart(8) + 'empty'.padStart(7),
);
for (const r of rows) {
  console.log(
    r.label.padEnd(16) +
    String(r.actual ?? '?').padStart(8) +
    String(r.extracted).padStart(7) +
    (r.recall === null ? '—' : `${(r.recall * 100).toFixed(1)}%`).padStart(9) +
    String(r.linked).padStart(8) +
    String(r.unlinked).padStart(8) +
    String(r.failed).padStart(8) +
    String(r.emptyPassages).padStart(7),
  );
}

console.log(`\ncorpora validated: ${rows.length}`);
console.log(hardFailures === 0
  ? 'no hard failures (recall >= 90%, no passage text read as a question)'
  : `${hardFailures} HARD FAILURE(S) — see above`);

const realPdfs = pdfs.filter((p) => !/synthetic/i.test(p.file));
if (realPdfs.length === 0) {
  console.log(
    `\nNOTE: no real PDF was validated — ${PDF_DIR}/ contains none.` +
    (pdfs.length
      ? '\nThe synthetic file only proves the PDF path runs; it is machine-\n' +
        'generated single-column text and exercises none of the shapes that\n' +
        'actually break extraction.'
      : '') +
    '\nColumn order, right-to-left runs, tables, ligatures and scanned pages\n' +
    `cannot be inferred from text. Drop real files in ${PDF_DIR}/ and re-run.`,
  );
} else {
  console.log(`\n${realPdfs.length} real PDF(s) validated.`);
}

if (hardFailures) process.exit(1);
