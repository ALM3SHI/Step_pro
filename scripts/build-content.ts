/**
 * Content build.
 *
 * Merges every source the legacy prototype left behind into ONE
 * validated bundle:
 *   - legacy_bank.json   (1,135 hand-tagged, answer-keyed questions)
 *   - gramer_bank.txt    (150 grammar, no keys)
 *   - reading_bank.txt   (148 reading + 48 passages, no keys)
 *   - listening-seed.ts  (20 verified listening items + 10 clips)
 *
 * Output is `content/bundle.json` — a version-controlled artifact that
 * the Supabase seeder consumes. The point is that questions live in
 * structured data, never in markup, and that the transformation is a
 * script anyone can re-run rather than a one-off manual migration.
 *
 *   npx tsx scripts/build-content.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { runPipeline } from '../src/lib/ingestion/pipeline';
import { hashQuestion, hashText } from '../src/lib/ingestion/dedupe';
import { LISTENING_SEED } from '../src/lib/ingestion/listening-seed';
import { SKILL_BY_ID, DEFAULT_DIFFICULTY, type SectionId } from '../src/lib/content/taxonomy';
import { validateBundle, type AudioClip, type ContentBundle, type OptionKey, type Passage, type Question } from '../src/lib/content/schema';

const KEYS: OptionKey[] = ['A', 'B', 'C', 'D'];

/** Legacy section ids -> canonical section ids. */
const SECTION_MAP: Record<string, SectionId> = {
  gram: 'grammar',
  read: 'reading',
  listen: 'listening',
  write: 'writing',
};

interface LegacyQ {
  id: string; sec: string; skill?: string; q: string; opts: string[];
  ans: number; exp?: string; audio?: string; tts?: string; pid?: string;
}

const questions: Question[] = [];
const passages: Passage[] = [];
const audioClips: AudioClip[] = [];
const skipped: string[] = [];

/**
 * Legacy question text contains a few raw <br> tags.
 *
 * Converted to real newlines rather than kept as markup: ingested
 * content is never rendered as HTML (that would be an injection path),
 * and sentence-ordering items genuinely need the line breaks.
 */
function detag(text: string): string {
  return text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(?:b|i|u|strong|em|span|div|p)[^>]*>/gi, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

function toOptions(opts: string[]): Record<OptionKey, string> | null {
  if (opts.length < 2 || opts.length > 4) return null;
  const out = {} as Record<OptionKey, string>;
  opts.forEach((o, i) => { out[KEYS[i]] = detag(o); });
  return out;
}

// =====================================================================
// 1. Legacy bank — the only source with verified keys AND explanations
// =====================================================================
const legacy: LegacyQ[] = JSON.parse(readFileSync('legacy_bank.json', 'utf8'));

const legacyPassages = new Map<string, string>();
{
  // Passage bodies live in a separate map in the legacy file; pull them
  // out of the raw HTML by id.
  const html = readFileSync('step-prep.html', 'utf8');
  const block = html.match(/const\s+PASSAGES\s*=\s*\{([\s\S]*?)\n\};/);
  if (block) {
    const re = /(\w+)\s*:\s*`([\s\S]*?)`/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(block[1]))) legacyPassages.set(m[1], detag(m[2]));
  }
}

for (const [pid, body] of legacyPassages) {
  passages.push({
    id: `legacy-passage-${pid}`,
    body,
    contentHash: hashText(body),
    sourceRef: 'legacy',
  });
}

// Audio clips from the verified listening seed.
for (const clip of LISTENING_SEED) {
  audioClips.push({
    id: `clip-${clip.audioKey}`,
    audioKey: clip.audioKey,
    storagePath: clip.fileName,
    sourceRef: 'legacy',
  });
}

// Map legacy audio path -> clip id, for attaching legacy listening items.
const clipByFile = new Map(audioClips.map((c) => [c.storagePath, c.id]));

