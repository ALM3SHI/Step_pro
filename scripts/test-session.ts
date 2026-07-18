/**
 * Session reducer tests, driven by a REAL exam built from the bundle.
 */
import { loadBundleSnapshot } from '../src/lib/content/bundleProvider';
import { FULL_STEP_BLUEPRINT, practiceBlueprint } from '../src/lib/content/blueprint';
import { buildExam } from '../src/lib/exam/buildExam';
import {
  createSession, sessionReducer, sessionReducerWithRevision, canGoBack, currentPart,
  currentScreen, isScreenLocked, questionCountLabel,
  type SessionAction, type SessionState,
} from '../src/lib/exam/session';

const NOW = 1_700_000_000_000;
const results: Array<[string, boolean, string?]> = [];
const check = (n: string, p: boolean, note?: string) => results.push([n, p, note]);
const run = (s: SessionState, ...a: SessionAction[]) => a.reduce(sessionReducer, s);

const snapshot = loadBundleSnapshot();
const exam = buildExam(FULL_STEP_BLUEPRINT, snapshot, { seed: 42 });

// --- briefing gate -----------------------------------------------------
let s = createSession(exam);
check('starts at briefing', s.phase === 'briefing');
check('cannot answer during briefing',
  run(s, { type: 'ANSWER', questionId: exam.parts[0].questionIds[0], option: 'A' }).answers === s.answers);
check('cannot start a part before beginning',
  run(s, { type: 'START_PART', now: NOW }) === s);

s = run(s, { type: 'BEGIN', now: NOW });
check('BEGIN moves to part intro', s.phase === 'part-intro');
check('no clock runs during the intro', s.deadlineAt === null);

s = run(s, { type: 'START_PART', now: NOW });
check('START_PART opens the question phase', s.phase === 'question');
check('deadline matches the part duration',
  s.deadlineAt === NOW + exam.parts[0].durationSeconds * 1000);
check('header labels the screen', /^Questions? \d/.test(questionCountLabel(s)), questionCountLabel(s));

// --- answering ---------------------------------------------------------
const q0 = currentScreen(s)!.questionIds[0];
s = run(s, { type: 'ANSWER', questionId: q0, option: 'B' });
check('answer recorded', s.answers[q0] === 'B');
check('re-selecting the same option is a no-op',
  run(s, { type: 'ANSWER', questionId: q0, option: 'B' }) === s);
check('option not on the question is rejected',
  run(s, { type: 'ANSWER', questionId: q0, option: 'Z' as 'A' }).answers[q0] === 'B');
check('question outside the part is rejected',
  run(s, { type: 'ANSWER', questionId: exam.parts[5].questionIds[0], option: 'A' }).answers[exam.parts[5].questionIds[0]] === undefined);

s = run(s, { type: 'TOGGLE_FLAG', questionId: q0 });
check('flag set', s.flags[q0] === true);
check('flag toggles off', run(s, { type: 'TOGGLE_FLAG', questionId: q0 }).flags[q0] === undefined);

// --- reading: back + review -------------------------------------------
check('reading allows back after advancing', (() => {
  const t = run(s, { type: 'NEXT', now: NOW });
  return t.phase === 'question' ? canGoBack(t) : true;
})());

{
  // Walk part 0 to its end.
  let t = s;
  let guard = 0;
  while (t.phase === 'question' && guard++ < 50) t = run(t, { type: 'NEXT', now: NOW });
  check('reading part ends at the review grid', t.phase === 'review');
  check('review does not advance the part', t.partIndex === 0);

  const back = run(t, { type: 'GOTO_SCREEN', screenIndex: 0 });
  check('review grid jumps back into a question', back.phase === 'question' && back.screenIndex === 0);
  check('answers survive the jump', back.answers[q0] === 'B');

  const advanced = run(t, { type: 'NEXT_PART', now: NOW });
  check('NEXT_PART shows the next part intro', advanced.phase === 'part-intro' && advanced.partIndex === 1);
  check('maxPartIndex tracks forward progress', advanced.maxPartIndex === 1);
  check('the next part clock has NOT started', advanced.deadlineAt === null);
}

