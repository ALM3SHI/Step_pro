/**
 * Every content server action must call `requireAdmin()`.
 *
 * A 'use server' export is a public HTTP endpoint reachable from any
 * route, so the middleware that hides `/admin` does not protect it. The
 * guard is one easily-forgotten line at the top of each function — this
 * check exists so forgetting it fails the build instead of quietly
 * reopening the question bank.
 *
 * Read as source text rather than by importing: importing would need a
 * request context, and the property under test is "the call is written
 * in the function", which the text answers directly.
 */
import { readFileSync } from 'node:fs';

interface Guarded {
  file: string;
  /** Actions allowed to skip the guard, with the reason. */
  exempt?: Record<string, string>;
}

const GUARDED: Guarded[] = [
  { file: 'src/app/actions/content.ts' },
  { file: 'src/app/actions/ingestion.ts' },
];

/**
 * Importers must not be able to publish.
 *
 * Bulk paths write hundreds of rows at once with no per-item review, so
 * a `status` they can choose is a way to put unvetted questions into a
 * graded exam. The literal below is the enforcement; this check is what
 * stops it being "simplified" back into a variable later.
 */
const NEVER_PUBLISHES = ['src/app/actions/ingestion.ts'];

const results: Array<[string, boolean, string?]> = [];
const check = (n: string, p: boolean, note?: string) => results.push([n, p, note]);

for (const { file, exempt = {} } of GUARDED) {
  const source = readFileSync(file, 'utf8');

  // Split on each exported async action; the body of one runs to the
  // start of the next.
  const starts: Array<{ name: string; at: number }> = [];
  const re = /export\s+async\s+function\s+(\w+)\s*\(/g;
  for (let m = re.exec(source); m; m = re.exec(source)) {
    starts.push({ name: m[1], at: m.index });
  }

  check(`${file}: exports actions`, starts.length > 0, `${starts.length} found`);

  for (let i = 0; i < starts.length; i++) {
    const { name, at } = starts[i];
    const body = source.slice(at, starts[i + 1]?.at ?? source.length);

    if (exempt[name]) {
      check(`${file}: ${name} exempt`, !body.includes('requireAdmin'), exempt[name]);
      continue;
    }

    check(`${name} calls requireAdmin`, /await\s+requireAdmin\s*\(\s*\)/.test(body));
  }
}

for (const file of NEVER_PUBLISHES) {
  const source = readFileSync(file, 'utf8');

  /**
   * Only QUESTION-row statuses are in scope.
   *
   * `ingestion_batches.status` is a job lifecycle ('processing' ->
   * 'completed') and has nothing to do with whether content is live. A
   * status write is treated as a question write when `question_text`
   * appears in the same object literal.
   */
  const questionStatusWrites = [...source.matchAll(/^\s*status:\s*(.+?),\s*$/gm)]
    .map((m) => ({ value: m[1].trim(), at: m.index ?? 0 }))
    .filter(({ at }) => source.slice(at, at + 600).includes('question_text:'));

  check(
    `${file}: writes a question status at all`,
    questionStatusWrites.length > 0,
    `${questionStatusWrites.length} write(s)`,
  );
  for (const [i, { value }] of questionStatusWrites.entries()) {
    check(`${file}: question status #${i + 1} is the literal 'draft'`, value === "'draft'", value);
  }

  // And no code path may mention publishing.
  check(`${file}: never writes 'published'`, !source.includes("'published'"));
}

// The guard itself must fail shut when nothing is configured.
const adminSource = readFileSync('src/lib/auth/admin.ts', 'utf8');
check(
  'requireAdmin refuses when ADMIN_PASSWORD is unset',
  /isAdminConfigured\(\)\)\s*throw/.test(adminSource),
);

let failed = 0;
for (const [name, pass, note] of results) {
  if (!pass) failed++;
  console.log(`${pass ? '  ok  ' : ' FAIL '} ${name}${note ? `  (${note})` : ''}`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
if (failed) process.exit(1);
