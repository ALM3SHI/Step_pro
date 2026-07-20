'use client';

import { memo } from 'react';
import { Alert, Badge, Card, Delta, Meter, SectionTitle } from '@/components/ui';
import { STATUS } from './palette';
import type { SkillScore } from '@/lib/exam/scoring';

export interface SkillBaseline {
  skillId: string;
  nameAr: string;
  /** Accuracy across earlier attempts, before this drill. */
  priorAccuracyPct: number | null;
  priorAttempted: number;
}

/** Below this, a drill's own accuracy is too noisy to judge mastery on. */
const RELIABLE_SAMPLE = 4;

/** At or above this, the skill is not the one to spend the next session on. */
const MASTERED_PCT = 80;

/**
 * Below this, the skill needs another session whatever the direction.
 *
 * Improvement does not cancel a failing score: a learner who went from
 * 0% to 10% has improved and still cannot do the skill. Reporting that
 * as "يتحسّن" and dropping it from the redrill list would send them
 * somewhere else on the strength of a trend line.
 */
const FLOOR_PCT = 50;

/** A move smaller than this is inside the noise of a short drill. */
const MEANINGFUL_DELTA = 10;

type Verdict = 'mastered' | 'improving' | 'repeat' | 'unknown';

const VERDICT: Record<Verdict, { label: string; tone: 'good' | 'warn' | 'bad' | 'neutral' }> = {
  mastered: { label: 'متقن', tone: 'good' },
  improving: { label: 'يتحسّن', tone: 'warn' },
  repeat: { label: 'أعد التدريب', tone: 'bad' },
  unknown: { label: 'عينة صغيرة', tone: 'neutral' },
};

function verdictFor(skill: SkillScore, delta: number | null): Verdict {
  // A three-question sample cannot support "mastered" OR "repeat".
  if (skill.total < RELIABLE_SAMPLE) return 'unknown';
  if (skill.accuracyPct >= MASTERED_PCT) return 'mastered';
  // The floor is checked BEFORE the trend, so a rising failing score is
  // still a redrill. The delta is still displayed — the learner sees the
  // progress, it just does not excuse the skill from the next session.
  if (skill.accuracyPct < FLOOR_PCT) return 'repeat';
  if (delta !== null && delta >= MEANINGFUL_DELTA) return 'improving';
  return 'repeat';
}

/**
 * What this drill changed.
 *
 * The comparison is against the skill's standing BEFORE the session,
 * captured when the drill was built — comparing against a figure this
 * very drill moved would report progress against itself.
 *
 * Every verdict is withheld on a small sample. Telling someone they
 * have mastered a skill on 2/2, or that they must redrill it on 1/3, is
 * a claim the data cannot carry, and both misdirect the next session.
 */
export const PracticeSummary = memo(function PracticeSummary({
  skills,
  baseline,
}: {
  skills: SkillScore[];
  baseline: SkillBaseline[];
}) {
  if (!skills.length) return null;

  const priorById = new Map(baseline.map((b) => [b.skillId, b]));

  const rows = skills
    .map((s) => {
      const prior = priorById.get(s.skillId);
      // Only compare when the earlier figure rests on enough questions.
      const comparable =
        prior && prior.priorAccuracyPct !== null && prior.priorAttempted >= RELIABLE_SAMPLE;
      const delta = comparable
        ? Math.round(s.accuracyPct - prior!.priorAccuracyPct!)
        : null;

      return { skill: s, prior, delta, comparable, verdict: verdictFor(s, delta) };
    })
    .sort((a, b) => a.skill.accuracyPct - b.skill.accuracyPct);

  const needRepeat = rows.filter((r) => r.verdict === 'repeat');
  const anyComparison = rows.some((r) => r.delta !== null);

  return (
    <Card className="p-6" aria-labelledby="practice-summary-title">
      <SectionTitle
        id="practice-summary-title"
        hint="مقارنة بأدائك السابق على المهارات نفسها، قبل هذه الجلسة."
      >
        أثر هذه الجلسة
      </SectionTitle>

      {!anyComparison && (
        <div className="mb-4">
          <Alert>
            لا توجد مقارنة بعد — هذه أول جلسة مسجَّلة على هذه المهارات، أو أن محاولاتك
            السابقة عليها أقل من {RELIABLE_SAMPLE} أسئلة. أكمل جلسة أخرى وسيظهر الاتجاه هنا.
          </Alert>
        </div>
      )}

      <ul className="stagger space-y-3">
        {rows.map(({ skill, prior, delta, comparable, verdict }) => {
          const v = VERDICT[verdict];
          const tone =
            skill.total < RELIABLE_SAMPLE
              ? 'var(--app-muted)'
              : skill.accuracyPct >= MASTERED_PCT
                ? STATUS.good
                : skill.accuracyPct >= 50
                  ? STATUS.warning
                  : STATUS.critical;

          return (
            <li key={skill.skillId}>
              <div className="mb-1 flex flex-wrap items-baseline gap-2 text-sm">
                <b>{skill.nameAr}</b>
                <Badge tone={v.tone}>{v.label}</Badge>
                {delta !== null && Math.abs(delta) >= MEANINGFUL_DELTA && (
                  <Delta value={delta} suffix="%" />
                )}
                <span className="flex-1" />
                <b className="tabular-nums">{skill.accuracyPct.toFixed(0)}%</b>
                <span className="text-xs tabular-nums text-[color:var(--app-muted)]">
                  {skill.correct}/{skill.total}
                </span>
                {/* Only when the earlier figure is one we were willing
                    to compare against. Printing "كان 0%" beside a panel
                    that just said there is no comparison yet states a
                    baseline and disowns it in the same breath. */}
                {comparable && (
                  <span className="text-xs tabular-nums text-[color:var(--app-muted)]">
                    · كان {prior!.priorAccuracyPct!.toFixed(0)}%
                  </span>
                )}
              </div>
              <Meter
                value={skill.accuracyPct}
                color={tone}
                label={`${skill.nameAr}: ${skill.accuracyPct.toFixed(0)} بالمئة في هذه الجلسة`}
              />
            </li>
          );
        })}
      </ul>

      {needRepeat.length > 0 && (
        <div className="mt-5">
          <Alert tone="warn">
            <b className="mb-1 block">يُنصح بإعادة التدريب على</b>
            <ul className="space-y-0.5">
              {needRepeat.map((r) => (
                <li key={r.skill.skillId}>
                  {r.skill.nameAr} — {r.skill.correct}/{r.skill.total} (
                  {r.skill.accuracyPct.toFixed(0)}%)
                </li>
              ))}
            </ul>
          </Alert>
        </div>
      )}
    </Card>
  );
});
