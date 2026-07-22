/**
 * Reading-bank readiness report.
 *
 * Answers one question: how many of the reading drafts could be
 * published, and what is wrong with the rest.
 *
 * READ-ONLY BY DEFAULT. It never changes a status — publishing is an
 * editorial judgement about whether an item belongs in a graded exam,
 * and a validator cannot make it. Pass --fix-tags to apply ONLY the
 * section re-tagging described below, which is a correction of a
 * demonstrable import error, not a publishing decision.
 *
 *   npx tsx scripts/audit-reading-drafts.ts
 *   npx tsx scripts/audit-reading-drafts.ts --fix-tags
 */
import { createClient } from '@supabase/supabase-js';
import { requireSupabaseEnv } from './_env';
import { validateDraft } from '../src/lib/content/validation';
import { SKILL_BY_ID } from '../src/lib/content/taxonomy';
import type { OptionKey } from '../src/lib/content/schema';

const APPLY_FIXES = process.argv.includes('--fix-tags');

const { url, serviceKey } = requireSupabaseEnv();
const db = createClient(url, serviceKey, { auth: { persistSession: false } });

interface Row {
  id: string;
  category: string;
  skill_id: string | null;
  status: string;
  question_text: string;
  options: Record<string, string> | null;
  correct_option: string | null;
  explanation: string | null;
  passage_id: string | null;
  audio_clip_id: string | null;
  image_url: string | null;
  image_alt: string | null;
  difficulty: string | null;
}

async function fetchAll(category: string): Promise<Row[]> {
  const out: Row[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from('questions')
      .select('id, category, skill_id, status, question_text, options, correct_option, explanation, passage_id, audio_clip_id, image_url, image_alt, difficulty')
      .eq('category', category)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    out.push(...(data as unknown as Row[]));
    if (data.length < PAGE) break;
  }
  return out;
}

function asDraft(r: Row) {
  return {
    section: r.category as 'reading',
    skillId: r.skill_id ?? '',
    difficulty: r.difficulty ?? 'medium',
    // Validate as a PUBLISH candidate, not as a draft — the question is
    // whether it could go live, so the publish-only rules must apply.
    status: 'published',
    text: r.question_text ?? '',
    options: (r.options ?? {}) as Partial<Record<OptionKey, string>>,
    correctOption: (r.correct_option ?? '') as OptionKey | '',
    explanationAr: r.explanation ?? '',
    passageId: r.passage_id,
    audioClipId: r.audio_clip_id,
    imageUrl: r.image_url,
    imageAlt: r.image_alt,
  };
}

/**
 * Reading items that carry no passage and no image.
 *
 * A reading question with nothing to read is a mis-tag, not a hard
 * question: these are standalone sentence-completion items that belong
 * in grammar. They matter because they surface INSIDE the Reading
 * section of the simulator as bare grammar prompts.
 */
function isMistaggedGrammar(r: Row): boolean {
  return !r.passage_id && !r.image_url;
}

