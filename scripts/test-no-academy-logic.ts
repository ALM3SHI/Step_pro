/**
 * The parser must key on STRUCTURE, never on an academy's identity.
 *
 * A rule that says `if (text.includes("Efada"))` would pass every corpus
 * test today and fail the first file from a new academy. This scan makes
 * that class of rule a build failure: no academy name, channel handle, or
 * file-specific literal may appear in the ingestion engine.
 *
 * Structure is allowed and encouraged — "a line of only tildes is a
 * divider", "options in parentheses split by a dash". Identity is banned.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const ENGINE_DIR = 'src/lib/ingestion';

/**
 * Tokens that would tie the parser to a specific source.
 *
 * Academy names (Latin and Arabic), social handles, and the literal
 * filenames of the corpus. Deliberately includes the Arabic spellings —
 * a rule keying on "الإفادة" is exactly as forbidden as one keying on
 * "Efada".
 */
const FORBIDDEN: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /efada|إفادة|الافادة|اإلفادة/i, label: 'academy name (Efada / الإفادة)' },
  { pattern: /ozayz|@\w{3,}/i, label: 'social handle' },
  { pattern: /academy-[ab]\b|academy_[ab]\b/i, label: 'corpus filename' },
  { pattern: /reading-academy|grammar-academy/i, label: 'corpus filename' },
  { pattern: /\bModel\s*\d{3,}\b/, label: 'a specific academy\'s "Model NNNN" label as a literal' },
];

/**
 * Words that are fine as STRUCTURE but suspicious as hardcoded identity.
 * Flagged for review, not failed — a comment explaining the structure is
 * the intended use.
 */
const results: Array<[string, boolean, string?]> = [];
const check = (n: string, p: boolean, note?: string) => results.push([n, p, note]);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

const files = walk(ENGINE_DIR);
check(`${ENGINE_DIR} has source files`, files.length > 0, `${files.length} files`);

let violations = 0;
for (const file of files) {
  const source = readFileSync(file, 'utf8');
  // Strip comments: a comment may legitimately quote a source line as an
  // example ("e.g. '11 Model 500'"), and the rule keys on structure.
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');

  for (const { pattern, label } of FORBIDDEN) {
    const m = code.match(pattern);
    if (m) {
      violations++;
      check(`${path.basename(file)}: no ${label}`, false, `found "${m[0]}"`);
    }
  }
}

check('no academy-specific literal in engine code', violations === 0,
  violations ? `${violations} violation(s)` : 'clean');

let failed = 0;
for (const [name, pass, note] of results) {
  if (!pass) failed++;
  console.log(`${pass ? '  ok  ' : ' FAIL '} ${name}${note ? `  (${note})` : ''}`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
if (failed) process.exit(1);
