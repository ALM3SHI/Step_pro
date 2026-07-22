/**
 * Ingestion engine v2.
 *
 * Every case here is a defect reproduced from a real import, not a
 * hypothetical. The headline one is the silent total failure: a listening
 * paste that produced 0 extracted AND 0 rejected, so the run reported
 * success having understood nothing.
 */
import { readFileSync } from 'node:fs';
import { textFileAdapter, textAdapter } from '../src/lib/ingestion/v2/source/textAdapter';
import { extractAnswerKeys, bindAnswerKeys } from '../src/lib/ingestion/v2/answerKey';
import { splitBlocks } from '../src/lib/ingestion/v2/blocks';
import { ingest, TEMPORARY_SKILL_WARNING } from '../src/lib/ingestion/v2/engine';

const results: Array<[string, boolean, string?]> = [];
const check = (n: string, p: boolean, note?: string) => results.push([n, p, note]);

// ---------------------------------------------------------------------
// 1. The 0/0 silent failure — verbatim from the user's listening paste
// ---------------------------------------------------------------------
const LISTENING_PASTE = `My sister's name is Anna. ...... is eight years old.
He
Him
She
Her
Russia is ...... than Canada.
bigger
the bigger
biggest
the biggest
He went to university in the UK ...... a PhD in physics.
get
getting
to get
to getting
In my opinion, it is not economical ........ your money on cheap, poor-quality products.
spend
spent
to spend
be spending`;

{
  const doc = await textAdapter.load(LISTENING_PASTE, 'listening paste');
  const plan = ingest(doc, { section: 'listening', assignTemporarySkill: true });

  check('listening paste no longer yields nothing', plan.questions.length > 0,
    `${plan.questions.length} questions`);
  check('all four listening questions recovered', plan.questions.length === 4,
    String(plan.questions.length));
  check('each has four options',
    plan.questions.every((q) => Object.keys(q.options).length === 4));
  check('first stem is intact',
    plan.questions[0]?.text.includes("My sister's name is Anna"));
  check('options are the real choices, in order',
    plan.questions[0]?.options.A === 'He' && plan.questions[0]?.options.D === 'Her',
    JSON.stringify(plan.questions[0]?.options));
  check('no listening question lost its skill',
    plan.questions.every((q) => Boolean(q.skillId)));
}

// ---------------------------------------------------------------------
// 2. Answer keys must never enter an option
// ---------------------------------------------------------------------
{
  const withKeys = `1. Why is the man concerned?
A) He has not finished his part
B) He lost his notes
C) He will be travelling
D) He failed the midterm

Answers:
1 C`;

  const extracted = extractAnswerKeys(withKeys);
  check('answer key removed from the text', !extracted.text.includes('Answers'));
  check('option D is not contaminated',
    !/He failed the midterm\s+Answers/.test(extracted.text),
    extracted.text.split('\n').find((l) => l.startsWith('D)')));
  check('the key itself was recovered',
    extracted.entries.length === 1 && extracted.entries[0].option === 'C');

  const doc = await textAdapter.load(withKeys, 'keyed');
  const plan = ingest(doc, { section: 'grammar' });
  check('key is bound to the question', plan.questions[0]?.correctOption === 'C',
    plan.questions[0]?.correctOption);
  check('option D stored clean',
    plan.questions[0]?.options.D === 'He failed the midterm',
    plan.questions[0]?.options.D);
}

// Prose containing key-like text must survive untouched.
{
  const prose = `Answers to these problems vary widely.
The committee gave 3 a chance to respond.
1. What is the main idea?
A) One
B) Two`;
  const r = extractAnswerKeys(prose);
  check('prose mentioning "Answers" is not deleted',
    r.text.includes('Answers to these problems'));
  check('no false keys extracted from prose', r.entries.length === 0,
    JSON.stringify(r.entries));
}

// Key formats
{
  const run = extractAnswerKeys('1. Q?\nA) a\nB) b\n1 C 2 D 3 A 4 B');
  check('key run on one line parsed', run.entries.length === 4, `${run.entries.length}`);

  const arabic = extractAnswerKeys('1. Q?\nA) a\nالإجابات:\n1-C\n2-D');
  check('arabic key header parsed', arabic.entries.length === 2, `${arabic.entries.length}`);
}

