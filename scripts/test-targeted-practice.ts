/**
 * Targeted practice builder.
 *
 * Runs against the real content bundle, because the failure this guards
 * against is a filter that quietly matches nothing — which a fixture
 * with three hand-made questions would never reveal.
 */

import { getContentProvider } from '../src/lib/content/activeProvider';
import { selectPool } from '../src/lib/content/provider';
import { checkBlueprint, targetedPracticeBlueprint, UNTIMED_SECONDS } from '../src/lib/content/blueprint';
import { buildExam } from '../src/lib/exam/buildExam';
import { FULL_STEP_BLUEPRINT } from '../src/lib/content/blueprint';
import { SECTIONS, SKILL_BY_ID, type SectionId } from '../src/lib/content/taxonomy';

let failures = 0;
const check = (label: string, cond: boolean, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
};

async function main() {
  const snapshot = await getContentProvider().load();
  console.log(`\ncontent: ${snapshot.questions.length} questions\n`);

  // -------------------------------------------------------------------
  console.log('--- per-section drills ---');
  for (const section of SECTIONS) {
    const available = selectPool(snapshot, { section }).length;
    if (!available) {
      console.log(`  SKIP  ${section} — no published questions`);
      continue;
    }

    const want = Math.min(10, available);
    const exam = buildExam(
      targetedPracticeBlueprint({ sections: [{ section, questionCount: want }] }),
      snapshot,
      { seed: 1 },
    );

    /**
     * At LEAST the requested count, not exactly it.
     *
     * Reading and listening questions come attached to a shared passage
     * or clip, and the builder will not split a group — asking for 10
     * against passages of 4 yields 12. Rounding up to a whole stimulus
     * is correct; splitting one would show the same passage twice.
     */
    check(`${section}: built at least ${want}`,
      exam.totalQuestions >= want, `got ${exam.totalQuestions}`);
    check(`${section}: does not overshoot wildly`,
      exam.totalQuestions <= want + 10, `got ${exam.totalQuestions}`);
    check(`${section}: single part`, exam.parts.length === 1, `${exam.parts.length} parts`);
    check(`${section}: instant feedback on`, exam.instantFeedback);
    check(
      `${section}: only that section`,
      Object.values(exam.questions).every((q) => q.section === section),
    );
    check(`${section}: untimed clock`, exam.parts[0].durationSeconds === UNTIMED_SECONDS);
  }

  // -------------------------------------------------------------------
  console.log('\n--- single-skill drill ---');
  const grammarPool = selectPool(snapshot, { section: 'grammar' });
  const bySkill = new Map<string, number>();
  for (const q of grammarPool) bySkill.set(q.skillId, (bySkill.get(q.skillId) ?? 0) + 1);

  const [topSkill, topCount] = [...bySkill.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];
  if (topSkill) {
    const want = Math.min(10, topCount);
    const exam = buildExam(
      targetedPracticeBlueprint({
        sections: [{ section: 'grammar', questionCount: want, skillIds: [topSkill] }],
      }),
      snapshot,
      { seed: 2 },
    );

    check(`skill ${SKILL_BY_ID[topSkill]?.nameAr ?? topSkill}: built ${want}`,
      exam.totalQuestions >= want, `got ${exam.totalQuestions}`);
    check('every question is that skill',
      Object.values(exam.questions).every((q) => q.skillId === topSkill));
  } else {
    check('grammar has a skill to drill', false);
  }

  // -------------------------------------------------------------------
  console.log('\n--- difficulty filter ---');
  for (const difficulty of ['easy', 'medium', 'hard'] as const) {
    const pool = selectPool(snapshot, { section: 'grammar', difficulties: [difficulty] });
    if (!pool.length) {
      console.log(`  SKIP  ${difficulty} — none in bank`);
      continue;
    }
    const want = Math.min(5, pool.length);
    const exam = buildExam(
      targetedPracticeBlueprint({
        sections: [{ section: 'grammar', questionCount: want }],
        difficulties: [difficulty],
      }),
      snapshot,
      { seed: 3 },
    );
    check(`${difficulty}: every question matches`,
      Object.values(exam.questions).every((q) => q.difficulty === difficulty),
      `${exam.totalQuestions} questions`);
  }

  // -------------------------------------------------------------------
  console.log('\n--- mixed practice ---');
  const stocked = SECTIONS.filter((s) => selectPool(snapshot, { section: s }).length >= 5);
  if (stocked.length >= 2) {
    const mixed = buildExam(
      targetedPracticeBlueprint({
        sections: stocked.map((section) => ({ section, questionCount: 5 })),
        nameAr: 'تدريب مختلط',
      }),
      snapshot,
      { seed: 4 },
    );
    check('mixed: totals add up', mixed.totalQuestions >= stocked.length * 5,
      `got ${mixed.totalQuestions}`);
    check('mixed: one part per section', mixed.parts.length === stocked.length,
      `${mixed.parts.length} parts`);
    check('mixed: every section represented',
      stocked.every((s) => mixed.parts.some((p) => p.section === s)));
  } else {
    console.log(`  SKIP  only ${stocked.length} section(s) stocked`);
  }

  // -------------------------------------------------------------------
  console.log('\n--- impossible filter degrades safely ---');
  const empty = buildExam(
    targetedPracticeBlueprint({
      sections: [{ section: 'grammar', questionCount: 10, skillIds: ['no-such-skill'] }],
    }),
    snapshot,
    { seed: 5 },
  );
  check('builds nothing rather than throwing', empty.totalQuestions === 0);
  check('no phantom parts', empty.parts.length === 0);

  // -------------------------------------------------------------------
  console.log('\n--- blueprint integrity ---');
  const targeted = targetedPracticeBlueprint({
    sections: [{ section: 'grammar', questionCount: 10 }],
  });
  const bpCheck = checkBlueprint(targeted);
  check('targeted blueprint self-consistent', bpCheck.ok, bpCheck.problems.join('; '));

  // The exam must be untouched by all of the above.
  const full = checkBlueprint(FULL_STEP_BLUEPRINT);
  check('FULL_STEP_BLUEPRINT still valid', full.ok, full.problems.join('; '));
  check('exam blueprint carries no filters',
    FULL_STEP_BLUEPRINT.parts.every((p) => !p.skillIds && !p.difficulties));

  const examBuild = buildExam(FULL_STEP_BLUEPRINT, snapshot, { seed: 42 });
  const examBuild2 = buildExam(FULL_STEP_BLUEPRINT, snapshot, { seed: 42 });
  check('exam build still deterministic',
    JSON.stringify(Object.keys(examBuild.questions).sort())
      === JSON.stringify(Object.keys(examBuild2.questions).sort()));

  console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}\n`);
  if (failures) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
