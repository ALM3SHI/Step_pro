/**
 * Exercises the Qiyas operational rules directly against the reducer.
 * No React, no DOM. npx tsx scripts/test-exam-engine.ts
 */
import {
  createExamState, examReducer, examReducerWithRevision, canGoBack, currentPart,
  isScreenLocked, scoreExam, questionCountLabel, currentScreen,
  analyzeTime, buildReviewRows,
} from '../src/lib/exam/engine';
import type { ExamAction, ExamQuestion, ExamState } from '../src/lib/exam/types';

const NOW = 1_700_000_000_000;

const q = (
  id: string,
  section: ExamQuestion['section'],
  extra: Partial<ExamQuestion> = {},
): ExamQuestion => ({
  id,
  section,
  questionText: `${id} text`,
  options: { A: 'a', B: 'b', C: 'c', D: 'd' },
  correctOption: 'A',
  ...extra,
});

const POOL: ExamQuestion[] = [
  // Reading: two passages -> two parts, 2 questions each.
  q('r1', 'reading', { passageId: 'p1', passageText: 'Passage one' }),
  q('r2', 'reading', { passageId: 'p1', passageText: 'Passage one' }),
  q('r3', 'reading', { passageId: 'p2', passageText: 'Passage two' }),
  q('r4', 'reading', { passageId: 'p2', passageText: 'Passage two' }),
  // Grammar: 9 singles. Must exceed the 3-part cap, otherwise the builder
  // produces 3 parts of ONE screen each and Back is never reachable --
  // which silently skipped this rule on the first run of these tests.
  ...Array.from({ length: 9 }, (_, i) => q(`g${i + 1}`, 'grammar')),
  // Listening: two clips, second has 2 questions.
  q('l1', 'listening', { audioId: 'a1', audioUrl: '/a1.mp3' }),
  q('l2', 'listening', { audioId: 'a2', audioUrl: '/a2.mp3' }),
  q('l3', 'listening', { audioId: 'a2', audioUrl: '/a2.mp3' }),
  // Writing: 2 singles -> one part.
  q('w1', 'writing'), q('w2', 'writing'),
];

const results: Array<[string, boolean, string?]> = [];
const check = (name: string, pass: boolean, note?: string) => results.push([name, pass, note]);

const run = (s: ExamState, ...actions: ExamAction[]) => actions.reduce(examReducer, s);

// --- blueprint ---------------------------------------------------------
let s = createExamState(POOL, { totalMinutes: 60 });

check('reading split into one part per passage',
  s.parts.filter((p) => p.section === 'reading').length === 2);
check('writing is a single part',
  s.parts.filter((p) => p.section === 'writing').length === 1);
check('listening groups by audio clip',
  s.parts.filter((p) => p.section === 'listening').every((p) => p.screens.every((sc) => sc.length >= 1)));
check('section order is reading -> grammar -> listening -> writing',
  s.parts.map((p) => p.section).join(',').startsWith('reading,reading,grammar'));
check('every part gets a non-zero duration',
  s.parts.every((p) => p.durationSeconds >= 60));
check('reading gets more time per question than writing',
  (() => {
    const r = s.parts.find((p) => p.section === 'reading')!;
    const w = s.parts.find((p) => p.section === 'writing')!;
    return r.durationSeconds / r.questionIds.length > w.durationSeconds / w.questionIds.length;
  })());
check('question numbering restarts per section',
  s.numberInSection['r1'] === 1 && s.numberInSection['g1'] === 1 && s.numberInSection['w1'] === 1);

// --- intro gate --------------------------------------------------------
check('answering before START_PART is rejected',
  run(s, { type: 'ANSWER', questionId: 'r1', option: 'A' }).answers['r1'] === undefined);

s = run(s, { type: 'START_PART', now: NOW });
check('START_PART sets a deadline', s.deadlineAt === NOW + s.parts[0].durationSeconds * 1000);
check('phase is question after start', s.phase === 'question');

