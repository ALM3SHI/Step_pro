/**
 * One-time content migration: bundle -> Supabase.
 *
 * After this runs and verifies, Supabase is the source of truth. The
 * bundle and the legacy files become backups only.
 *
 * Carries EVERY field. The earlier seed script silently dropped
 * skill_id, difficulty, tags and status — which would have destroyed the
 * 27-skill taxonomy on 1,409 questions. Requires migration 0006.
 *
 *   npx tsx scripts/migrate-to-supabase.ts --dry     # report, write nothing
 *   npx tsx scripts/migrate-to-supabase.ts           # published + review
 *   npx tsx scripts/migrate-to-supabase.ts --drafts  # include unkeyed drafts
 *
 * Idempotent: everything upserts on a stable external_id, so re-running
 * updates in place and never duplicates.
 */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { requireSupabaseEnv } from './_env';
import type { ContentBundle, Question } from '../src/lib/content/schema';

const dryRun = process.argv.includes('--dry');
const includeDrafts = process.argv.includes('--drafts');



const { url, serviceKey } = requireSupabaseEnv();

const db = createClient(url, serviceKey, { auth: { persistSession: false } });
const bundle: ContentBundle = JSON.parse(readFileSync('content/bundle.json', 'utf8'));

/**
 * Listening is excluded by default.
 *
 * The platform owner is authoring that section themselves — recordings,
 * questions and keys. Importing the 20 legacy items would create rows
 * they then have to reconcile against their own.
 */
const SKIP_LISTENING = !process.argv.includes('--with-listening');

const wanted = bundle.questions.filter((q) => {
  if (SKIP_LISTENING && q.section === 'listening') return false;
  if (q.status === 'published' || q.status === 'review') return true;
  return includeDrafts && q.status === 'draft';
});

// --- pre-flight -------------------------------------------------------
const byStatus: Record<string, number> = {};
const bySection: Record<string, number> = {};
const bySkill = new Set<string>();
let missingSkill = 0;
let missingExplanation = 0;

for (const q of wanted) {
  byStatus[q.status] = (byStatus[q.status] ?? 0) + 1;
  bySection[q.section] = (bySection[q.section] ?? 0) + 1;
  if (q.skillId) bySkill.add(q.skillId); else missingSkill++;
  if (!q.explanationAr?.trim()) missingExplanation++;
}

console.log(`bundle v${bundle.version}`);
console.log(`selected          : ${wanted.length} of ${bundle.questions.length}`);
console.log(`  by section      : ${JSON.stringify(bySection)}`);
console.log(`  by status       : ${JSON.stringify(byStatus)}`);
console.log(`  distinct skills : ${bySkill.size}`);
console.log(`  without skill   : ${missingSkill}`);
console.log(`  without explan. : ${missingExplanation}`);
console.log(`listening         : ${SKIP_LISTENING ? 'SKIPPED (owner-authored)' : 'included'}`);

if (missingSkill > 0) {
  console.error(`\nABORT: ${missingSkill} question(s) have no skillId.`);
  console.error('Every question must be tagged, or the analytics silently lose them.');
  process.exit(1);
}

if (dryRun) { console.log('\n--dry: nothing written.'); process.exit(0); }

