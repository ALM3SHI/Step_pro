/**
 * Exam assembly tests, run against the REAL content bundle.
 */
import { loadBundleSnapshot } from '../src/lib/content/bundleProvider';
import { FULL_STEP_BLUEPRINT, practiceBlueprint } from '../src/lib/content/blueprint';
import { buildExam, poolSummary } from '../src/lib/exam/buildExam';

const results: Array<[string, boolean, string?]> = [];
const check = (n: string, p: boolean, note?: string) => results.push([n, p, note]);

const snapshot = loadBundleSnapshot();
console.log(`pool (published): ${JSON.stringify(poolSummary(snapshot))}`);
console.log(`pool (+drafts)  : ${JSON.stringify(poolSummary(snapshot, true))}\n`);

// --- full exam ---------------------------------------------------------
const exam = buildExam(FULL_STEP_BLUEPRINT, snapshot, { seed: 42 });

check('builds parts', exam.parts.length > 0, `${exam.parts.length} parts`);
check('12 parts (4 sections x 3)', exam.parts.length === 12, String(exam.parts.length));

const bySection: Record<string, number> = {};
for (const p of exam.parts) bySection[p.section] = (bySection[p.section] ?? 0) + p.questionIds.length;
console.log(`built exam by section: ${JSON.stringify(bySection)}`);
console.log(`shortfalls: ${JSON.stringify(exam.shortfalls)}\n`);

check('grammar filled to 30', bySection.grammar === 30, String(bySection.grammar));
check('listening filled to 20', bySection.listening === 20, String(bySection.listening));
check('writing filled to 10', bySection.writing === 10, String(bySection.writing));
check('reading shortfall is REPORTED, not hidden',
  exam.shortfalls.some((s) => s.section === 'reading'),
  JSON.stringify(exam.shortfalls));

check('no part is empty', exam.parts.every((p) => p.questionIds.length > 0),
  exam.parts.filter((p) => !p.questionIds.length).map((p) => `${p.section}#${p.partNo}`).join(','));

check('every question id resolves', exam.parts.every((p) =>
  p.questionIds.every((id) => Boolean(exam.questions[id]))));

check('no question appears twice', (() => {
  const all = exam.parts.flatMap((p) => p.questionIds);
  return new Set(all).size === all.length;
})());

// A passage split across parts would show it twice and strand answers.
check('no passage is split across parts', (() => {
  const partsByPassage = new Map<string, Set<number>>();
  for (const p of exam.parts) {
    for (const s of p.screens) {
      if (!s.passageId) continue;
      const set = partsByPassage.get(s.passageId) ?? new Set();
      set.add(p.index);
      partsByPassage.set(s.passageId, set);
    }
  }
  return [...partsByPassage.values()].every((set) => set.size === 1);
})());

check('no audio clip is split across parts', (() => {
  const partsByClip = new Map<string, Set<number>>();
  for (const p of exam.parts) {
    for (const s of p.screens) {
      if (!s.audioClipId) continue;
      const set = partsByClip.get(s.audioClipId) ?? new Set();
      set.add(p.index);
      partsByClip.set(s.audioClipId, set);
    }
  }
  return [...partsByClip.values()].every((set) => set.size === 1);
})());

check('questions sharing a passage share a screen', (() => {
  for (const p of exam.parts) {
    const byPassage = new Map<string, number>();
    for (const s of p.screens) {
      if (!s.passageId) continue;
      byPassage.set(s.passageId, (byPassage.get(s.passageId) ?? 0) + 1);
    }
    for (const n of byPassage.values()) if (n > 1) return false;
  }
  return true;
})());

check('sections appear in official order', (() => {
  const order = exam.parts.map((p) => p.section);
  const firstIdx = (s: string) => order.indexOf(s as (typeof order)[number]);
  return firstIdx('reading') < firstIdx('grammar')
    && firstIdx('grammar') < firstIdx('listening')
    && firstIdx('listening') < firstIdx('writing');
})(), exam.parts.map((p) => `${p.section}${p.partNo}`).join(' '));

check('listening parts are forward-only',
  exam.parts.filter((p) => p.section === 'listening').every((p) => !p.allowsBack && !p.allowsReview));
check('other parts allow review',
  exam.parts.filter((p) => p.section !== 'listening').every((p) => p.allowsBack && p.allowsReview));

check('numbering restarts per section', (() => {
  const firstOf = (sec: string) => {
    const p = exam.parts.find((x) => x.section === sec && x.partNo === 1);
    return p ? exam.numberInSection[p.questionIds[0]] : -1;
  };
  return ['reading', 'grammar', 'listening', 'writing'].every((s) => firstOf(s) === 1);
})());

// --- determinism -------------------------------------------------------
{
  const a = buildExam(FULL_STEP_BLUEPRINT, snapshot, { seed: 7 });
  const b = buildExam(FULL_STEP_BLUEPRINT, snapshot, { seed: 7 });
  const c = buildExam(FULL_STEP_BLUEPRINT, snapshot, { seed: 8 });
  const ids = (e: typeof a) => e.parts.flatMap((p) => p.questionIds).join(',');
  check('same seed builds an identical exam', ids(a) === ids(b));
  check('different seed builds a different exam', ids(a) !== ids(c));
}

// --- exclusion ---------------------------------------------------------
{
  const first = buildExam(FULL_STEP_BLUEPRINT, snapshot, { seed: 1 });
  const seen = new Set(first.parts.flatMap((p) => p.questionIds));
  const second = buildExam(FULL_STEP_BLUEPRINT, snapshot, { seed: 2, excludeIds: seen });
  const overlap = second.parts.flatMap((p) => p.questionIds).filter((id) => seen.has(id));
  check('excludeIds prevents repeats where the pool allows',
    overlap.length === 0, `${overlap.length} repeated`);
  // Listening has exactly 20 items, so a second sitting MUST come up empty.
  const listening2 = second.parts.filter((p) => p.section === 'listening')
    .reduce((n, p) => n + p.questionIds.length, 0);
  check('second sitting exhausts listening (documents the content gap)',
    listening2 === 0, `${listening2} listening questions available`);
}

// --- practice ----------------------------------------------------------
{
  const p = buildExam(practiceBlueprint('grammar' as const, 10), snapshot, { seed: 3 });
  check('practice builds a single part', p.parts.length === 1);
  check('practice has the requested count', p.parts[0].questionIds.length === 10,
    String(p.parts[0].questionIds.length));
  check('practice enables instant feedback', p.instantFeedback === true);
  check('practice has no shortfall for grammar', p.shortfalls.length === 0,
    JSON.stringify(p.shortfalls));
}

// --- drafts are never served by default --------------------------------
{
  const e = buildExam(practiceBlueprint('reading', 10), snapshot, { seed: 5 });
  const anyDraft = e.parts.flatMap((p) => p.questionIds).some((id) => e.questions[id].status !== 'published');
  check('drafts (unkeyed) are excluded from a normal build', !anyDraft);
}

let failed = 0;
for (const [n, p, note] of results) {
  if (!p) failed++;
  console.log(`  ${p ? 'PASS' : 'FAIL'}  ${n}${note ? `  (${note})` : ''}`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
