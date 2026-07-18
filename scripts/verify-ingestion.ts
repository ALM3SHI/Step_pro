/**
 * Runs the ingestion pipeline against the real corpora and prints a
 * report. Usage:  npx tsx scripts/verify-ingestion.ts
 */
import { readFileSync } from 'node:fs';
import { runPipeline } from '../src/lib/ingestion/pipeline';

const FILES = [
  { path: 'gramer_bank.txt',  expect: 150, label: 'GRAMMAR' },
  { path: 'reading_bank.txt', expect: null, label: 'READING' },
];

for (const { path, expect, label } of FILES) {
  const raw = readFileSync(path, 'utf8');
  const r = runPipeline(raw);
  const s = r.stats;

  console.log(`\n${'='.repeat(64)}\n${label}  (${path})\n${'='.repeat(64)}`);
  console.log(`strategy          : ${s.strategy} (confidence ${s.strategyConfidence.toFixed(2)})`);
  console.log(`mojibake repaired : ${s.mojibakeRepaired}`);
  console.log(`chars             : ${s.rawChars} -> ${s.cleanedChars}`);
  console.log(`noise lines killed: ${s.linesDropped}  ${JSON.stringify(s.droppedByLabel)}`);
  console.log(`parsed            : ${s.parsed}${expect ? ` / expected ${expect}` : ''}`);
  console.log(`rejected          : ${s.rejected}`);
  console.log(`dupes (batch/db)  : ${s.duplicatesInBatch} / ${s.duplicatesInDatabase}`);
  console.log(`unique to store   : ${s.unique}`);
  console.log(`yield rate        : ${(s.yieldRate * 100).toFixed(2)}%`);
  console.log(`passages          : ${r.passages.length}`);

  if (r.rejected.length) {
    console.log(`\n-- first 8 rejections --`);
    for (const rej of r.rejected.slice(0, 8)) {
      console.log(`  L${rej.sourceLine}: ${rej.reason}\n      ${rej.excerpt.slice(0, 110)}`);
    }
  }

  console.log(`\n-- first 2 parsed --`);
  for (const q of r.questions.slice(0, 2)) {
    console.log(`  Q(L${q.sourceLine}): ${q.questionText.slice(0, 100)}`);
    for (const [k, v] of Object.entries(q.options)) console.log(`     ${k}) ${v}`);
    if (q.warnings.length) console.log(`     ! ${q.warnings.join('; ')}`);
  }

  const withWarnings = r.questions.filter((q) => q.warnings.length).length;
  console.log(`\nquestions carrying warnings: ${withWarnings}`);
}