for (const q of legacy) {
  const section = SECTION_MAP[q.sec];
  if (!section) { skipped.push(`${q.id}: unknown section "${q.sec}"`); continue; }

  const options = toOptions(q.opts);
  if (!options) { skipped.push(`${q.id}: ${q.opts.length} options`); continue; }

  const correctOption = KEYS[q.ans];
  if (!correctOption || !options[correctOption]) {
    skipped.push(`${q.id}: answer index ${q.ans} out of range`);
    continue;
  }

  // Keep the legacy skill id verbatim when it is known; otherwise fall
  // back to the section's most general skill rather than inventing one.
  const skillId = q.skill && SKILL_BY_ID[q.skill] ? q.skill : null;
  if (!skillId) { skipped.push(`${q.id}: unknown skill "${q.skill}"`); continue; }

  const text = detag(q.q);
  const audioFile = q.audio?.replace(/^listening\//, '');
  const audioClipId = audioFile ? clipByFile.get(audioFile) : undefined;

  // A listening item whose audio is missing is unanswerable. The
  // TTS-only items fall here: browser speech synthesis is not
  // exam-faithful, so they are excluded rather than shipped as filler.
  if (section === 'listening' && !audioClipId) {
    skipped.push(`${q.id}: listening item with no audio file (tts-only)`);
    continue;
  }

  questions.push({
    id: `legacy-${q.id}`,
    section,
    skillId,
    difficulty: DEFAULT_DIFFICULTY,
    text,
    options,
    correctOption,
    explanationAr: q.exp ? detag(q.exp) : undefined,
    passageId: q.pid && legacyPassages.has(q.pid) ? `legacy-passage-${q.pid}` : undefined,
    audioClipId,
    tags: ['legacy'],
    contentHash: hashQuestion(text, options),
    status: 'published',
    sourceRef: 'legacy',
  });
}

// =====================================================================
// 2. Raw text banks — questions WITHOUT keys
// =====================================================================
function importRawBank(file: string, section: SectionId, defaultSkill: string) {
  const result = runPipeline(readFileSync(file, 'utf8'));

  const passageIdByIndex = new Map<number, string>();
  result.passages.forEach((p, i) => {
    const id = `bank-${section}-passage-${i}`;
    passageIdByIndex.set(i, id);
    passages.push({
      id,
      titleEn: p.title,
      body: p.body,
      contentHash: p.contentHash,
      sourceRef: file,
    });
  });

  // Hashes already covered by the keyed legacy bank. The raw banks
  // overlap it, and a bank copy is strictly worse: no answer key and no
  // explanation. Importing both would put two versions of one question
  // in front of the admin with no way to tell which to edit.
  const alreadyKeyed = new Set(questions.map((q) => q.contentHash));

  let imported = 0;
  let overlapping = 0;
  for (const q of result.questions) {
    const options = toOptions(Object.values(q.options).filter((v): v is string => Boolean(v?.trim())));
    if (!options) continue;

    if (alreadyKeyed.has(q.contentHash)) { overlapping++; continue; }

    questions.push({
      id: `bank-${section}-${imported}`,
      section,
      skillId: defaultSkill,
      difficulty: DEFAULT_DIFFICULTY,
      text: q.questionText,
      options,
      // No answer key in these sources. Status stays `draft`, so the
      // exam builder never serves them and the admin queue surfaces
      // them for keying via the Fast-Key workflow.
      correctOption: 'A',
      passageId: q.passageRef !== undefined ? passageIdByIndex.get(q.passageRef) : undefined,
      tags: ['bank', 'needs-key'],
      contentHash: q.contentHash,
      status: 'draft',
      sourceRef: file,
    });
    imported++;
  }
  return { imported, overlapping };
}

const grammarImport = importRawBank('gramer_bank.txt', 'grammar', 'tenses');
const readingImport = importRawBank('reading_bank.txt', 'reading', 'detail');

// =====================================================================
// 3. Verified listening seed
// =====================================================================
let listeningImported = 0;

/**
 * Dedupe listening by (clip, ordinal), NOT by hash.
 *
 * The seed was transcribed by hand and its wording drifted slightly from
 * the legacy original ("blue- ringed … has been taken known" became
 * "blue-ringed … has been known"). Hash matching therefore missed it and
 * produced a third question on a two-question clip. The clip and its
 * position identify the item regardless of transcription differences,
 * and the legacy copy wins because it carries the Arabic explanation.
 */
const legacyByClipOrdinal = new Set<string>();
{
  const seenPerClip = new Map<string, number>();
  for (const q of questions) {
    if (q.section !== 'listening' || !q.audioClipId) continue;
    const n = (seenPerClip.get(q.audioClipId) ?? 0) + 1;
    seenPerClip.set(q.audioClipId, n);
    legacyByClipOrdinal.add(`${q.audioClipId}#${n}`);
  }
}

for (const clip of LISTENING_SEED) {
  for (const q of clip.questions) {
    const contentHash = hashQuestion(q.questionText, q.options);
    if (legacyByClipOrdinal.has(`clip-${clip.audioKey}#${q.ordinal}`)) continue;
    if (questions.some((existing) => existing.contentHash === contentHash)) continue;

    questions.push({
      id: `listening-${clip.audioKey}-${q.ordinal}`,
      section: 'listening',
      skillId: 'ldetail',
      difficulty: DEFAULT_DIFFICULTY,
      text: q.questionText,
      options: q.options,
      correctOption: q.correctOption,
      audioClipId: `clip-${clip.audioKey}`,
      ordinal: q.ordinal,
      tags: ['verified-key'],
      contentHash,
      status: 'published',
      sourceRef: 'listening-seed',
    });
    listeningImported++;
  }
}

// =====================================================================
// 4. Assemble, validate, write
// =====================================================================
const bySection: Record<string, number> = {};
const bySkill: Record<string, number> = {};
for (const q of questions) {
  bySection[q.section] = (bySection[q.section] ?? 0) + 1;
  bySkill[q.skillId] = (bySkill[q.skillId] ?? 0) + 1;
}

const bundle: ContentBundle = {
  version: 1,
  // Stamped from the newest source file rather than Date.now(), so
  // rebuilding unchanged inputs produces a byte-identical bundle and the
  // git diff stays meaningful.
  generatedAt: new Date(
    Math.max(
      ...['legacy_bank.json', 'gramer_bank.txt', 'reading_bank.txt'].map(
        (f) => statSafe(f),
      ),
    ),
  ).toISOString(),
  questions,
  passages,
  audioClips,
  counts: { total: questions.length, bySection, bySkill },
};

function statSafe(file: string): number {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('node:fs').statSync(file).mtimeMs as number;
  } catch {
    return 0;
  }
}

