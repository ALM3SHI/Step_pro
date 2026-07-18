/**
 * Exercises the solver against a scripted mock provider that reproduces
 * the failure modes real providers actually exhibit. No API key needed.
 */
import { solveAll } from '../src/lib/llm/solver';
import { extractJsonArray, validateResults } from '../src/lib/llm/parse';
import type { LLMProvider, LLMResponse, SolveInput } from '../src/lib/llm/types';

const AR = 'الفاعل مفرد غائب في المضارع البسيط، لذا يأخذ الفعل صيغة بإضافة s للتصريف الصحيح.';

const inputs: SolveInput[] = [
  { ref: 'q1', questionText: 'He ____ to school.', options: { A: 'go', B: 'goes', C: 'going', D: 'gone' } },
  { ref: 'q2', questionText: 'She ____ here.', options: { A: 'live', B: 'lives', C: 'living', D: 'lived' } },
  { ref: 'q3', questionText: 'Ambiguous one.', options: { A: 'x', B: 'y', C: 'z', D: 'w' } },
  { ref: 'q4', questionText: 'Only three options.', options: { A: 'p', B: 'q', C: 'r' } },
  { ref: 'q5', questionText: 'Verified key item.', options: { A: 'a', B: 'b', C: 'c', D: 'd' }, knownAnswer: 'C' },
];

let call = 0;

/** Reproduces: markdown fences, dropped items, a hallucinated ref, an
 *  out-of-range option, an English explanation, and a flip-flopping vote. */
class MockProvider implements LLMProvider {
  readonly name = 'mock';
  readonly model = 'mock-1';

  async solveBatch(qs: SolveInput[]): Promise<LLMResponse> {
    call++;
    const items = qs.map((q) => {
      // q3 flip-flops across passes -> should end up flagged.
      if (q.ref === 'q3') {
        return { ref: 'q3', category: 'grammar', correctOption: call % 2 ? 'A' : 'B', explanationAr: AR, confidence: 0.55 };
      }
      // q4 gets an invalid 'D' on a 3-option question -> must be rejected.
      if (q.ref === 'q4') {
        return { ref: 'q4', category: 'grammar', correctOption: 'D', explanationAr: AR, confidence: 0.9 };
      }
      // q5 has a verified key of C; the model wrongly says A.
      if (q.ref === 'q5') {
        return { ref: 'q5', category: 'grammar', correctOption: 'A', explanationAr: AR, confidence: 0.9 };
      }
      // q2's explanation drifts to English -> should be flagged.
      if (q.ref === 'q2') {
        return { ref: 'q2', category: 'grammar', correctOption: 'B',
          explanationAr: 'The subject is third person singular so we add s to the verb here.', confidence: 0.95 };
      }
      return { ref: q.ref, category: 'grammar', correctOption: 'B', explanationAr: AR, confidence: 0.97 };
    });

    // Inject a hallucinated ref plus markdown fencing.
    items.push({ ref: 'q999', category: 'grammar', correctOption: 'A', explanationAr: AR, confidence: 0.9 });
    const body = '```json\n' + JSON.stringify(items) + '\n```';

    const arr = extractJsonArray(body)!;
    const { results, missing } = validateResults(arr, qs);
    return { results, missing };
  }
}

// --- parser unit checks -------------------------------------------------
console.log('--- parser ---');
const truncated = '[{"ref":"q1","category":"grammar","correctOption":"B","explanationAr":"' + AR + '","confidence":0.9},{"ref":"q2","cat';
const salvaged = extractJsonArray(truncated);
console.log(`truncated output salvaged : ${salvaged?.length} object(s)`);
console.log(`preamble stripped         : ${extractJsonArray('Sure! Here you go:\n[{"a":1}]')?.length === 1}`);
console.log(`fenced stripped           : ${extractJsonArray('```json\n[{"a":1}]\n```')?.length === 1}`);

// --- solver -------------------------------------------------------------
(async () => {
  const report = await solveAll(new MockProvider(), inputs, { votes: 3, chunkSize: 10, concurrency: 1 });

  console.log('\n--- solver ---');
  console.log(JSON.stringify(report.stats, null, 2));
  console.log('\nper question:');
  for (const s of report.solved) {
    console.log(`  ${s.ref}: ans=${s.correctOption} consensus=${s.consensusRatio.toFixed(2)} src=${s.answerSource} review=${s.needsHumanReview}`);
    for (const r of s.reviewReasons) console.log(`      - ${r}`);
  }
  console.log(`  failed: ${JSON.stringify(report.failed)}`);

  // --- assertions -------------------------------------------------------
  const get = (ref: string) => report.solved.find((s) => s.ref === ref);
  const checks: Array<[string, boolean]> = [
    ['hallucinated ref q999 rejected', !report.solved.some((s) => s.ref === 'q999')],
    ['invalid option D on 3-option q4 rejected', report.failed.includes('q4')],
    ['q1 unanimous and not flagged', get('q1')?.consensusRatio === 1 && get('q1')?.needsHumanReview === false],
    ['q2 flagged for English explanation', get('q2')?.needsHumanReview === true],
    ['q3 split vote flagged', (get('q3')?.consensusRatio ?? 1) < 1 && get('q3')?.needsHumanReview === true],
    ['q5 verified key wins over model', get('q5')?.correctOption === 'C'],
    ['q5 marked provided_key', get('q5')?.answerSource === 'provided_key'],
    ['q5 flagged as key/model disagreement', get('q5')?.needsHumanReview === true],
  ];

  console.log('\n--- assertions ---');
  let failures = 0;
  for (const [name, pass] of checks) {
    console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}`);
    if (!pass) failures++;
  }
  console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
})();