async function main() {
  const reading = await fetchAll('reading');
  const byStatus = new Map<string, Row[]>();
  for (const r of reading) {
    byStatus.set(r.status, [...(byStatus.get(r.status) ?? []), r]);
  }

  console.log('='.repeat(64));
  console.log('READING BANK — READINESS REPORT');
  console.log('='.repeat(64));
  console.log(`total tagged reading: ${reading.length}`);
  for (const [status, rows] of [...byStatus].sort()) {
    console.log(`  ${status.padEnd(12)} ${rows.length}`);
  }

  // --- 1. mis-tagged items ---------------------------------------------
  const mistagged = reading.filter(isMistaggedGrammar);
  console.log(`\n--- MIS-TAGGED (reading with no passage and no image): ${mistagged.length} ---`);
  const mistaggedPublished = mistagged.filter((r) => r.status === 'published');
  console.log(`  of which PUBLISHED and live in the exam right now: ${mistaggedPublished.length}`);
  for (const r of mistagged.slice(0, 12)) {
    console.log(`  [${r.status}] skill=${r.skill_id} | ${r.question_text.slice(0, 62).replace(/\n/g, ' ')}`);
  }
  if (mistagged.length > 12) console.log(`  … and ${mistagged.length - 12} more`);

  // --- 2. draft readiness ----------------------------------------------
  const drafts = (byStatus.get('draft') ?? []).filter((r) => !isMistaggedGrammar(r));
  const ready: Row[] = [];
  const blocked: Array<{ row: Row; reasons: string[] }> = [];
  const reasonCounts = new Map<string, number>();

  for (const r of drafts) {
    const result = validateDraft(asDraft(r));
    if (result.canSave) { ready.push(r); continue; }
    const reasons = result.errors.map((e) => e.message);
    blocked.push({ row: r, reasons });
    for (const e of result.errors) {
      reasonCounts.set(e.field, (reasonCounts.get(e.field) ?? 0) + 1);
    }
  }

  console.log(`\n--- DRAFT READINESS (${drafts.length} genuine reading drafts) ---`);
  console.log(`  PUBLISHABLE AS-IS : ${ready.length}`);
  console.log(`  needs work        : ${blocked.length}`);

  if (reasonCounts.size) {
    console.log('\n  blocking issues by field:');
    for (const [field, n] of [...reasonCounts].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${field.padEnd(16)} ${n}`);
    }
  }

  const sample = blocked.slice(0, 8);
  if (sample.length) {
    console.log('\n  examples:');
    for (const { row, reasons } of sample) {
      console.log(`    ${row.id.slice(0, 8)} — ${reasons.join(' · ')}`);
    }
  }

  // --- 3. passage coverage ---------------------------------------------
  const readyByPassage = new Map<string, number>();
  for (const r of ready) {
    if (r.passage_id) readyByPassage.set(r.passage_id, (readyByPassage.get(r.passage_id) ?? 0) + 1);
  }
  const publishedNow = (byStatus.get('published') ?? []).filter((r) => !isMistaggedGrammar(r));
  const livePassages = new Set(publishedNow.map((r) => r.passage_id).filter(Boolean));

  console.log('\n--- PASSAGE COVERAGE ---');
  console.log(`  passages live now              : ${livePassages.size}`);
  console.log(`  additional passages if published: ${[...readyByPassage.keys()].filter((p) => !livePassages.has(p)).length}`);

  // A passage is only usable whole — a partly-published passage shows a
  // text with fewer questions than it was written for.
  const partial = [...readyByPassage.entries()].filter(([pid]) => {
    const total = reading.filter((r) => r.passage_id === pid).length;
    const readyN = readyByPassage.get(pid) ?? 0;
    const liveN = publishedNow.filter((r) => r.passage_id === pid).length;
    return readyN + liveN < total;
  });
  console.log(`  passages that would be PARTIALLY published: ${partial.length}`);

  // --- 4. what the exam would look like --------------------------------
  const BLUEPRINT_READING = 40;
  const liveCount = publishedNow.length;
  console.log('\n--- EFFECT ON THE FULL EXAM (blueprint wants 40) ---');
  console.log(`  reading available today            : ${liveCount}`);
  console.log(`  if you publish the ${ready.length} ready drafts : ${liveCount + ready.length}`);
  console.log(`  ${liveCount + ready.length >= BLUEPRINT_READING
    ? '  => Reading would be FULLY covered'
    : `  => still short by ${BLUEPRINT_READING - liveCount - ready.length}`}`);

  // --- 5. optional tag fix ---------------------------------------------
  console.log('\n' + '='.repeat(64));
  if (!APPLY_FIXES) {
    console.log('NO CHANGES WERE MADE. This report is read-only.');
    console.log(`Re-run with --fix-tags to move the ${mistagged.length} mis-tagged item(s)`);
    console.log('from reading to grammar. Publishing stays your decision.');
    return;
  }

  console.log(`APPLYING TAG FIX to ${mistagged.length} item(s)…`);
  let moved = 0;
  for (const r of mistagged) {
    // Skill must move with the section, or validation rejects the row for
    // carrying a reading skill on a grammar question.
    const skill = r.skill_id ? SKILL_BY_ID[r.skill_id] : undefined;
    const newSkill = skill && skill.section === 'reading' ? 'pronouns' : r.skill_id;

    const { error } = await db
      .from('questions')
      .update({ category: 'grammar', skill_id: newSkill })
      .eq('id', r.id);
    if (error) { console.error(`  FAILED ${r.id}: ${error.message}`); continue; }
    moved++;
  }
  console.log(`moved ${moved}/${mistagged.length} to grammar.`);
  console.log('Statuses were NOT touched.');
}

main().catch((e) => { console.error(e); process.exit(1); });
