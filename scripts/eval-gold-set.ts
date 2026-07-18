/**
 * Measures REAL solver accuracy against the 1,135 verified answer keys
 * extracted from the legacy bank.
 *
 * This is the only honest way to claim "99%+". Self-consistency voting is
 * a good idea, but whether 3 votes actually beats 1 on THIS question
 * style is an empirical question — and the answer determines how much you
 * spend per batch. Run this before trusting the pipeline on unkeyed
 * grammar/reading content.
 *
 *   npx tsx scripts/eval-gold-set.ts [sampleSize] [votes]
 *
 * Requires LLM_PROVIDER + the matching API key in the environment.
 */
import { readFileSync } from 'node:fs';
import { createProvider } from '../src/lib/llm/providers';
import { solveAll } from '../src/lib/llm/solver';
import type { OptionKey, SolveInput } from '../src/lib/llm/types';

interface LegacyQ { id: string; sec: string; q: string; opts: string[]; ans: number; exp?: string; audio?: string }

const sampleSize = Number(process.argv[2] ?? 100);
const votes = Number(process.argv[3] ?? 3);

const all: LegacyQ[] = JSON.parse(readFileSync('legacy_bank.json', 'utf8'));

// Listening items depend on audio the model cannot hear — including them
// would measure nothing but guess rate. Exclude them from the eval.
const eligible = all.filter((q) => !q.audio && q.opts.length >= 2 && q.opts.length <= 4);

// Deterministic stratified sample: every Nth item, so re-runs are
// comparable and every section is represented in proportion.
const step = Math.max(1, Math.floor(eligible.length / sampleSize));
const sample = eligible.filter((_, i) => i % step === 0).slice(0, sampleSize);

const KEYS: OptionKey[] = ['A', 'B', 'C', 'D'];
const inputs: SolveInput[] = sample.map((q, i) => ({
  ref: `g${i}`,
  questionText: q.q,
  options: Object.fromEntries(q.opts.map((o, j) => [KEYS[j], o])) as Record<OptionKey, string>,
}));

const expected = new Map(sample.map((q, i) => [`g${i}`, KEYS[q.ans]]));
const sectionOf = new Map(sample.map((q, i) => [`g${i}`, q.sec]));

(async () => {
  const provider = createProvider();
  console.log(`provider   : ${provider.name} / ${provider.model}`);
  console.log(`sample     : ${sample.length} of ${eligible.length} eligible`);
  console.log(`votes      : ${votes}\n`);

  const t0 = Date.now();
  const report = await solveAll(provider, inputs, {
    votes,
    chunkSize: 25,
    onProgress: (d, t) => process.stdout.write(`\r  ${d}/${t}`),
  });
  process.stdout.write('\n\n');

  let correct = 0;
  const wrong: Array<{ ref: string; got: string; want: string; consensus: number; flagged: boolean }> = [];
  const bySection: Record<string, { n: number; ok: number }> = {};

  for (const s of report.solved) {
    const want = expected.get(s.ref)!;
    const sec = sectionOf.get(s.ref)!;
    bySection[sec] ??= { n: 0, ok: 0 };
    bySection[sec].n++;
    if (s.correctOption === want) { correct++; bySection[sec].ok++; }
    else wrong.push({ ref: s.ref, got: s.correctOption, want, consensus: s.consensusRatio, flagged: s.needsHumanReview });
  }

  const n = report.solved.length;
  const acc = n ? (correct / n) * 100 : 0;

  console.log(`accuracy         : ${correct}/${n}  (${acc.toFixed(2)}%)`);
  console.log(`unsolved         : ${report.failed.length}`);
  console.log(`elapsed          : ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`\nby section:`);
  for (const [sec, v] of Object.entries(bySection)) {
    console.log(`  ${sec.padEnd(8)} ${v.ok}/${v.n}  (${((v.ok / v.n) * 100).toFixed(1)}%)`);
  }

  // The key question: does the review flag actually catch the errors?
  // A flag that fires on random questions costs reviewer time and buys
  // nothing; this measures whether it earns its keep.
  const unanimous = report.solved.filter((s) => s.consensusRatio === 1);
  const unanimousCorrect = unanimous.filter((s) => s.correctOption === expected.get(s.ref)).length;
  const flaggedWrong = wrong.filter((w) => w.flagged).length;

  console.log(`\nreview-flag quality:`);
  console.log(`  unanimous items      : ${unanimous.length}  accuracy ${(unanimous.length ? (unanimousCorrect / unanimous.length) * 100 : 0).toFixed(2)}%`);
  console.log(`  flagged for review   : ${report.stats.flaggedForReview}`);
  console.log(`  errors caught by flag: ${flaggedWrong}/${wrong.length}`);
  console.log(`  -> reviewing the flagged set alone would lift accuracy to ` +
    `${n ? (((correct + flaggedWrong) / n) * 100).toFixed(2) : '0'}%`);

  if (wrong.length) {
    console.log(`\nfirst 10 errors:`);
    for (const w of wrong.slice(0, 10)) {
      const q = sample[Number(w.ref.slice(1))];
      console.log(`  got ${w.got} want ${w.want} (consensus ${w.consensus.toFixed(2)}, flagged=${w.flagged})`);
      console.log(`    ${q.q.slice(0, 100)}`);
    }
  }
})();