// Conflicting and invalid keys are reported, never guessed.
{
  const conflict = extractAnswerKeys('Answers:\n1 A\n1 B\n2 C');
  check('conflicting key is withheld, not guessed',
    conflict.conflicts.length === 1 && conflict.entries.every((e) => e.number !== 1),
    JSON.stringify(conflict.conflicts));

  const bound = bindAnswerKeys(
    [{ sourceNumber: 1, options: { A: 'a', B: 'b' } }],
    [{ number: 1, option: 'D', sourceLine: 1 }],
  );
  check('key naming a missing option is refused',
    bound.invalidOption.length === 1 && bound.applied.size === 0);
}

// ---------------------------------------------------------------------
// 3. Nothing is ever dropped silently
// ---------------------------------------------------------------------
{
  const junk = `This is a paragraph of prose with no structure at all.
It continues without any question or option marker.`;
  const r = splitBlocks(junk);
  check('unparseable text becomes a retained failed block',
    r.blocks.length === 0 && r.failed.length === 1);
  check('the failed block keeps the original text for review',
    r.failed[0]?.text.includes('paragraph of prose'));
  check('the failure names a reason', Boolean(r.failed[0]?.reason));
}

// ---------------------------------------------------------------------
// 4. Reading: passage structure, on the real 245KB STEP bank
// ---------------------------------------------------------------------
{
  const raw = readFileSync('reading_bank.txt', 'utf8');
  const doc = await textFileAdapter.load(raw, 'reading_bank.txt');
  const plan = ingest(doc, { section: 'reading', assignTemporarySkill: true });

  check('reading bank produces passages', plan.passages.length > 0,
    `${plan.passages.length} passages`);
  check('reading bank produces questions', plan.questions.length > 50,
    `${plan.questions.length} questions`);

  // The property the whole rewrite exists for.
  check('EVERY reading question is linked to a passage',
    plan.questions.every((q) => q.passageRef !== undefined),
    `${plan.questions.filter((q) => q.passageRef === undefined).length} orphans`);

  check('passage references resolve',
    plan.questions.every((q) => q.passageRef! < plan.passages.length));

  // The source reprints each passage before every question.
  check('repeated passages collapse to one',
    plan.report.passageReprintsCollapsed > 0,
    `${plan.report.passageReprintsCollapsed} reprints collapsed`);
  check('collapsing actually reduced the count',
    plan.passages.length < plan.questions.length,
    `${plan.passages.length} passages for ${plan.questions.length} questions`);

  const bodies = new Set(plan.passages.map((p) => p.contentHash));
  check('no two passages share a body', bodies.size === plan.passages.length);

  // Skills
  check('no reading question is left without a skill',
    plan.questions.every((q) => Boolean(q.skillId)),
    `${plan.questions.filter((q) => !q.skillId).length} skill-less`);
  check('undetected skills are flagged temporary, not hidden',
    plan.questions.filter((q) => q.warnings.includes(TEMPORARY_SKILL_WARNING)).length > 0);
  check('temporary fallback is not "main idea"',
    !plan.questions.some((q) =>
      q.warnings.includes(TEMPORARY_SKILL_WARNING) && q.skillId === 'main'));

  check('failed blocks are retained for review', plan.failed.length > 0,
    `${plan.failed.length} kept`);
  check('every failed block carries a reason and its text',
    plan.failed.every((f) => f.reason && f.text));
}