// --- reading: bidirectional + review ----------------------------------
check('reading screen holds both passage questions', currentScreen(s).length === 2);
check('header label spans the screen', questionCountLabel(s) === 'Questions 1-2 of 4', questionCountLabel(s));

s = run(s, { type: 'ANSWER', questionId: 'r1', option: 'B' });
check('answer recorded', s.answers['r1'] === 'B');
check('invalid option rejected',
  run(s, { type: 'ANSWER', questionId: 'r1', option: 'Z' as 'A' }).answers['r1'] === 'B');
check('answering a question outside the current part is rejected',
  run(s, { type: 'ANSWER', questionId: 'g1', option: 'A' }).answers['g1'] === undefined);

s = run(s, { type: 'TOGGLE_FLAG', questionId: 'r1' });
check('flag set', s.flags['r1'] === true);
s = run(s, { type: 'TOGGLE_FLAG', questionId: 'r1' });
check('flag toggles off', s.flags['r1'] === undefined);
s = run(s, { type: 'TOGGLE_FLAG', questionId: 'r1' });

// Part 0 (passage 1) has a single screen -> NEXT goes to review.
s = run(s, { type: 'NEXT', now: NOW });
check('reading part ends at the review grid', s.phase === 'review');
check('flag persists into review', s.flags['r1'] === true);
check('NEXT does not skip review for reading', s.partIndex === 0);

// Review grid jump-back.
s = run(s, { type: 'GOTO_SCREEN', screenIndex: 0 });
check('review grid can jump back into a question', s.phase === 'question' && s.screenIndex === 0);

s = run(s, { type: 'NEXT', now: NOW }, { type: 'NEXT_PART', now: NOW });
check('NEXT_PART advances to reading part 2', s.partIndex === 1 && s.phase === 'question');
check('maxPartIndex tracks forward progress', s.maxPartIndex === 1);

// --- grammar: back navigation -----------------------------------------
// Walk to the grammar part.
while (currentPart(s)!.section !== 'grammar') {
  s = run(s, { type: 'NEXT', now: NOW });
  if (s.phase === 'review') s = run(s, { type: 'NEXT_PART', now: NOW });
}
check('grammar allows back after advancing', (() => {
  const t = run(s, { type: 'NEXT', now: NOW });
  return t.phase === 'question' ? canGoBack(t) : true;
})());

const gPart = currentPart(s)!;
check('grammar part has multiple screens (Back is reachable)', gPart.screens.length > 1,
  `${gPart.screens.length} screen(s)`);

{
  const t = run(s, { type: 'NEXT', now: NOW });
  const back = run(t, { type: 'BACK' });
  check('BACK returns to the previous grammar screen',
    t.phase === 'question' && back.screenIndex === t.screenIndex - 1);
  check('answers survive a Back/Next round trip', (() => {
    const answered = run(s, { type: 'ANSWER', questionId: currentScreen(s)[0], option: 'C' });
    const roundTrip = run(answered, { type: 'NEXT', now: NOW }, { type: 'BACK' });
    return roundTrip.answers[currentScreen(s)[0]] === 'C';
  })());
}
check('BACK on the first screen is a no-op', run(s, { type: 'BACK' }) === s);

// --- listening: forward-only ------------------------------------------
while (currentPart(s)!.section !== 'listening') {
  s = run(s, { type: 'NEXT', now: NOW });
  if (s.phase === 'review') s = run(s, { type: 'NEXT_PART', now: NOW });
}
const listenPartIndex = s.partIndex;
check('listening: canGoBack is false', canGoBack(s) === false);

const firstListenScreen = s.screenIndex;
s = run(s, { type: 'ANSWER', questionId: currentScreen(s)[0], option: 'B' });
const answeredListenId = Object.keys(s.answers).find((k) => k.startsWith('l'))!;

s = run(s, { type: 'NEXT', now: NOW });
check('listening: passed screen is locked',
  isScreenLocked(s, listenPartIndex, firstListenScreen));
