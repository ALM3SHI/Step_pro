/**
 * Fast-Key parser tests.
 *
 * Heavy on adversarial cases: a parser that silently mis-binds 100
 * answers is worse than one that refuses to parse, so most of these
 * assert that bad input is REPORTED rather than guessed at.
 */
import { parseFastKeys, bindFastKeys, buildExternalPrompt, type BindableQuestion } from '../src/lib/ingestion/fastkey';

const results: Array<[string, boolean, string?]> = [];
const check = (name: string, pass: boolean, note?: string) => results.push([name, pass, note]);

const keysOf = (s: string) =>
  parseFastKeys(s).entries.map((e) => `${e.index}${e.option}`).join(' ');

// --- format coverage ---------------------------------------------------
check('colon format  1:A, 2:B, 3:D', keysOf('1:A, 2:B, 3:D') === '1A 2B 3D');
check('dot format    1. A / 2. B', keysOf('1. A\n2. B\n3. C') === '1A 2B 3C');
check('dash format   1-A, 2-B', keysOf('1-A, 2-B, 3-C') === '1A 2B 3C');
check('paren format  1) A', keysOf('1) A\n2) B') === '1A 2B');
check('space format  1 A', keysOf('1 A\n2 B\n3 C') === '1A 2B 3C');
check('bracket       [1] A', keysOf('[1] A  [2] B') === '1A 2B');
check('Q prefix      Q1: A', keysOf('Q1: A\nQ2: D') === '1A 2D');
check('hash prefix   #1 A', keysOf('#1 A\n#2 C') === '1A 2C');
check('markdown bold **1.** A', keysOf('**1.** A\n**2.** B') === '1A 2B');
check('markdown table | 1 | A |', keysOf('| 1 | A |\n| 2 | C |') === '1A 2C');
check('lowercase letters', keysOf('1:a, 2:b, 3:c') === '1A 2B 3C');
check('arabic digits + latin letters', keysOf('١:A, ٢:B') === '1A 2B');
check('arabic letters', keysOf('1:أ, 2:ب, 3:ج, 4:د') === '1A 2B 3C 4D');
check('mixed formats in one paste', keysOf('1:A\n2. B\n3-C\n4) D') === '1A 2B 3C 4D');
check('all on one line, no separators beyond space',
  keysOf('1 A 2 B 3 C 4 D') === '1A 2B 3C 4D');
check('semicolon separated', keysOf('1:A; 2:B; 3:C') === '1A 2B 3C');
check('100 keys parse', parseFastKeys(
  Array.from({ length: 100 }, (_, i) => `${i + 1}:${'ABCD'[i % 4]}`).join(', ')
).entries.length === 100);

// --- explanations ------------------------------------------------------
{
  const r = parseFastKeys('1. A — الفاعل مفرد غائب فيأخذ s\n2. B - preposition of place');
  check('captures Arabic explanation after em dash',
    r.entries[0].explanation?.startsWith('الفاعل') === true, r.entries[0].explanation);
  check('captures English explanation after hyphen',
    r.entries[1].explanation === 'preposition of place', r.entries[1].explanation);
  check('explanation does not corrupt the option', keysOf('1. A — anything here') === '1A');
}

// --- the dangerous cases ----------------------------------------------
check('does NOT read "1. Around the world" as 1:A',
  parseFastKeys('1. Around the world').entries.length === 0);
check('does NOT read prose words as options',
  parseFastKeys('1. Because the answer is obvious').entries.length === 0);
check('does NOT match letters inside words',
  parseFastKeys('1. Apple\n2. Banana').entries.length === 0);

{
  // Gap in the middle — the classic off-by-one trap.
  const r = parseFastKeys('1:A, 2:B, 4:D');
  check('a gap does NOT shift later keys',
    r.entries.find((e) => e.index === 4)?.option === 'D' &&
    !r.entries.some((e) => e.index === 3));
}

{
  const r = parseFastKeys('1:A, 2:B, 2:C');
  check('conflicting duplicate is reported, not silently resolved',
    r.conflicts.length === 1 && r.conflicts[0].index === 2 &&
    r.conflicts[0].kept === 'B' && r.conflicts[0].discarded === 'C');
  check('conflicting duplicate keeps the first answer',
    r.entries.find((e) => e.index === 2)?.option === 'B');
}

check('identical duplicate is not a conflict',
  parseFastKeys('1:A, 1:A').conflicts.length === 0);

// Regression: a duplicate used to consume the separator before the NEXT
// entry, silently swallowing it. Found by driving the real UI.
check('entry AFTER a conflicting duplicate is not swallowed',
  keysOf('1:D\n2:B\n2:C\n3:B\n5:A') === '1D 2B 3B 5A',
  keysOf('1:D\n2:B\n2:C\n3:B\n5:A'));
check('entry after duplicate survives on one line too',
  keysOf('1:A, 2:B, 2:C, 3:D') === '1A 2B 3D', keysOf('1:A, 2:B, 2:C, 3:D'));
check('two consecutive duplicates still do not swallow',
  keysOf('1:A, 1:B, 1:C, 2:D') === '1A 2D', keysOf('1:A, 1:B, 1:C, 2:D'));

// Regression: a discarded duplicate was reported as "malformed", sending
// the admin to investigate a line the parser understood correctly.
{
  const r = parseFastKeys('1:A\n2:B\n2:C\n3:D');
  check('discarded duplicate is NOT reported as malformed',
    r.malformed.length === 0, JSON.stringify(r.malformed));
  check('the duplicate IS reported as a conflict', r.conflicts.length === 1);
}

