/**
 * Yield rate only proves nothing was rejected. This audits whether the
 * parsed output is actually well-formed.
 */
import { readFileSync } from 'node:fs';
import { runPipeline } from '../src/lib/ingestion/pipeline';

for (const file of ['gramer_bank.txt', 'reading_bank.txt']) {
  const r = runPipeline(readFileSync(file, 'utf8'));
  const qs = r.questions;
  const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

  const noQMark = qs.filter((q) => !/[?？]|_{2,}|\.{3,}|\bcorrect\b|\bfollowing\b/i.test(q.questionText));
  const notFour = qs.filter((q) => Object.keys(q.options).length !== 4);
  const longPrompt = qs.filter((q) => words(q.questionText) > 60);
  const longOption = qs.filter((q) => Object.values(q.options).some((v) => words(v!) > 25));
  const emptyOption = qs.filter((q) => Object.values(q.options).some((v) => !v!.trim()));
  const promptLeak = qs.filter((q) => /^\d+\s*\/\s*\d+/.test(q.questionText));
  const optLens = qs.flatMap((q) => Object.values(q.options).map((v) => words(v!)));

  console.log(`\n===== ${file} =====`);
  console.log(`questions            : ${qs.length}`);
  console.log(`passages             : ${r.passages.length}`);
  console.log(`options != 4         : ${notFour.length}`);
  console.log(`empty option text    : ${emptyOption.length}`);
  console.log(`boundary marker leak : ${promptLeak.length}`);
  console.log(`prompt > 60 words    : ${longPrompt.length}`);
  console.log(`option > 25 words    : ${longOption.length}`);
  console.log(`no question signal   : ${noQMark.length}`);
  console.log(`median option words  : ${optLens.sort((a, b) => a - b)[Math.floor(optLens.length / 2)]}`);
  console.log(`with warnings        : ${qs.filter((q) => q.warnings.length).length}`);
  console.log(`unique content hashes: ${new Set(qs.map((q) => q.contentHash)).size}`);

  for (const q of longPrompt.slice(0, 3)) {
    console.log(`  LONG L${q.sourceLine}: ${q.questionText.slice(0, 120)}`);
  }
  for (const q of noQMark.slice(0, 3)) {
    console.log(`  NOSIG L${q.sourceLine}: ${q.questionText.slice(0, 120)}`);
  }
  if (r.passages.length) {
    const p = r.passages[0];
    console.log(`  PASSAGE[0] "${p.title}" (${words(p.body)} words): ${p.body.slice(0, 90)}...`);
  }
}
