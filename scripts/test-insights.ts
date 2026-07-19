/**
 * Insight tests.
 *
 * The point of this suite is the NEGATIVE cases: an analytics engine
 * that produces confident findings from four questions is actively
 * harmful, because a learner reorganises their study around it.
 */
import { buildStudyPlan, deriveInsights } from '../src/lib/exam/insights';
import type { QuestionOutcome } from '../src/lib/exam/scoring';
import type { SectionId } from '../src/lib/content/taxonomy';

const results: Array<[string, boolean, string?]> = [];
const check = (n: string, p: boolean, note?: string) => results.push([n, p, note]);

let seq = 0;
const q = (
  section: SectionId,
  skillId: string,
  isCorrect: boolean,
  seconds: number | null = 40,
  extra: Partial<QuestionOutcome> = {},
): QuestionOutcome => ({
  questionId: `q${seq++}`,
  section,
  skillId,
  difficulty: 'medium',
  chosenOption: isCorrect ? 'A' : 'B',
  correctOption: 'A',
  isCorrect,
  wasAnswered: true,
  wasFlagged: false,
  secondsSpent: seconds,
  partIndex: 0,
  ordinal: seq,
  ...extra,
});

const many = (n: number, fn: (i: number) => QuestionOutcome) =>
  Array.from({ length: n }, (_, i) => fn(i));

// --- silence on thin evidence -----------------------------------------
check('says nothing at all on 3 questions',
  deriveInsights(many(3, () => q('grammar', 'tenses', false))).length === 0);

check('does NOT call a skill weak on 3 attempts', (() => {
  const outcomes = [
    ...many(3, () => q('grammar', 'articles', false)),
    ...many(20, () => q('grammar', 'tenses', true)),
  ];
  return !deriveInsights(outcomes).some((i) => i.text.includes('أدوات التعريف'));
})());

check('does NOT call a skill weak when it matches the overall average', (() => {
  // 50% everywhere — nothing stands out, so nothing should be claimed.
  const outcomes = [
    ...many(8, (i) => q('grammar', 'tenses', i % 2 === 0)),
    ...many(8, (i) => q('grammar', 'modals', i % 2 === 0)),
  ];
  return !deriveInsights(outcomes).some((i) => i.kind === 'weakness');
})());

// --- real weakness IS reported ----------------------------------------
check('reports a genuine weakness with enough evidence', (() => {
  const outcomes = [
    ...many(8, () => q('reading', 'ref', false)),
    ...many(20, () => q('grammar', 'tenses', true)),
  ];
  const found = deriveInsights(outcomes).find((i) => i.kind === 'weakness');
  return Boolean(found && found.text.includes('مرجع الضمير'));
})());

check('weakness cites its evidence', (() => {
  const outcomes = [
    ...many(8, () => q('reading', 'ref', false)),
    ...many(20, () => q('grammar', 'tenses', true)),
  ];
  const found = deriveInsights(outcomes).find((i) => i.kind === 'weakness');
  return Boolean(found && /\d+ من \d+/.test(found.evidence));
})());

// --- pace --------------------------------------------------------------
check('fast AND accurate is not flagged as rushing', (() => {
  const outcomes = many(12, () => q('grammar', 'tenses', true, 10));
  return !deriveInsights(outcomes).some((i) => i.text.includes('تتسرّع'));
})());

check('fast AND inaccurate IS flagged as rushing', (() => {
  const outcomes = many(12, (i) => q('grammar', 'tenses', i % 4 === 0, 8));
  return deriveInsights(outcomes).some((i) => i.text.includes('تتسرّع'));
})());

check('slow but accurate is reported differently from slow and wrong', (() => {
  const slowRight = deriveInsights(many(12, () => q('reading', 'main', true, 150)))
    .find((i) => i.kind === 'pace');
  const slowWrong = deriveInsights(many(12, (i) => q('reading', 'main', i % 5 === 0, 150)))
    .find((i) => i.kind === 'pace');
  return Boolean(slowRight && slowWrong && slowRight.text !== slowWrong.text);
})());