{
  const r = parseFastKeys('1:A\n2:B\n3. this line has no key at all\n4:D');
  check('a genuinely unparseable numbered line IS reported',
    r.malformed.length === 1 && r.malformed[0].startsWith('3.'), JSON.stringify(r.malformed));
  check('surrounding entries still parse', keysOf('1:A\n2:B\n3. no key here\n4:D') === '1A 2B 4D');
}

check('unrecognised input yields nothing and reports it', (() => {
  const r = parseFastKeys('I could not determine the answers, sorry!');
  return r.entries.length === 0 && r.detectedFormat === 'unrecognised';
})());

check('empty input is handled', parseFastKeys('   ').detectedFormat === 'empty');

// --- bare sequence (positional) ---------------------------------------
{
  const r = parseFastKeys('A, B, C, D');
  check('bare sequence parses positionally',
    r.entries.map((e) => `${e.index}${e.option}`).join(' ') === '1A 2B 3C 4D');
  check('bare sequence is FLAGGED as positional', r.positional === true);
}
check('numbered input is never treated as positional',
  parseFastKeys('1:A, 2:B').positional === false);

// --- binding -----------------------------------------------------------
const q = (ref: string, keys = 'ABCD'): BindableQuestion => ({
  ref,
  questionText: `${ref} text`,
  options: Object.fromEntries([...keys].map((k) => [k, `opt ${k}`])) as BindableQuestion['options'],
});

const staged = Array.from({ length: 5 }, (_, i) => q(`q${i}`));

{
  const out = bindFastKeys(staged, parseFastKeys('1:A, 2:B, 3:C, 4:D, 5:A'));
  check('binds all five by declared number', out.stats.applied === 5);
  check('coverage is 100%', out.stats.coverage === 1);
  check('binds to the right question',
    out.applied[2].question.ref === 'q2' && out.applied[2].option === 'C');
  check('nothing unmatched', out.unmatched.length === 0);
}

{
  // Model skipped #3 — the case that silently corrupts naive parsers.
  const out = bindFastKeys(staged, parseFastKeys('1:A, 2:B, 4:D, 5:A'));
  check('skipped key leaves that question unmatched, others correct',
    out.unmatched.length === 1 && out.unmatched[0].ref === 'q2' &&
    out.applied.find((a) => a.question.ref === 'q3')?.option === 'D');
}

{
  const out = bindFastKeys(staged, parseFastKeys('1:A, 2:B, 99:D'));
  check('out-of-range key is reported, not applied',
    out.outOfRange.length === 1 && out.outOfRange[0].index === 99 && out.stats.applied === 2);
}

{
  const threeOpt = [q('t0', 'ABC')];
  const out = bindFastKeys(threeOpt, parseFastKeys('1:D'));
  check('key naming a nonexistent option is rejected',
    out.invalidOption.length === 1 && out.stats.applied === 0);
}

{
  const out = bindFastKeys(staged, parseFastKeys('1:A, 2:B'));
  check('partial coverage reported accurately',
    out.stats.applied === 2 && out.unmatched.length === 3 &&
    Math.abs(out.stats.coverage - 0.4) < 0.001);
}

{
  const out = bindFastKeys(staged, parseFastKeys('1. A — شرح أول\n2. B — شرح ثاني'));
  check('explanations bind alongside options',
    out.applied[0].explanation === 'شرح أول' && out.applied[1].explanation === 'شرح ثاني');
}

// --- round trip: prompt -> answer -> bind ------------------------------
{
  const questions = [
    { questionText: 'He ____ to school.', options: { A: 'go', B: 'goes', C: 'going', D: 'gone' } },
    { questionText: 'She lives ____ Riyadh.', options: { A: 'on', B: 'of', C: 'at', D: 'in' } },
  ];
  const prompt = buildExternalPrompt(questions);
  check('prompt numbers questions from 1', prompt.includes('1. He ____ to school.'));
  check('prompt lists lettered options', prompt.includes('A) go'));
  check('prompt requests the parseable format', prompt.includes('"N: X"'));

  const bound = bindFastKeys(
    questions.map((x, i) => ({ ref: `r${i}`, questionText: x.questionText, options: x.options })),
    parseFastKeys('1: B, 2: D'),
  );
  check('round trip binds correctly',
    bound.applied[0].option === 'B' && bound.applied[1].option === 'D');
}

// --- realistic messy LLM output ---------------------------------------
{
  const messy = `Sure! Here are the answers:

1. B
2. D
3. A
4. C

Let me know if you need explanations!`;
  const r = parseFastKeys(messy);
  check('tolerates preamble and trailing chatter',
    r.entries.map((e) => `${e.index}${e.option}`).join(' ') === '1B 2D 3A 4C',
    r.entries.map((e) => `${e.index}${e.option}`).join(' '));
}

{
  const table = `| # | Answer |
|---|--------|
| 1 | C |
| 2 | A |
| 3 | B |`;
  check('tolerates a markdown table with a header',
    keysOf(table) === '1C 2A 3B', keysOf(table));
}

// --- report ------------------------------------------------------------
let failed = 0;
for (const [name, pass, note] of results) {
  if (!pass) failed++;
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${note !== undefined ? `  (got: ${note})` : ''}`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
