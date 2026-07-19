/**
 * Inspect exam_attempts against the live database.
 *
 * Resume is built on this table, so its shape has to be confirmed before
 * anything depends on it — a column that silently does not persist would
 * only surface as a lost sitting.
 */
import { createClient } from '@supabase/supabase-js';
import { requireSupabaseEnv } from './_env';

const { url, serviceKey } = requireSupabaseEnv();
const db = createClient(url, serviceKey, { auth: { persistSession: false } });

(async () => {
  const { data, error } = await db
    .from('exam_attempts')
    .select('id, status, current_part, max_part_index, revision, phase, screen_index, total_questions, correct_count, weighted_score, started_at, submitted_at, blueprint, answers, flags, part_timings')
    .order('started_at', { ascending: false })
    .limit(5);

  if (error) { console.error('read failed:', error.message); process.exit(1); }

  console.log(`attempts found: ${data?.length ?? 0}\n`);
  for (const a of data ?? []) {
    const answers = (a.answers ?? {}) as Record<string, string>;
    const bp = (a.blueprint ?? {}) as Record<string, unknown>;
    console.log(`id           : ${String(a.id).slice(0, 8)}…`);
    console.log(`  status     : ${a.status}  phase=${a.phase}  part=${a.current_part}/${a.max_part_index}  screen=${a.screen_index}`);
    console.log(`  revision   : ${a.revision}`);
    console.log(`  answers    : ${Object.keys(answers).length}`);
    console.log(`  flags      : ${((a.flags ?? []) as string[]).length}`);
    console.log(`  timings    : ${Object.keys((a.part_timings ?? {}) as object).length} part(s)`);
    console.log(`  blueprint  : keys=${Object.keys(bp).join(',')}`);
    console.log(`  questionIds: ${Array.isArray(bp.questionIds) ? (bp.questionIds as string[]).length : 'MISSING'}`);
    console.log(`  parts saved: ${Array.isArray(bp.parts) ? (bp.parts as unknown[]).length : 'MISSING — cannot resume'}`);
    console.log(`  score      : ${a.correct_count ?? '—'}/${a.total_questions} weighted=${a.weighted_score ?? '—'}`);
    console.log('');
  }
})();
