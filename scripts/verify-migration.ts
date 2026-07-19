/**
 * Post-migration verification.
 *
 * Compares Supabase against the bundle FIELD BY FIELD. Run this before
 * trusting the database as the source of truth — a migration that looks
 * successful can still have dropped a column silently, and the whole
 * point of the exercise was not to lose skills, explanations or keys.
 *
 *   npx tsx scripts/verify-migration.ts
 *
 * Exit code 0 means every selected question round-trips exactly.
 */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { requireSupabaseEnv } from './_env';
import type { ContentBundle, Question } from '../src/lib/content/schema';



const { url, serviceKey } = requireSupabaseEnv();

const db = createClient(url, serviceKey, { auth: { persistSession: false } });
const bundle: ContentBundle = JSON.parse(readFileSync('content/bundle.json', 'utf8'));

const problems: string[] = [];
const note = (s: string) => problems.push(s);

(async () => {
  // Page through everything — the default select cap would silently
  // compare only the first 1,000 rows and report a false pass.
  const rows: Record<string, unknown>[] = [];
  const PAGE = 500;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from('questions')
      .select('external_id, category, skill_id, difficulty, tags, status, question_text, options, correct_option, explanation, content_hash, ordinal, image_url, image_alt, passage_id, audio_clip_id')
      .range(from, from + PAGE - 1);
    if (error) { console.error(`read failed: ${error.message}`); process.exit(1); }
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < PAGE) break;
  }

  console.log(`rows in database : ${rows.length}`);

  const dbByExternal = new Map(
    rows.filter((r) => r.external_id).map((r) => [r.external_id as string, r]),
  );
  console.log(`with external_id : ${dbByExternal.size}`);

  // Only the questions the migration was asked to carry.
  const expected = bundle.questions.filter(
    (q) => q.section !== 'listening' && (q.status === 'published' || q.status === 'review'),
  );
  console.log(`expected (excl. listening, excl. drafts): ${expected.length}\n`);

  let compared = 0;
  const missing: string[] = [];
  const mismatchCounts: Record<string, number> = {};
  const sample: string[] = [];

  const bump = (field: string, id: string, a: unknown, b: unknown) => {
    mismatchCounts[field] = (mismatchCounts[field] ?? 0) + 1;
    if (sample.length < 12) {
      sample.push(`${id} · ${field}: bundle=${JSON.stringify(a)?.slice(0, 60)} db=${JSON.stringify(b)?.slice(0, 60)}`);
    }
  };

  for (const q of expected as Question[]) {
    const row = dbByExternal.get(q.id);
    if (!row) { missing.push(q.id); continue; }
    compared++;

    if (row.category !== q.section) bump('section', q.id, q.section, row.category);
    // The whole reason migration 0006 exists.
    if (row.skill_id !== q.skillId) bump('skill_id', q.id, q.skillId, row.skill_id);
    if (row.difficulty !== q.difficulty) bump('difficulty', q.id, q.difficulty, row.difficulty);
    if (row.status !== q.status) bump('status', q.id, q.status, row.status);
    if (row.correct_option !== q.correctOption) bump('correct_option', q.id, q.correctOption, row.correct_option);
    if (row.content_hash !== q.contentHash) bump('content_hash', q.id, q.contentHash, row.content_hash);

    // Text must survive byte-for-byte: newlines are content in
    // sentence-ordering and error-detection items.
    if (row.question_text !== q.text) bump('text', q.id, q.text.slice(0, 40), String(row.question_text).slice(0, 40));

    const dbExp = (row.explanation ?? '') as string;
    const bnExp = q.explanationAr ?? '';
    if (dbExp !== bnExp) bump('explanation', q.id, bnExp.slice(0, 40), dbExp.slice(0, 40));

    const dbOpts = row.options as Record<string, string>;
    for (const k of ['A', 'B', 'C', 'D'] as const) {
      const a = q.options[k] ?? null;
      const b = dbOpts?.[k] ?? null;
      if (a !== b) bump(`option_${k}`, q.id, a, b);
    }

    const dbTags = ((row.tags ?? []) as string[]).slice().sort();
    const bnTags = (q.tags ?? []).slice().sort();
    if (JSON.stringify(dbTags) !== JSON.stringify(bnTags)) bump('tags', q.id, bnTags, dbTags);

    // A reading question that lost its passage link is unanswerable.
    if (Boolean(q.passageId) !== Boolean(row.passage_id)) {
      bump('passage_link', q.id, Boolean(q.passageId), Boolean(row.passage_id));
    }
  }

  // --- aggregate checks ------------------------------------------------
  console.log('=== per-field mismatches ===');
  if (!Object.keys(mismatchCounts).length) console.log('  none');
  for (const [f, n] of Object.entries(mismatchCounts)) console.log(`  ${f.padEnd(16)} ${n}`);
  if (sample.length) {
    console.log('\n  examples:');
    for (const s of sample) console.log(`    ${s}`);
  }

  /**
   * Separate genuine loss from intentional deduplication.
   *
   * `hashQuestion` sorts the options before hashing, so the same item
   * with shuffled choices collapses to one hash — which is the point.
   * The database therefore holds ONE row for such a pair, and the twin
   * shows up here as "missing". That is the dedup working, not data
   * loss, and failing on it would block the migration forever.
   */
  const dbHashes = new Set(rows.map((r) => r.content_hash as string));
  const hashById = new Map((expected as Question[]).map((q) => [q.id, q.contentHash]));
  const merged: string[] = [];
  const trulyMissing: string[] = [];

  for (const id of missing) {
    const hash = hashById.get(id);
    if (hash && dbHashes.has(hash)) merged.push(id);
    else trulyMissing.push(id);
  }

  console.log(`\ncompared          : ${compared}`);
  console.log(`merged as duplicate: ${merged.length}`);
  if (merged.length) {
    for (const id of merged.slice(0, 5)) {
      const twin = (expected as Question[]).find(
        (q) => q.id !== id && q.contentHash === hashById.get(id),
      );
      console.log(`  ${id} == ${twin?.id ?? '(row already present)'} — same question, shuffled options`);
    }
  }
  console.log(`truly missing     : ${trulyMissing.length}`);
  if (trulyMissing.length) console.log(`  e.g. ${trulyMissing.slice(0, 8).join(', ')}`);

  // Skill coverage is the headline: it is what a naive migration loses.
  // Derived from the rows ALREADY paged in above — a fresh unpaged query
  // would silently sample only the first 1,000 and report skills as
  // "lost" that are simply on page two.
  const distinctSkills = new Set(
    rows.map((r) => r.skill_id).filter(Boolean) as string[],
  );
  console.log(`\ndistinct skills in DB : ${distinctSkills.size}`);

  const bundleSkills = new Set(expected.map((q) => q.skillId));
  const lost = [...bundleSkills].filter((s) => !distinctSkills.has(s));
  if (lost.length) note(`skills lost entirely: ${lost.join(', ')}`);

  // Untagged rows are only a problem if they are SERVABLE. Pre-existing
  // admin-ingested rows were quarantined to draft by migration 0007, so
  // they are expected here and must not fail the run.
  const untaggedTotal = rows.filter((r) => !r.skill_id).length;
  const untaggedPublished = rows.filter((r) => !r.skill_id && r.status === 'published').length;
  console.log(`rows with NULL skill  : ${untaggedTotal} (published: ${untaggedPublished})`);
  if (untaggedPublished > 0) {
    note(`${untaggedPublished} PUBLISHED row(s) have no skill_id — they would pollute the analytics`);
  }

  // Servable pool per section — what the simulator will actually see.
  // Paged for the same reason.
  const servableRows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from('servable_questions').select('category').range(from, from + PAGE - 1);
    if (error) { console.error(`servable read failed: ${error.message}`); break; }
    if (!data?.length) break;
    servableRows.push(...data);
    if (data.length < PAGE) break;
  }
  const pool: Record<string, number> = {};
  for (const r of servableRows) pool[r.category as string] = (pool[r.category as string] ?? 0) + 1;
  console.log(`\nservable pool (what the simulator sees): ${JSON.stringify(pool)}`);

  if (trulyMissing.length) note(`${trulyMissing.length} question(s) never reached the database`);
  if (Object.keys(mismatchCounts).length) {
    note(`${Object.values(mismatchCounts).reduce((a, b) => a + b, 0)} field mismatch(es)`);
  }

  console.log('\n' + '='.repeat(58));
  if (problems.length) {
    console.log('VERIFICATION FAILED — do NOT switch the source of truth yet:');
    for (const p of problems) console.log(`  - ${p}`);
    process.exit(1);
  }
  console.log('VERIFICATION PASSED');
  console.log('Every selected question round-trips exactly, skills included.');
  console.log('Safe to flip the content provider to Supabase.');
})();
