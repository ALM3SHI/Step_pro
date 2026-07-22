/**
 * Question-bank filter composition.
 *
 * The property that matters is that filters AND together: adding one can
 * only ever shrink the result set, and every combination agrees with a
 * hand-written predicate. The risk is not one broken filter — it is two
 * correct filters that stop composing.
 *
 * The predicate under test mirrors BatchEditor's `filtered` memo. It is
 * duplicated rather than imported because that memo lives inside a React
 * component; the shapes are asserted against the real EditableQuestion
 * type so a field rename still breaks the build.
 */
import type { EditableQuestion } from '../src/lib/content/repository';

const results: Array<[string, boolean, string?]> = [];
const check = (n: string, p: boolean, note?: string) => results.push([n, p, note]);

type Filter = 'all' | 'draft' | 'review' | 'published' | 'no-skill';
type FlagKey = 'no-key' | 'no-explanation' | 'no-stimulus' | 'has-passage' | 'has-audio';

const FLAG_TESTS: Record<FlagKey, (q: EditableQuestion) => boolean> = {
  'no-key': (q) => !q.correctOption,
  'no-explanation': (q) => !q.explanationAr?.trim(),
  'no-stimulus': (q) =>
    (q.section === 'reading' && !q.passageId && !q.imageUrl) ||
    (q.section === 'listening' && !q.audioClipId),
  'has-passage': (q) => Boolean(q.passageId),
  'has-audio': (q) => Boolean(q.audioClipId),
};

interface Criteria {
  filter?: Filter;
  search?: string;
  section?: string;
  skillId?: string;
  difficulty?: string;
  flags?: FlagKey[];
}

function apply(questions: EditableQuestion[], c: Criteria): EditableQuestion[] {
  const needle = (c.search ?? '').trim().toLowerCase();
  const filter = c.filter ?? 'all';

  return questions.filter((q) => {
    if (filter === 'no-skill') { if (q.skillId) return false; }
    else if (filter !== 'all' && q.status !== filter) return false;

    if (c.section && q.section !== c.section) return false;
    if (c.skillId && q.skillId !== c.skillId) return false;
    if (c.difficulty && q.difficulty !== c.difficulty) return false;

    for (const key of c.flags ?? []) if (!FLAG_TESTS[key](q)) return false;

    if (needle) {
      const hit =
        q.text.toLowerCase().includes(needle) ||
        Object.values(q.options).some((o) => o?.toLowerCase().includes(needle)) ||
        (q.explanationAr ?? '').toLowerCase().includes(needle);
      if (!hit) return false;
    }
    return true;
  });
}

// --- fixtures ----------------------------------------------------------
let n = 0;
function q(over: Partial<EditableQuestion>): EditableQuestion {
  n++;
  return {
    id: `q${n}`,
    batchId: 'b1',
    section: 'grammar',
    skillId: 'tenses',
    difficulty: 'medium',
    status: 'published',
    text: `Question number ${n}`,
    options: { A: 'alpha', B: 'bravo', C: 'charlie', D: 'delta' },
    correctOption: 'A',
    explanationAr: 'شرح',
    tags: [],
    passageId: null,
    audioClipId: null,
    imageUrl: null,
    imageAlt: null,
    ordinal: n,
    ...over,
  } as EditableQuestion;
}

const bank: EditableQuestion[] = [
  q({ section: 'grammar', skillId: 'tenses', difficulty: 'easy', status: 'published' }),
  q({ section: 'grammar', skillId: 'preps', difficulty: 'hard', status: 'draft' }),
  q({ section: 'grammar', skillId: 'tenses', difficulty: 'medium', status: 'draft', correctOption: null }),
  q({ section: 'reading', skillId: 'main', difficulty: 'easy', status: 'published', passageId: 'p1' }),
  q({ section: 'reading', skillId: 'detail', difficulty: 'medium', status: 'published', passageId: 'p1', explanationAr: '' }),
  q({ section: 'reading', skillId: 'infer', difficulty: 'hard', status: 'draft' }), // no passage -> no-stimulus
  q({ section: 'listening', skillId: 'lmain', difficulty: 'medium', status: 'published', audioClipId: 'a1' }),
  q({ section: 'listening', skillId: 'ldetail', difficulty: 'easy', status: 'review' }), // no audio -> no-stimulus
  q({ section: 'writing', skillId: 'error', difficulty: 'hard', status: 'published', skillIdMissing: true } as never),
  q({ section: 'writing', skillId: '', difficulty: 'medium', status: 'draft' }), // no skill
];

