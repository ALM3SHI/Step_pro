/**
 * Seed the content bundle into the EXISTING Supabase project.
 *
 * Idempotent: every table is upserted on its natural key, so re-running
 * updates in place rather than duplicating. Safe to run after each
 * `npm run content:build`.
 *
 *   npx tsx scripts/seed-supabase.ts           # published only
 *   npx tsx scripts/seed-supabase.ts --drafts  # include unkeyed drafts
 *   npx tsx scripts/seed-supabase.ts --dry     # report, write nothing
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
 */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import type { ContentBundle } from '../src/lib/content/schema';

const includeDrafts = process.argv.includes('--drafts');
const dryRun = process.argv.includes('--dry');

// Load .env.local by hand — this is a plain tsx script, not Next.
try {
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch {
  // No .env.local — fall back to the ambient environment.
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  console.error('Add them to .env.local, or export them before running.');
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false } });
const bundle: ContentBundle = JSON.parse(readFileSync('content/bundle.json', 'utf8'));

const questions = bundle.questions.filter(
  (q) => q.status === 'published' || (includeDrafts && q.status === 'draft'),
);

console.log(`bundle v${bundle.version} (${bundle.generatedAt})`);
console.log(`questions to seed : ${questions.length}${includeDrafts ? ' (incl. drafts)' : ' (published only)'}`);
console.log(`passages          : ${bundle.passages.length}`);
console.log(`audio clips       : ${bundle.audioClips.length}`);
if (dryRun) { console.log('\n--dry: nothing written.'); process.exit(0); }

/** Chunked upsert — a single 1,400-row insert exceeds request limits. */
async function upsert<T>(table: string, rows: T[], onConflict: string, size = 200) {
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
    // A batch row is required by the questions FK. One stable row for the
    // whole migration, so re-seeding never creates a second.
    const BATCH_ID = '00000000-0000-4000-8000-000000000001';
    const { error: batchErr } = await db.from('ingestion_batches').upsert(
      {
        id: BATCH_ID,
        batch_title: 'المحتوى المُرحَّل من النسخة القديمة',
        source_metadata: { origin: 'content/bundle.json', version: bundle.version },
        status: 'completed',
        total_questions_parsed: bundle.questions.length,
        total_questions_saved: questions.length,
      },
      { onConflict: 'id' },
    );
    if (batchErr) throw new Error(`ingestion_batches: ${batchErr.message}`);

    // Order matters: questions reference passages and clips.
    const usedPassages = new Set(questions.map((q) => q.passageId).filter(Boolean));
    const usedClips = new Set(questions.map((q) => q.audioClipId).filter(Boolean));

    await upsert(
      'passages',
      bundle.passages
        .filter((p) => usedPassages.has(p.id))
        .map((p) => ({
          id: p.id.startsWith('legacy-') || p.id.startsWith('bank-') ? undefined : p.id,
          batch_id: BATCH_ID,
          title: p.titleEn ?? p.titleAr ?? null,
          body: p.body,
          content_hash: p.contentHash,
          image_url: p.imageUrl ?? null,
          image_alt: p.imageAlt ?? null,
        })),
      'content_hash',
    );

    await upsert(
      'audio_clips',
      bundle.audioClips
        .filter((c) => usedClips.has(c.id))
        .map((c) => ({
          batch_id: BATCH_ID,
          audio_key: c.audioKey,
          storage_path: c.storagePath,
          transcript: c.transcript ?? null,
          duration_ms: c.durationMs ?? null,
        })),
      'audio_key',
    );

    // Re-read the generated ids so questions can reference them.
    const { data: passageRows } = await db.from('passages').select('id, content_hash');
    const passageIdByHash = new Map((passageRows ?? []).map((r) => [r.content_hash as string, r.id as string]));
    const { data: clipRows } = await db.from('audio_clips').select('id, audio_key');
    const clipIdByKey = new Map((clipRows ?? []).map((r) => [r.audio_key as string, r.id as string]));

    const passageHashById = new Map(bundle.passages.map((p) => [p.id, p.contentHash]));
    const clipKeyById = new Map(bundle.audioClips.map((c) => [c.id, c.audioKey]));

    const rows = questions.map((q) => ({
      batch_id: BATCH_ID,
      passage_id: q.passageId ? passageIdByHash.get(passageHashById.get(q.passageId) ?? '') ?? null : null,
      audio_clip_id: q.audioClipId ? clipIdByKey.get(clipKeyById.get(q.audioClipId) ?? '') ?? null : null,
      ordinal: q.ordinal ?? null,
      category: q.section,
      question_text: q.text,
      options: q.options,
      correct_option: q.correctOption,
      explanation: q.explanationAr ?? null,
      content_hash: q.contentHash,
      image_url: q.imageUrl ?? null,
      image_alt: q.imageAlt ?? null,
      // Legacy keys were human-authored and verified, not model guesses.
      answer_source: 'human_review',
      needs_human_review: q.status !== 'published',
      is_active: q.status === 'published',
    }));

    await upsert('questions', rows, 'content_hash');

    const { count } = await db.from('questions').select('*', { count: 'exact', head: true });
    console.log(`\nDone. questions table now holds ${count} row(s).`);
  } catch (err) {
    console.error(`\nFAILED: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
})();