// ---------------------------------------------------------------------
// 4b. Review diagnostics: pages, linkage, confidence, unlinked, empties
// ---------------------------------------------------------------------
{
  const doc = await textFileAdapter.load(readFileSync('reading_bank.txt', 'utf8'), 'reading_bank.txt');
  const plan = ingest(doc, { section: 'reading', assignTemporarySkill: true });

  check('every question carries a source page',
    plan.questions.every((q) => typeof q.sourcePage === 'number'),
    `${plan.questions.filter((q) => q.sourcePage == null).length} missing`);
  check('every passage carries a source page',
    plan.passages.every((p) => typeof p.sourcePage === 'number'));
  check('source lines are within the document',
    plan.questions.every((q) => q.sourceLine > 0));

  // The mechanism must be reported truthfully, not invented.
  check('linked questions report the region-position mechanism',
    plan.questions.every((q) => q.linkage?.mechanism === 'region-position'));
  check('every link carries structural evidence',
    plan.questions.every((q) => (q.linkage?.evidence.length ?? 0) > 0));

  // Confidence is an audit of the link, so it must be decomposable.
  check('every linked question has a confidence score',
    plan.questions.every((q) => typeof q.confidence?.score === 'number'));
  check('confidence is bounded 0..1',
    plan.questions.every((q) => q.confidence!.score >= 0 && q.confidence!.score <= 1));
  check('confidence signals sum to the score',
    plan.questions.every((q) => {
      const sum = q.confidence!.signals.filter((s) => s.passed).reduce((n, s) => n + s.weight, 0);
      return Math.abs(sum - q.confidence!.score) < 1e-9;
    }));
  check('band matches the score',
    plan.questions.every((q) => {
      const { score, band } = q.confidence!;
      return band === (score >= 0.75 ? 'high' : score >= 0.5 ? 'medium' : 'low');
    }));

  // The rule that matters: never attach to a nearest guess.
  check('unlinked questions are a separate channel', Array.isArray(plan.unlinked));
  check('no unlinked question carries a passageRef',
    plan.unlinked.every((u) => u.passageRef === undefined));
  check('every unlinked question states why',
    plan.unlinked.every((u) => Boolean(u.reason)));
  check('unlinked are NOT counted among linked questions',
    plan.questions.every((q) => q.passageRef !== undefined));

  // Empty passages get a probable cause rather than silence.
  check('empty passages are reported with a cause',
    plan.emptyPassages.every((p) => Boolean(p.probableCause)));
  check('empty passages are genuinely unreferenced',
    plan.emptyPassages.every((e) =>
      !plan.questions.some((q) => q.passageRef === e.index)));

  // Report totals must agree with the arrays they summarise.
  check('report.unlinkedQuestions matches the array',
    plan.report.unlinkedQuestions === plan.unlinked.length);
  check('report.emptyPassages matches the array',
    plan.report.emptyPassages === plan.emptyPassages.length);
  check('report.temporarySkills matches the flagged questions',
    plan.report.temporarySkills ===
      plan.questions.filter((q) => q.warnings.includes(TEMPORARY_SKILL_WARNING)).length);
  check('report.confidence bands sum to linked questions',
    plan.report.confidence.high + plan.report.confidence.medium + plan.report.confidence.low
      === plan.questions.length);
  check('report.duplicatePassagesMerged equals total reprints',
    plan.report.duplicatePassagesMerged ===
      plan.passages.reduce((n, p) => n + Math.max(0, p.occurrences - 1), 0));
}

// Page numbers must survive answer-key removal, which renumbers lines.
{
  const doc = await textAdapter.load(
    `Answers:\n1 A\n2 B\n\n1. First question here?\nA) one\nB) two\n\n2. Second question here?\nA) three\nB) four`,
    'keyed',
  );
  const plan = ingest(doc, { section: 'grammar' });
  check('questions after a key block still resolve a page',
    plan.questions.every((q) => typeof q.sourcePage === 'number'),
    JSON.stringify(plan.questions.map((q) => q.sourcePage)));
}

// ---------------------------------------------------------------------
// 5. Parsers are chosen, not guessed
// ---------------------------------------------------------------------
{
  const doc = await textAdapter.load(LISTENING_PASTE, 'x');
  const asListening = ingest(doc, { section: 'listening' });
  const asGrammar = ingest(doc, { section: 'grammar' });
  check('the chosen section decides the parser',
    asListening.report.parser !== asGrammar.report.parser,
    `${asListening.report.parser} vs ${asGrammar.report.parser}`);
  check('the report states which parser ran',
    asListening.report.parser.includes('Listening'));
}

// ---------------------------------------------------------------------
// 6. The report answers "what did this run actually do"
// ---------------------------------------------------------------------
{
  const doc = await textAdapter.load(LISTENING_PASTE, 'listening paste');
  const { report } = ingest(doc, { section: 'listening' });
  for (const field of [
    'pagesScanned', 'passagesFound', 'questionsFound', 'answerKeysFound',
    'answerKeysBound', 'questionsWithoutKey', 'imagesSkipped', 'chartsSkipped',
    'tablesSkipped', 'duplicatesInPayload', 'failedBlocks',
  ] as const) {
    check(`report includes ${field}`, typeof report[field] === 'number');
  }
  check('report names the source', report.source.name === 'listening paste');
}

// ---------------------------------------------------------------------
let failed = 0;
for (const [name, pass, note] of results) {
  if (!pass) failed++;
  console.log(`${pass ? '  ok  ' : ' FAIL '} ${name}${note ? `  (${note})` : ''}`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
if (failed) process.exit(1);
