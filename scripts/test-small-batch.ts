/**
 * Short batches (a listening clip with 1-3 questions) used to parse to
 * nothing: too few `N / M` markers to trigger quiz-export detection, so
 * the markers were left unprotected and deleted as page numbers.
 * Found by driving the listening admin UI, not by unit tests.
 */
import { runPipeline } from '../src/lib/ingestion/pipeline';

const results: Array<[string, boolean, string?]> = [];
const check = (n: string, p: boolean, note?: string) => results.push([n, p, note]);

const clip2 = `1 / 2
This conversation most likely takes place
In a grocery store
In a restaurant
In a house
On a train
2 / 2
Who is the caller talking to?
A tourism guide
A sales manager
A travel attendant
A travel agent`;

{
  const r = runPipeline(clip2);
  check('2-question clip parses', r.stats.parsed === 2, `parsed ${r.stats.parsed}, strategy ${r.stats.strategy}`);
  check('2-question clip keeps all four options',
    r.questions.every((q) => Object.keys(q.options).length === 4));
  check('first question text is intact',
    r.questions[0]?.questionText === 'This conversation most likely takes place',
    r.questions[0]?.questionText);
  check('options are not shifted',
    r.questions[0]?.options.B === 'In a restaurant', r.questions[0]?.options.B);
}

// Single-question clip — the smallest real unit.
{
  const clip1 = `1 / 1
What kind of project is Osama working on?
A current events project
A business project
A family project
A history project`;
  const r = runPipeline(clip1);
  check('1-question clip parses', r.stats.parsed === 1, `parsed ${r.stats.parsed}, strategy ${r.stats.strategy}`);
}

// Three questions on one clip, the largest listening group in the corpus.
{
  const clip3 = `1 / 3
This announcement would probably be heard in an airport in
Doha
Bahrain
Riyadh
Frankfurt
2 / 3
What has caused the delay?
A mechanical problem
A scheduling problem
A medical problem
A security problem
3 / 3
Passengers are asked to board the flight at
Gate A6
Gate B2
The main terminal
The security checkpoints`;
  const r = runPipeline(clip3);
  check('3-question clip parses', r.stats.parsed === 3, `parsed ${r.stats.parsed}`);
  check('third question is not truncated',
    r.questions[2]?.options.A === 'Gate A6', r.questions[2]?.options.A);
}

// A genuine page number must still be strippable when it is NOT a boundary.
{
  const withPage = `Page 3 of 12
1. He ____ to school every day.
go
goes
going
gone
2. She lives ____ Riyadh.
on
of
at
in`;
  const r = runPipeline(withPage);
  check('prose page header does not break numbered-bare parsing',
    r.stats.parsed === 2, `parsed ${r.stats.parsed}, strategy ${r.stats.strategy}`);
}

let failed = 0;
for (const [n, p, note] of results) {
  if (!p) failed++;
  console.log(`  ${p ? 'PASS' : 'FAIL'}  ${n}${note ? `  (${note})` : ''}`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