check('listening: BACK is refused', run(s, { type: 'BACK' }) === s);
check('listening: GOTO_SCREEN is refused',
  run(s, { type: 'GOTO_SCREEN', screenIndex: 0 }) === s);

// Advance off the end of the listening part.
let guard = 0;
while (currentPart(s)?.section === 'listening' && s.phase === 'question' && guard++ < 20) {
  s = run(s, { type: 'NEXT', now: NOW });
}
check('listening: never enters a review grid',
  s.phase !== 'review' || currentPart(s)!.section !== 'listening');
check('listening: advances straight to the next part',
  currentPart(s)?.section === 'writing' || s.phase === 'finished');

// A locked listening answer cannot be changed even if replayed.
const relocked = examReducer(
  { ...s, partIndex: listenPartIndex, screenIndex: firstListenScreen, phase: 'question' },
  { type: 'ANSWER', questionId: answeredListenId, option: 'D' },
);
check('listening: locked answer is immutable', relocked.answers[answeredListenId] === 'B');

// --- timer expiry ------------------------------------------------------
let t = createExamState(POOL, { totalMinutes: 60 });
t = run(t, { type: 'START_PART', now: NOW });
const expired = run(t, { type: 'TIME_EXPIRED', now: NOW + 1 });
check('expiry advances the part', expired.partIndex === 1);
check('expiry skips the review grid', expired.phase === 'question');
check('expiry resets the deadline', expired.deadlineAt === NOW + 1 + expired.parts[1].durationSeconds * 1000);

// --- finish ------------------------------------------------------------
let f = createExamState(POOL, { totalMinutes: 60 });
f = run(f, { type: 'START_PART', now: NOW });
guard = 0;
while (f.phase !== 'finished' && guard++ < 200) {
  f = f.phase === 'review'
    ? run(f, { type: 'NEXT_PART', now: NOW })
    : run(f, { type: 'NEXT', now: NOW });
}
check('exam reaches finished state', f.phase === 'finished');
check('finishedAt is stamped', f.finishedAt === NOW);

// --- scoring -----------------------------------------------------------
const scored = { ...f, answers: { r1: 'A', r2: 'B', g1: 'A', l1: 'A', w1: 'A' } as Record<string, 'A' | 'B'> };
const score = scoreExam(scored as typeof f);
check('scoring counts only correct answers', score.correct === 4, `got ${score.correct}`);
check('unanswered counts as wrong',
  score.total === POOL.length && score.answered === 5 && score.correct < score.answered,
  `total ${score.total} answered ${score.answered} correct ${score.correct}`);
check('weighted score differs from raw', Math.abs(score.weightedPct - score.rawPct) > 0.01,
  `raw ${score.rawPct.toFixed(1)} weighted ${score.weightedPct.toFixed(1)}`);
check('section weights are the official ones',
  score.bySection.reading.weightPct === 40 && score.bySection.grammar.weightPct === 30 &&
  score.bySection.listening.weightPct === 20 && score.bySection.writing.weightPct === 10);

// --- no-op identity (render perf) --------------------------------------
check('illegal actions return the SAME object (no re-render)',
  examReducer(f, { type: 'BACK' }) === f);

// --- revision (sync ordering) ------------------------------------------
{
  let v = createExamState(POOL, { totalMinutes: 60 });
  check('revision starts at 0', v.revision === 0);

  v = examReducerWithRevision(v, { type: 'START_PART', now: NOW });
  check('accepted action bumps revision', v.revision === 1);

  const before = v;
  v = examReducerWithRevision(v, { type: 'BACK' });
  check('rejected action does NOT bump revision', v === before && v.revision === 1);

  v = examReducerWithRevision(v, { type: 'ANSWER', questionId: 'r1', option: 'A' });
  check('answer bumps revision', v.revision === 2);

  // Re-selecting the same option is a no-op and must not produce a write.
  const same = examReducerWithRevision(v, { type: 'ANSWER', questionId: 'r1', option: 'A' });
  check('re-selecting the same option does not bump revision', same === v);

  check('revision is monotonic across a full walkthrough', (() => {
    let w = createExamState(POOL, { totalMinutes: 60 });
    w = examReducerWithRevision(w, { type: 'START_PART', now: NOW });
    let last = w.revision;
    let ok = true;
    let g = 0;
    while (w.phase !== 'finished' && g++ < 200) {
      w = w.phase === 'review'
        ? examReducerWithRevision(w, { type: 'NEXT_PART', now: NOW })
        : examReducerWithRevision(w, { type: 'NEXT', now: NOW });
      if (w.revision < last) { ok = false; break; }
      last = w.revision;
    }
    return ok && w.phase === 'finished';
  })());
}

