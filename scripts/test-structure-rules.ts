/**
 * Structure-based normalisation and inline-option parsing.
 *
 * Every rule here keys on SHAPE, and every rule is proven to leave the
 * two text corpora untouched (they parse to 150/150 before and after) —
 * the guard against a rule that helps one file and breaks another. The
 * academy-identity guard is a separate test; this one is about
 * generalisation.
 */
import { readFileSync, existsSync } from 'node:fs';
import {
  structuralClean, extractInlineOptions,
} from '../src/lib/ingestion/v2/structure';
import { splitBlocks } from '../src/lib/ingestion/v2/blocks';
import { textFileAdapter } from '../src/lib/ingestion/v2/source/textAdapter';
import { ingest } from '../src/lib/ingestion/v2/engine';

const results: Array<[string, boolean, string?]> = [];
const check = (n: string, p: boolean, note?: string) => results.push([n, p, note]);

// --- inline options: the separators real files use -------------------
const opt = (s: string) => {
  const r = extractInlineOptions(s);
  return r ? Object.values(r.options) : null;
};
check('en-dash separated', JSON.stringify(opt('(mine – her – his – he)')) === JSON.stringify(['mine', 'her', 'his', 'he']));
check('spaced-hyphen separated', JSON.stringify(opt('(me - my - mine)')) === JSON.stringify(['me', 'my', 'mine']));
check('hyphen-both-sides', JSON.stringify(opt('(at -in- on)')) === JSON.stringify(['at', 'in', 'on']));
check('slash separated', JSON.stringify(opt('(thinks/ is thinking)')) === JSON.stringify(['thinks', 'is thinking']));
check('dash wins over intra-option slash',
  JSON.stringify(opt('(have/ learn – had / had learned)')) === JSON.stringify(['have/ learn', 'had / had learned']));

// --- inline options embedded mid-stem --------------------------------
{
  const r = extractInlineOptions('5. My father was born (at - in - on) June 22, 1988.');
  check('mid-stem group extracted', JSON.stringify(r && Object.values(r.options)) === JSON.stringify(['at', 'in', 'on']));
  check('stem keeps text around the blank',
    Boolean(r && r.stem.includes('was born') && r.stem.includes('June 22')), r?.stem);
}

// --- must NOT fire on ordinary prose parentheses ---------------------
check('prose "(see below)" is not options', opt('Refer to the map (see below).') === null);
check('single item "(1)" is not options', opt('The first paragraph (1)') === null);
check('a hyphenated word is not options', opt('a well-known author') === null);

// --- structuralClean: dividers ---------------------------------------
{
  const r = structuralClean('a\n~~~~~~~~~~\nb\n=========\nc', {});
  check('divider lines removed', r.text === 'a\nb\nc', JSON.stringify(r.text));
  check('lineMap points back correctly', r.lineMap[2] === 4, JSON.stringify(r.lineMap));
}

// --- structuralClean: Arabic commentary in an English section --------
{
  const src = 'Question one?\n# نستخدم am thinking للحاضر المستمر\nQuestion two?';
  const r = structuralClean(src, { expectEnglish: true });
  check('Arabic-dominant commentary dropped', !r.text.includes('نستخدم'), JSON.stringify(r.text));
  check('English lines kept', r.text.includes('Question one?') && r.text.includes('Question two?'));
}
{
  // Mixed line: keep English, strip Arabic gloss.
  const r = structuralClean('Passage 6 (الماتريوشكا)', { expectEnglish: true });
  check('mixed line keeps English', r.text.includes('Passage 6'));
  check('mixed line drops Arabic', !/[؀-ۿ]/.test(r.text), JSON.stringify(r.text));
}
{
  // Arabic must SURVIVE when the section is not English.
  const r = structuralClean('استمع إلى التسجيل', {});
  check('Arabic kept when not an English section', r.text.includes('استمع'));
}

// --- numbered items with inline options parse ------------------------
{
  const doc = `1. Don't take this book. It's ……
(mine – her – his – he)
# mine is possessive
~~~~~~~~~~
2. My father was born (at - in - on) June 22.
3. Look! Khalid …… about it.
(thinks – is thinking)`;
  const clean = structuralClean(doc, { expectEnglish: true });
  const r = splitBlocks(clean.text, { optionsPerQuestion: 4, minOptions: 2 });
  check('numbered + inline items all parse', r.blocks.length === 3, `${r.blocks.length}`);
  check('each parsed item has 2+ options', r.blocks.every((b) => Object.keys(b.options).length >= 2));
  check('item 1 options correct',
    JSON.stringify(Object.values(r.blocks[0].options)) === JSON.stringify(['mine', 'her', 'his', 'he']));
  check('comment line not folded into a stem',
    r.blocks.every((b) => !b.stem.includes('possessive')));
}

// --- THE REGRESSION GUARD: text corpora unchanged --------------------
async function corpus(file: string, section: 'reading' | 'grammar', expect: number) {
  if (!existsSync(file)) { check(`${file} present`, false, 'missing'); return; }
  const doc = await textFileAdapter.load(readFileSync(file, 'utf8'), file);
  const plan = ingest(doc, { section, assignTemporarySkill: true });
  check(`${file} still extracts ${expect}`, plan.questions.length === expect, `${plan.questions.length}`);
  check(`${file} still has 0 failed`, plan.failed.length === 0, `${plan.failed.length}`);
}
await corpus('reading_bank.txt', 'reading', 150);
await corpus('gramer_bank.txt', 'grammar', 150);

// --- report ----------------------------------------------------------
let failed = 0;
for (const [name, pass, note] of results) {
  if (!pass) failed++;
  console.log(`${pass ? '  ok  ' : ' FAIL '} ${name}${note ? `  (${note})` : ''}`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
if (failed) process.exit(1);
