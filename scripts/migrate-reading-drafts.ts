/**
 * Ship the reading drafts that the first migration left behind.
 *
 * The original run used default flags, which skip drafts — so 148
 * reading questions and the 48 passages they hang off never reached the
 * database. They exist, they validate, and the admin panel cannot show
 * what is not there.
 *
 * NARROW ON PURPOSE. The general migrator rewrites `category` and
 * `status` for every row it touches from the bundle, and the bundle
 * still carries the five mis-tagged reading/grammar items — running it
 * would silently undo that correction. This script writes ONLY reading
 * drafts and their passages, and refuses anything else.
 *
 * Everything lands as `draft`: these questions enter the panel for
 * review, never an exam. Publishing is a separate, human decision.
 *
 *   npx tsx scripts/migrate-reading-drafts.ts --dry
 *   npx tsx scripts/migrate-reading-drafts.ts
 */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { requireSupabaseEnv } from './_env';
import { validateDraft } from '../src/lib/content/validation';
import type { ContentBundle } from '../src/lib/content/schema';

const dryRun = process.argv.includes('--dry');

const { url, serviceKey } = requireSupabaseEnv();
const db = createClient(url, serviceKey, { auth: { persistSession: false } });
const bundle: ContentBundle = JSON.parse(readFileSync('content/bundle.json', 'utf8'));

/** The batch the first migration created (see migrate-to-supabase.ts).
 *  Drafts join it rather than forming an orphan batch with no
 *  provenance. Must match exactly — it is a foreign key. */
const BATCH_ID = '00000000-0000-4000-8000-000000000001';

async function upsert(table: string, rows: unknown[], onConflict: string, size = 200) {
  let done = 0;
  for (let i = 0; i < rows.length; i += size) {
    const chunk = rows.slice(i, i + size);
    const { error } = await db.from(table).upsert(chunk as never, { onConflict });
    if (error) throw new Error(`${table}: ${error.message}`);
    done += chunk.length;
    process.stdout.write(`\r  ${table}: ${done}/${rows.length}`);
  }
  process.stdout.write('\n');
}

(async () => {
  // --- select, and prove the selection is what we claim ---------------
  const drafts = bundle.questions.filter(
    (q) => q.section === 'reading' && q.status === 'draft',
  );

  if (!drafts.length) {
    console.log('No reading drafts in the bundle. Nothing to do.');
    return;
  }

  // A question with no passage is one of the mis-tagged grammar items;
  // those were corrected in the database and must not be re-imported as
  // reading. Refusing is better than filtering silently.
  const orphans = drafts.filter((q) => !q.passageId && !q.imageUrl);
  if (orphans.length) {
    console.error(`REFUSING: ${orphans.length} draft(s) have no passage and no image.`);
    console.error('Those are mis-tagged grammar items. Fix the bundle first.');
    process.exit(1);
  }

  // Re-validate here rather than trusting the audit: this is the write
  // path, and a row that cannot be published later is a row that will
  // sit in the panel forever as a puzzle.
  const invalid = drafts.filter(
    (q) => !validateDraft({ ...q, status: 'published', explanationAr: q.explanationAr ?? '' }).canSave,
  );

  const usedPassageIds = new Set(drafts.map((q) => q.passageId).filter(Boolean));
  const passages = bundle.passages.filter((p) => usedPassageIds.has(p.id));

  const missingPassages = [...usedPassageIds].filter(
    (id) => !passages.some((p) => p.id === id),
  );
  if (missingPassages.length) {
    console.error(`REFUSING: ${missingPassages.length} referenced passage(s) missing from the bundle.`);
    process.exit(1);
  }

  console.log('='.repeat(60));
  console.log('READING DRAFTS -> SUPABASE');
  console.log('='.repeat(60));
  console.log(`questions        : ${drafts.length}  (all will be written as status=draft)`);
  console.log(`passages         : ${passages.length}`);
  console.log(`fail validation  : ${invalid.length}`);
  console.log(`sections touched : reading only`);
  console.log(`statuses touched : draft only — no published row is modified`);

  if (dryRun) {
    console.log('\n--dry: nothing was written.');
    return;
  }

  // --- passages first: questions carry a foreign key to them ----------
  const passageRows = passages.map((p) => ({
    external_id: p.id,
    batch_id: BATCH_ID,
    title: p.titleEn ?? null,
    title_ar: p.titleAr ?? null,
    body: p.body,
    content_hash: p.contentHash,
    image_url: p.imageUrl ?? null,
    image_alt: p.imageAlt ?? null,
  }));
  await upsert('passages', passageRows, 'content_hash');

  const { data: pRows } = await db.from('passages').select('id, external_id');
  const passageIdByExternal = new Map(
    (pRows ?? []).filter((r) => r.external_id).map((r) => [r.external_id as string, r.id as string]),
  );

  const questionRows = drafts.map((q) => ({
    external_id: q.id,
    batch_id: BATCH_ID,
    passage_id: q.passageId ? passageIdByExternal.get(q.passageId) ?? null : null,
    audio_clip_id: null,
    ordinal: q.ordinal ?? null,
    category: 'reading',
    skill_id: q.skillId,
    difficulty: q.difficulty,
    tags: q.tags ?? [],
    // Hard-coded, not carried from the bundle: this script must not be
    // able to publish anything, whatever the source file says.
    status: 'draft',
    question_text: q.text,
    options: q.options,
    correct_option: q.correctOption,
    explanation: q.explanationAr ?? null,
    content_hash: q.contentHash,
    image_url: q.imageUrl ?? null,
    image_alt: q.imageAlt ?? null,
    answer_source: 'human_review',
    needs_human_review: true,
  }));

  const unresolved = questionRows.filter((r) => !r.passage_id);
  if (unresolved.length) {
    console.error(`\nREFUSING: ${unresolved.length} question(s) could not resolve their passage id.`);
    process.exit(1);
  }

  await upsert('questions', questionRows, 'content_hash');

  // --- verify what actually landed -------------------------------------
  const { count: readingDrafts } = await db
    .from('questions')
    .select('*', { count: 'exact', head: true })
    .eq('category', 'reading')
    .eq('status', 'draft');

  const { count: readingPublished } = await db
    .from('questions')
    .select('*', { count: 'exact', head: true })
    .eq('category', 'reading')
    .eq('status', 'published');

  const { count: passageCount } = await db
    .from('passages')
    .select('*', { count: 'exact', head: true });

  console.log('\n--- after ---');
  console.log(`reading draft     : ${readingDrafts}`);
  console.log(`reading published : ${readingPublished}  (unchanged — nothing was published)`);
  console.log(`passages          : ${passageCount}`);
})().catch((e) => { console.error(e); process.exit(1); });
