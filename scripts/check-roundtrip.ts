/**
 * Reads a question straight from the database to confirm that authored
 * formatting survived the round trip.
 *
 * Newlines are content in sentence-ordering and error-detection items,
 * and a trim() in the wrong place silently flattens them — which the UI
 * would not reveal until a student saw the question mid-exam.
 *
 *   npx tsx scripts/check-roundtrip.ts "<text fragment>"
 */
import { createClient } from '@supabase/supabase-js';
import { requireSupabaseEnv } from './_env';

const fragment = process.argv[2] ?? 'Put the steps';
const { url, serviceKey } = requireSupabaseEnv();
const db = createClient(url, serviceKey, { auth: { persistSession: false } });

(async () => {
  const { data, error } = await db
    .from('questions')
    .select('question_text, explanation, skill_id, category, difficulty, status, tags, correct_option, options, content_hash')
    .ilike('question_text', `%${fragment}%`)
    .limit(1);

  if (error) { console.error(error.message); process.exit(1); }
  const r = data?.[0];
  if (!r) { console.log(`no question matching "${fragment}"`); process.exit(1); }

  const nl = (s: string | null) => (s?.match(/\n/g) ?? []).length;

  console.log('newlines in text        :', nl(r.question_text as string));
  console.log('newlines in explanation :', nl(r.explanation as string));
  console.log('skill_id                :', r.skill_id);
  console.log('category                :', r.category);
  console.log('difficulty              :', r.difficulty);
  console.log('status                  :', r.status);
  console.log('tags                    :', JSON.stringify(r.tags));
  console.log('correct_option          :', r.correct_option);
  console.log('options                 :', JSON.stringify(r.options));
  console.log('content_hash            :', String(r.content_hash).slice(0, 16), '…');
  console.log('\ntext as stored:');
  console.log(JSON.stringify(r.question_text));
})();