// --- listening: forward-only ------------------------------------------
{
  let t = createSession(exam);
  t = run(t, { type: 'BEGIN', now: NOW });
  let guard = 0;
  while (currentPart(t)?.section !== 'listening' && guard++ < 60) {
    if (t.phase === 'part-intro') t = run(t, { type: 'START_PART', now: NOW });
    else if (t.phase === 'review') t = run(t, { type: 'NEXT_PART', now: NOW });
    else t = run(t, { type: 'NEXT', now: NOW });
  }
  t = run(t, { type: 'START_PART', now: NOW });

  check('reached a listening part', currentPart(t)?.section === 'listening');
  check('listening: back is unavailable', canGoBack(t) === false);

  const firstScreen = t.screenIndex;
  const lq = currentScreen(t)!.questionIds[0];
  t = run(t, { type: 'ANSWER', questionId: lq, option: 'B' });
  const passed = run(t, { type: 'NEXT', now: NOW });

  check('listening: passed screen is locked', isScreenLocked(passed, passed.partIndex, firstScreen));
  check('listening: BACK is refused', run(passed, { type: 'BACK' }) === passed);
  check('listening: GOTO_SCREEN is refused',
    run(passed, { type: 'GOTO_SCREEN', screenIndex: 0 }) === passed);

  // A locked answer must be immutable even if the screen is forced back.
  const forced = sessionReducer(
    { ...passed, screenIndex: firstScreen, phase: 'question' },
    { type: 'ANSWER', questionId: lq, option: 'D' },
  );
  check('listening: locked answer cannot be changed', forced.answers[lq] === 'B');

  // Run the listening part out.
  let u = passed;
  guard = 0;
  while (currentPart(u)?.section === 'listening' && u.phase === 'question' && guard++ < 30) {
    u = run(u, { type: 'NEXT', now: NOW });
  }
  check('listening never shows a review grid',
    u.phase !== 'review' || currentPart(u)?.section !== 'listening');
}

// --- timer expiry ------------------------------------------------------
{
  let t = createSession(exam);
  t = run(t, { type: 'BEGIN', now: NOW }, { type: 'START_PART', now: NOW });
  const expired = run(t, { type: 'TIME_EXPIRED', now: NOW + 1 });
  check('expiry advances past the part', expired.partIndex === 1);
  check('expiry skips the review grid', expired.phase === 'part-intro');
  check('expiry marks the timing expired', expired.partTimings[0]?.expired === true);
  check('expiry during an intro is ignored',
    run({ ...t, phase: 'part-intro' }, { type: 'TIME_EXPIRED', now: NOW + 1 }).partIndex === 0);
}

// --- full run to finish ------------------------------------------------
{
  let t = createSession(exam);
  t = run(t, { type: 'BEGIN', now: NOW });
  let guard = 0;
  while (t.phase !== 'finished' && guard++ < 400) {
    if (t.phase === 'part-intro') t = run(t, { type: 'START_PART', now: NOW });
    else if (t.phase === 'review') t = run(t, { type: 'NEXT_PART', now: NOW });
    else t = run(t, { type: 'NEXT', now: NOW });
  }
  check('exam reaches finished', t.phase === 'finished', `after ${guard} steps`);
  check('finishedAt is stamped', t.finishedAt === NOW);
  check('every part was timed',
    Object.keys(t.partTimings).length === exam.parts.length,
    `${Object.keys(t.partTimings).length}/${exam.parts.length}`);
}

// --- practice mode -----------------------------------------------------
{
  const practice = buildExam(practiceBlueprint('grammar', 5), snapshot, { seed: 3 });
  let t = createSession(practice);
  t = run(t, { type: 'BEGIN', now: NOW }, { type: 'START_PART', now: NOW });

  const pq = currentScreen(t)!.questionIds[0];
  check('reveal before answering is refused',
    run(t, { type: 'REVEAL', questionId: pq }).revealed[pq] === undefined);

  t = run(t, { type: 'ANSWER', questionId: pq, option: 'A' }, { type: 'REVEAL', questionId: pq });
  check('reveal after answering works', t.revealed[pq] === true);
  check('answer is locked once revealed',
    run(t, { type: 'ANSWER', questionId: pq, option: 'C' }).answers[pq] === 'A');
}
{
  // Reveal must do nothing in a graded exam.
  let t = createSession(exam);
  t = run(t, { type: 'BEGIN', now: NOW }, { type: 'START_PART', now: NOW });
  const gq = currentScreen(t)!.questionIds[0];
  t = run(t, { type: 'ANSWER', questionId: gq, option: 'A' }, { type: 'REVEAL', questionId: gq });
  check('graded exam never reveals answers', t.revealed[gq] === undefined);
}

// --- revision ----------------------------------------------------------
{
  let t = createSession(exam);
  check('revision starts at 0', t.revision === 0);
  t = sessionReducerWithRevision(t, { type: 'BEGIN', now: NOW });
  check('accepted action bumps revision', t.revision === 1);
  const before = t;
  t = sessionReducerWithRevision(t, { type: 'BACK' });
  check('rejected action does not bump revision', t === before);
}

check('illegal action returns the SAME object', (() => {
  const t = createSession(exam);
  return sessionReducer(t, { type: 'BACK' }) === t;
})());

let failed = 0;
for (const [n, p, note] of results) {
  if (!p) failed++;
  console.log(`  ${p ? 'PASS' : 'FAIL'}  ${n}${note ? `  (${note})` : ''}`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