const ids = (rows: EditableQuestion[]) => rows.map((r) => r.id).join(',');

// --- single dimensions -------------------------------------------------
check('no filters returns everything', apply(bank, {}).length === bank.length, `${bank.length}`);
check('section=grammar', apply(bank, { section: 'grammar' }).length === 3);
check('section=reading', apply(bank, { section: 'reading' }).length === 3);
check('section=listening', apply(bank, { section: 'listening' }).length === 2);
check('skill=tenses', apply(bank, { skillId: 'tenses' }).length === 2);
check('difficulty=hard', apply(bank, { difficulty: 'hard' }).length === 3);
check('status=draft', apply(bank, { filter: 'draft' }).length === 4);
check('status=published', apply(bank, { filter: 'published' }).length === 5);
check('no-skill tab', apply(bank, { filter: 'no-skill' }).length === 1);

// --- flags -------------------------------------------------------------
check('flag no-key', apply(bank, { flags: ['no-key'] }).length === 1);
check('flag no-explanation', apply(bank, { flags: ['no-explanation'] }).length === 1);
check('flag has-passage', apply(bank, { flags: ['has-passage'] }).length === 2);
check('flag has-audio', apply(bank, { flags: ['has-audio'] }).length === 1);
check('flag no-stimulus catches reading without passage and listening without audio',
  apply(bank, { flags: ['no-stimulus'] }).length === 2,
  ids(apply(bank, { flags: ['no-stimulus'] })));

// --- composition: the real property ------------------------------------
check('section + difficulty compose',
  apply(bank, { section: 'grammar', difficulty: 'hard' }).length === 1);
check('section + skill compose',
  apply(bank, { section: 'grammar', skillId: 'tenses' }).length === 2);
check('section + status compose',
  apply(bank, { section: 'reading', filter: 'published' }).length === 2);
check('section + skill + difficulty + status compose',
  apply(bank, { section: 'grammar', skillId: 'tenses', difficulty: 'easy', filter: 'published' }).length === 1);
check('flags compose with taxonomy',
  apply(bank, { section: 'reading', flags: ['has-passage'] }).length === 2);
check('two flags compose (AND, not OR)',
  apply(bank, { flags: ['has-passage', 'no-explanation'] }).length === 1);
check('contradictory flags yield nothing',
  apply(bank, { flags: ['has-passage', 'has-audio'] }).length === 0);

// --- search still works alongside filters ------------------------------
check('search alone matches text', apply(bank, { search: 'Question number 1' }).length >= 1);
check('search matches an option value', apply(bank, { search: 'bravo' }).length === bank.length);
check('search matches the explanation', apply(bank, { search: 'شرح' }).length === 9);
check('search is case-insensitive', apply(bank, { search: 'QUESTION' }).length === bank.length);
check('search composes with section',
  apply(bank, { search: 'bravo', section: 'reading' }).length === 3);
check('search composes with every other dimension',
  apply(bank, { search: 'bravo', section: 'grammar', skillId: 'tenses', difficulty: 'easy', filter: 'published' }).length === 1);
check('non-matching search wins over permissive filters',
  apply(bank, { search: 'zzzznotpresent', section: 'grammar' }).length === 0);

// --- monotonicity: adding a filter can never grow the result -----------
const dimensions: Criteria[] = [
  { section: 'grammar' }, { skillId: 'tenses' }, { difficulty: 'hard' },
  { filter: 'draft' }, { flags: ['has-passage'] }, { search: 'bravo' },
];
let monotonic = true;
for (const a of dimensions) {
  const alone = apply(bank, a).length;
  for (const b of dimensions) {
    const combined = apply(bank, { ...a, ...b }).length;
    if (combined > alone) { monotonic = false; break; }
  }
}
check('adding any filter never grows the result set', monotonic);

// --- order is preserved ------------------------------------------------
const filteredOrder = apply(bank, { section: 'grammar' }).map((r) => r.id);
const bankOrder = bank.filter((r) => r.section === 'grammar').map((r) => r.id);
check('filtering preserves batch order', filteredOrder.join() === bankOrder.join(), filteredOrder.join());

// --- report ------------------------------------------------------------
let failed = 0;
for (const [name, pass, note] of results) {
  if (!pass) failed++;
  console.log(`${pass ? '  ok  ' : ' FAIL '} ${name}${note ? `  (${note})` : ''}`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
if (failed) process.exit(1);