/** Chunked upsert — a single 1,400-row request exceeds the payload cap. */
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
  try {
    // The skills table must exist and be populated by migration 0006.
    const { data: skillRows, error: skillErr } = await db.from('skills').select('id');
    if (skillErr) {
      throw new Error(
        `skills table unavailable (${skillErr.message}). Run migration 0006 first.`,
      );
    }
    const knownSkills = new Set((skillRows ?? []).map((r) => r.id as string));
    const unknown = [...bySkill].filter((s) => !knownSkills.has(s));
    if (unknown.length) {
      throw new Error(`skills missing from the database: ${unknown.join(', ')}. Run migration 0006.`);
    }
    console.log(`\nskills in database: ${knownSkills.size}`);

    // One stable batch row for the whole migration, so re-running never
    // creates a second.
    const BATCH_ID = '00000000-0000-4000-8000-000000000001';
    const { error: batchErr } = await db.from('ingestion_batches').upsert(
      {
        id: BATCH_ID,
        batch_title: 'الترحيل الأول — المحتوى المُستخرج من النسخة القديمة',
        source_metadata: { origin: 'content/bundle.json', version: bundle.version, migratedAt: new Date().toISOString() },
        status: 'completed',
        total_questions_parsed: bundle.questions.length,
        total_questions_saved: wanted.length,
      },
      { onConflict: 'id' },
    );
    if (batchErr) throw new Error(`ingestion_batches: ${batchErr.message}`);

    // --- passages (only those a selected question uses) ---
    const usedPassages = new Set(wanted.map((q) => q.passageId).filter(Boolean));
    const passageRows = bundle.passages
      .filter((p) => usedPassages.has(p.id))
      .map((p) => ({
        external_id: p.id,
        batch_id: BATCH_ID,
        title: p.titleEn ?? null,
        title_ar: p.titleAr ?? null,
        body: p.body,
        content_hash: p.contentHash,
        image_url: p.imageUrl ?? null,
        image_alt: p.imageAlt ?? null,
      }));
    await upsert('passages', passageRows, 'external_id');

    // --- audio clips ---
    const usedClips = new Set(wanted.map((q) => q.audioClipId).filter(Boolean));
    const clipRows = bundle.audioClips
      .filter((c) => usedClips.has(c.id))
      .map((c) => ({
        external_id: c.id,
        batch_id: BATCH_ID,
        audio_key: c.audioKey,
        storage_path: c.storagePath,
        transcript: c.transcript ?? null,
        duration_ms: c.durationMs ?? null,
      }));
    if (clipRows.length) await upsert('audio_clips', clipRows, 'external_id');

    // Re-read to resolve foreign keys.
    const { data: pRows } = await db.from('passages').select('id, external_id');
    const passageIdByExternal = new Map(
      (pRows ?? []).filter((r) => r.external_id).map((r) => [r.external_id as string, r.id as string]),
    );
    const { data: cRows } = await db.from('audio_clips').select('id, external_id');
    const clipIdByExternal = new Map(
      (cRows ?? []).filter((r) => r.external_id).map((r) => [r.external_id as string, r.id as string]),
    );

    // --- questions: every field carried ---
    const questionRows = wanted.map((q: Question) => ({
      external_id: q.id,
      batch_id: BATCH_ID,
      passage_id: q.passageId ? passageIdByExternal.get(q.passageId) ?? null : null,
      audio_clip_id: q.audioClipId ? clipIdByExternal.get(q.audioClipId) ?? null : null,
      ordinal: q.ordinal ?? null,
      category: q.section,
      skill_id: q.skillId,
      difficulty: q.difficulty,
      tags: q.tags ?? [],
      status: q.status,
      question_text: q.text,
      options: q.options,
      correct_option: q.correctOption,
      explanation: q.explanationAr ?? null,
      content_hash: q.contentHash,
      image_url: q.imageUrl ?? null,
      image_alt: q.imageAlt ?? null,
      // Legacy keys were human-authored and verified, not model guesses.
      answer_source: 'human_review',
      needs_human_review: q.status === 'review',
    }));

    await upsert('questions', questionRows, 'external_id');

    const { count } = await db.from('questions').select('*', { count: 'exact', head: true });
    console.log(`\nDone. questions table holds ${count} row(s).`);
    console.log('Next: npx tsx scripts/verify-migration.ts');
  } catch (err) {
    console.error(`\nFAILED: ${err instanceof Error ? err.message : String(err)}`);
    console.error('Nothing is half-applied: every write is an idempotent upsert, so re-run after fixing.');
    process.exit(1);
  }
})();