let { errors, warnings } = validateBundle(bundle, new Set(Object.keys(SKILL_BY_ID)));

/**
 * Quarantine structurally broken questions inherited from the prototype.
 *
 * Two legacy items ship with duplicate option text — cq578 has "at"
 * twice, dq109 has two identical options in a CAPITALIZATION question,
 * giving it two correct answers. These are defects in the source data,
 * not in the import. They are moved to `review` so an admin fixes them,
 * rather than being dropped (losing content) or published (serving a
 * broken question in an exam).
 */
const quarantined: string[] = [];
{
  const broken = new Set(errors.map((e) => e.questionId));
  for (const q of bundle.questions) {
    if (!broken.has(q.id)) continue;
    q.status = 'review';
    q.tags = [...new Set([...q.tags, 'needs-fix'])];
    quarantined.push(q.id);
  }
  // Re-validate so the summary reflects the quarantined state.
  const revalidated = validateBundle(bundle, new Set(Object.keys(SKILL_BY_ID)));
  warnings = revalidated.warnings;
  errors = revalidated.errors.filter((e) => !broken.has(e.questionId));
}

console.log('=== sources ===');
console.log(`legacy bank      : ${legacy.length} -> ${questions.filter((q) => q.sourceRef === 'legacy').length} imported`);
console.log(`gramer_bank.txt  : ${grammarImport.imported} new (draft, needs keys) · ${grammarImport.overlapping} already keyed in legacy`);
console.log(`reading_bank.txt : ${readingImport.imported} new (draft, needs keys) · ${readingImport.overlapping} already keyed in legacy`);
console.log(`listening seed   : ${listeningImported} new (rest already in legacy)`);
console.log(`skipped          : ${skipped.length}`);
for (const s of skipped.slice(0, 8)) console.log(`   - ${s}`);
if (skipped.length > 8) console.log(`   … and ${skipped.length - 8} more`);

console.log('\n=== bundle ===');
console.log(`questions : ${bundle.counts.total}`);
console.log(`  published: ${questions.filter((q) => q.status === 'published').length}`);
console.log(`  draft    : ${questions.filter((q) => q.status === 'draft').length}`);
console.log(`by section: ${JSON.stringify(bySection)}`);
console.log(`passages  : ${passages.length}`);
console.log(`audioClips: ${audioClips.length}`);
console.log(`skills use: ${Object.keys(bySkill).length} of ${Object.keys(SKILL_BY_ID).length}`);

if (quarantined.length) {
  console.log(`\nquarantined (source defects, moved to 'review'): ${quarantined.join(', ')}`);
}

console.log(`\nvalidation: ${errors.length} error(s), ${warnings.length} warning(s)`);
for (const e of errors.slice(0, 10)) console.log(`  ERROR ${e.questionId}: ${e.message}`);
const warnKinds: Record<string, number> = {};
for (const w of warnings) {
  const kind = w.message.replace(/"[^"]*"/g, '"…"').replace(/\d+/g, 'N');
  warnKinds[kind] = (warnKinds[kind] ?? 0) + 1;
}
for (const [kind, n] of Object.entries(warnKinds)) console.log(`  WARN  x${n}: ${kind}`);

mkdirSync('content', { recursive: true });
writeFileSync('content/bundle.json', JSON.stringify(bundle, null, 2), 'utf8');
console.log('\nwrote content/bundle.json');

process.exit(errors.length ? 1 : 0);