check('no pace claim without timing data',
  !deriveInsights(many(12, () => q('grammar', 'tenses', false, null)))
    .some((i) => i.kind === 'pace'));

// --- decay -------------------------------------------------------------
check('detects accuracy falling across the exam', (() => {
  const outcomes = [
    ...many(8, () => q('grammar', 'tenses', true)),
    ...many(8, () => q('grammar', 'modals', true)),
    ...many(8, () => q('grammar', 'conj', false)),
  ].map((o, i) => ({ ...o, ordinal: i + 1 }));
  return deriveInsights(outcomes).some((i) => i.text.includes('تنخفض مع تقدّم الاختبار'));
})());

check('does not claim decay when performance is flat', (() => {
  const outcomes = many(24, (i) => q('grammar', 'tenses', i % 2 === 0))
    .map((o, i) => ({ ...o, ordinal: i + 1 }));
  return !deriveInsights(outcomes).some((i) => i.text.includes('تنخفض'));
})());

// --- unanswered --------------------------------------------------------
check('reports unanswered questions', (() => {
  const outcomes = [
    ...many(10, () => q('grammar', 'tenses', true)),
    ...many(5, () => q('writing', 'punct', false, 0, { wasAnswered: false, chosenOption: null })),
  ];
  // The evidence line always carries the count; the headline varies by
  // whether the skips cluster in one section.
  const found = deriveInsights(outcomes).find((i) => i.evidence.includes('دون إجابة'));
  return Boolean(found);
})());

check('names the section when skips cluster there', (() => {
  const outcomes = [
    ...many(10, () => q('grammar', 'tenses', true)),
    ...many(5, () => q('writing', 'punct', false, 0, { wasAnswered: false, chosenOption: null })),
  ];
  return deriveInsights(outcomes).some((i) => i.text.includes('التحليل الكتابي'));
})());

check('does not name a section when skips are scattered', (() => {
  const outcomes = [
    ...many(10, () => q('grammar', 'tenses', true)),
    ...many(2, () => q('writing', 'punct', false, 0, { wasAnswered: false, chosenOption: null })),
    ...many(2, () => q('reading', 'main', false, 0, { wasAnswered: false, chosenOption: null })),
  ];
  const found = deriveInsights(outcomes).find((i) => i.evidence.includes('دون إجابة'));
  return Boolean(found && !found.text.includes('قسم'));
})());

// --- study plan --------------------------------------------------------
check('refuses to plan from too little data', (() => {
  const plan = buildStudyPlan(many(3, () => q('grammar', 'tenses', false)));
  return plan.tasks.length === 0 && plan.basedOn.includes('غير كافٍ');
})());

check('targets the section that costs the most weighted marks', (() => {
  // Reading at 25% (weight 40) must outrank Writing at 25% (weight 10).
  const outcomes = [
    ...many(8, (i) => q('reading', 'main', i % 4 === 0)),
    ...many(8, (i) => q('writing', 'punct', i % 4 === 0)),
  ];
  const plan = buildStudyPlan(outcomes);
  const first = plan.tasks[0]?.label ?? '';
  return first.includes('المقروء');
})());

check('does not drill a section already at 85%+', (() => {
  const outcomes = [
    ...many(20, () => q('grammar', 'tenses', true)),
    ...many(8, (i) => q('reading', 'main', i % 5 !== 0)),
  ];
  const plan = buildStudyPlan(outcomes);
  return !plan.tasks.some((t) => t.section === 'grammar' && t.questionCount);
})());

check('says so when nothing is clearly weak', (() => {
  const plan = buildStudyPlan(many(30, () => q('grammar', 'tenses', true)));
  return plan.headline.includes('متوازن');
})());

check('every plan states what it is based on',
  buildStudyPlan(many(20, (i) => q('grammar', 'tenses', i % 3 === 0))).basedOn.length > 0);

let failed = 0;
for (const [n, p, note] of results) {
  if (!p) failed++;
  console.log(`  ${p ? 'PASS' : 'FAIL'}  ${n}${note ? `  (${note})` : ''}`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