// --- part timings ------------------------------------------------------
{
  let v = createExamState(POOL, { totalMinutes: 60 });
  v = run(v, { type: 'START_PART', now: NOW });
  check('timing opens on part start',
    v.partTimings[0]?.startedAt === NOW && v.partTimings[0]?.endedAt === null);

  // Advance out of part 0 after 30s.
  let g = 0;
  while (v.partIndex === 0 && g++ < 20) {
    v = v.phase === 'review'
      ? run(v, { type: 'NEXT_PART', now: NOW + 30_000 })
      : run(v, { type: 'NEXT', now: NOW + 30_000 });
  }
  check('timing closes when the part is left', v.partTimings[0]?.endedAt === NOW + 30_000);
  check('leaving a part does not mark it expired', v.partTimings[0]?.expired === false);
  check('next part opens its own timing', v.partTimings[1]?.startedAt === NOW + 30_000);

  const analysis = analyzeTime(v);
  const p0 = analysis.parts.find((p) => p.partIndex === 0)!;
  check('analyzeTime reports 30s used', p0.usedSeconds === 30, `${p0.usedSeconds}s`);
  check('analyzeTime computes usage pct',
    Math.abs(p0.usagePct - (30 / p0.allocatedSeconds) * 100) < 0.01);

  // Expiry path.
  let e = createExamState(POOL, { totalMinutes: 60 });
  e = run(e, { type: 'START_PART', now: NOW }, { type: 'TIME_EXPIRED', now: NOW + 999_999 });
  check('expiry marks the part expired', e.partTimings[0]?.expired === true);
  check('used time is clamped to the allocation',
    analyzeTime(e).parts[0].usedSeconds === e.partTimings[0].allocatedSeconds);

  // Re-entering a part must not reset its clock.
  const reentered = run({ ...v, phase: 'intro', partIndex: 0 }, { type: 'START_PART', now: NOW + 90_000 });
  check('re-entering a part keeps the original start time',
    reentered.partTimings[0]?.startedAt === NOW);
}

// --- review rows -------------------------------------------------------
{
  let v = createExamState(POOL, { totalMinutes: 60 });
  v = run(v, { type: 'START_PART', now: NOW }, { type: 'ANSWER', questionId: 'r1', option: 'A' });
  v = { ...v, answers: { ...v.answers, r2: 'C' }, flags: { r2: true } };

  const rows = buildReviewRows(v);
  check('review rows cover every question', rows.length === POOL.length);

  const correct = rows.find((r) => r.id === 'r1')!;
  const wrong = rows.find((r) => r.id === 'r2')!;
  const skipped = rows.find((r) => r.id === 'w1')!;

  check('review marks a correct answer', correct.isCorrect && correct.chosen === 'A');
  check('review marks a wrong answer', wrong.answered && !wrong.isCorrect && wrong.chosen === 'C');
  check('review marks an unanswered question', !skipped.answered && !skipped.isCorrect);
  check('review carries the flag through', wrong.flagged === true);
  check('review exposes the correct key for the explanation UI', wrong.correct === 'A');
}

// --- report ------------------------------------------------------------
let failed = 0;
for (const [name, pass, note] of results) {
  if (!pass) failed++;
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${note ? `  (${note})` : ''}`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
