'use client';

import Link from 'next/link';
import { useMemo, useState, useTransition } from 'react';
import { ExamRunner } from '@/components/exam/ExamRunner';
import {
  getSkillBaseline, startTargetedPractice, startWeakestSkillPractice,
  type SkillAvailability, type SkillProgressRow, type WeakSkillPick,
} from '@/app/actions/practice';
import { SECTION_LIST, SKILLS_BY_SECTION, type Difficulty, type SectionId } from '@/lib/content/taxonomy';
import {
  Alert, Badge, Button, Card, EmptyState, Pill, SectionTitle, Stat, linkClass,
} from '@/components/ui';
import type { BuiltExam } from '@/lib/exam/buildExam';

const COUNTS = [5, 10, 20, 40];

const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  easy: 'سهل',
  medium: 'متوسط',
  hard: 'صعب',
};

const SECTION_ICON: Record<string, string> = {
  reading: '📖', grammar: '✏️', listening: '🎧', writing: '📝',
};

type Mode = 'targeted' | 'weakest' | 'mixed';

/**
 * Targeted practice setup.
 *
 * Once a drill is built the runner takes the whole viewport, exactly as
 * the exam does — the launcher is not rendered underneath it. The three
 * modes converge on the same server action, so a drill built from the
 * weakest-skill picker is the same object as a hand-configured one.
 */
export function PracticeLauncher({
  availability,
  bySection,
  weakest,
  weakestReason,
}: {
  availability: SkillAvailability[];
  bySection: Record<string, number>;
  weakest: WeakSkillPick[];
  weakestReason?: string;
}) {
  const [exam, setExam] = useState<BuiltExam | null>(null);
  const [baseline, setBaseline] = useState<SkillProgressRow[]>([]);
  const [mode, setMode] = useState<Mode>('targeted');
  const [section, setSection] = useState<SectionId>('grammar');
  const [skillIds, setSkillIds] = useState<string[]>([]);
  const [difficulty, setDifficulty] = useState<Difficulty | null>(null);
  const [count, setCount] = useState(10);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const byId = useMemo(
    () => new Map(availability.map((a) => [a.skillId, a])),
    [availability],
  );

  /** Skills in this section that the bank can actually serve. */
  const sectionSkills = useMemo(
    () =>
      (SKILLS_BY_SECTION[section] ?? [])
        .map((s) => ({ def: s, avail: byId.get(s.id) }))
        .filter((s) => (s.avail?.total ?? 0) > 0),
    [section, byId],
  );

  /**
   * How many questions the current selection can actually produce.
   *
   * Computed from the same availability the picker shows, so the button
   * disables before the learner commits rather than after the server
   * returns an empty drill.
   */
  const reachable = useMemo(() => {
    if (mode === 'weakest') {
      return weakest.reduce((n, w) => n + (byId.get(w.skillId)?.total ?? 0), 0);
    }
    if (mode === 'mixed') {
      return Object.values(bySection).reduce((a, b) => a + b, 0);
    }
    const pool = skillIds.length
      ? skillIds.map((id) => byId.get(id)).filter(Boolean)
      : sectionSkills.map((s) => s.avail!);

    return pool.reduce(
      (n, a) => n + (difficulty ? a!.byDifficulty[difficulty] : a!.total),
      0,
    );
  }, [mode, skillIds, sectionSkills, difficulty, byId, weakest, bySection]);

  const toggleSkill = (id: string) =>
    setSkillIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const launch = () => {
    setError(null);
    setNotice(null);
    start(async () => {
      const res = mode === 'weakest'
        ? await startWeakestSkillPractice(count)
        : await startTargetedPractice(
            mode === 'mixed'
              ? {
                  sections: SECTION_LIST
                    .filter((s) => (bySection[s.id] ?? 0) > 0)
                    .map((s) => ({
                      section: s.id,
                      questionCount: Math.max(1, Math.round(count / 4)),
                    })),
                  difficulties: difficulty ? [difficulty] : undefined,
                  nameAr: 'تدريب مختلط',
                }
              : {
                  sections: [{
                    section,
                    questionCount: count,
                    skillIds: skillIds.length ? skillIds : undefined,
                  }],
                  difficulties: difficulty ? [difficulty] : undefined,
                },
          );

      if (!res.ok || !res.exam) {
        setError(res.error ?? 'تعذّر بناء جلسة التدريب');
        return;
      }
      if (res.shortfall) {
        setNotice(
          `طلبت ${res.shortfall.wanted} سؤالًا والمتاح ${res.shortfall.got}. الجلسة ستكون أقصر.`,
        );
      }

      // Captured BEFORE the drill is played, so the post-session
      // comparison is against history rather than against itself.
      const base = await getSkillBaseline(res.skillIds ?? []);
      setBaseline(base.rows ?? []);

      setExam(res.exam);
    });
  };

  if (exam) {
    return (
      <ExamRunner
        exam={exam}
        persist
        skillBaseline={baseline}
        onExit={() => { setExam(null); setBaseline([]); }}
      />
    );
  }

  const canStart = reachable > 0 && !pending;

  return (
    <div className="mx-auto max-w-3xl space-y-5 px-6 py-10 sm:py-14">
      <header className="animate-fade-up flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold tracking-tight text-[color:var(--app-brand)] sm:text-3xl">
            التدريب الذكي
          </h1>
          <p className="mt-1 text-sm text-[color:var(--app-muted)]">
            بلا مؤقت، مع كشف الإجابة والشرح بعد كل سؤال.
          </p>
        </div>
        <Link href="/" className={linkClass({ variant: 'ghost', size: 'sm' })}>الرئيسية</Link>
        <Link href="/exam" className={linkClass({ variant: 'ghost', size: 'sm' })}>الاختبار الكامل</Link>
      </header>

      {error && <Alert tone="bad">{error}</Alert>}
      {notice && <Alert tone="warn">{notice}</Alert>}

      {/* ---------- mode ---------- */}
      <Card className="animate-fade-up p-6">
        <SectionTitle hint="اختر كيف تريد بناء الجلسة.">نوع التدريب</SectionTitle>
        <div className="flex flex-wrap gap-2">
          <Pill active={mode === 'targeted'} onClick={() => setMode('targeted')}>
            🎯 قسم ومهارة محددة
          </Pill>
          <Pill
            active={mode === 'weakest'}
            onClick={() => setMode('weakest')}
            disabled={weakest.length === 0}
            title={weakest.length === 0 ? weakestReason : undefined}
          >
            🧠 أضعف مهاراتي
          </Pill>
          <Pill active={mode === 'mixed'} onClick={() => setMode('mixed')}>
            🔀 تدريب مختلط
          </Pill>
        </div>
      </Card>

      {/* ---------- weakest ---------- */}
      {mode === 'weakest' && (
        <Card className="animate-scale-in p-6">
          <SectionTitle hint="مبنية على أدائك المسجَّل، بعد استبعاد المهارات ذات العينة الصغيرة.">
            المهارات المستهدفة
          </SectionTitle>

          {weakest.length === 0 ? (
            <EmptyState
              icon="📊"
              title="لا توجد بيانات كافية بعد"
              body={weakestReason}
              action={
                <Link href="/exam" className={linkClass({ variant: 'primary' })}>
                  ابدأ اختبارًا
                </Link>
              }
            />
          ) : (
            <ul className="stagger space-y-2">
              {weakest.map((w) => (
                <li
                  key={w.skillId}
                  className="flex flex-wrap items-center gap-2 rounded-xl bg-black/[0.03] px-4 py-3 dark:bg-white/[0.04]"
                >
                  <span aria-hidden>{SECTION_ICON[w.section]}</span>
                  <b className="min-w-0 flex-1">{w.nameAr}</b>
                  <Badge tone={w.accuracyPct < 50 ? 'bad' : 'warn'}>
                    {w.accuracyPct.toFixed(0)}%
                  </Badge>
                  <span className="text-xs tabular-nums text-[color:var(--app-muted)]">
                    من {w.attempted} محاولة
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {/* ---------- targeted ---------- */}
      {mode === 'targeted' && (
        <>
          <Card className="animate-fade-up p-6">
            <SectionTitle>القسم</SectionTitle>
            <div className="flex flex-wrap gap-2">
              {SECTION_LIST.map((s) => {
                const avail = bySection[s.id] ?? 0;
                return (
                  <Pill
                    key={s.id}
                    active={section === s.id}
                    disabled={avail === 0}
                    onClick={() => { setSection(s.id); setSkillIds([]); }}
                    title={avail === 0 ? 'لا توجد أسئلة منشورة في هذا القسم' : undefined}
                  >
                    <span aria-hidden className="ml-1">{SECTION_ICON[s.id]}</span>
                    {s.nameAr}
                    <span className="mr-1 tabular-nums opacity-60">({avail})</span>
                  </Pill>
                );
              })}
            </div>
          </Card>

          <Card className="animate-fade-up p-6">
            <SectionTitle hint="اترك الكل بلا تحديد للتدرّب على القسم بأكمله.">
              المهارات
            </SectionTitle>

            {sectionSkills.length === 0 ? (
              <EmptyState icon="🗂" title="لا توجد مهارات لها أسئلة في هذا القسم بعد" />
            ) : (
              <>
                <div className="flex flex-wrap gap-2">
                  {sectionSkills.map(({ def, avail }) => (
                    <Pill
                      key={def.id}
                      active={skillIds.includes(def.id)}
                      onClick={() => toggleSkill(def.id)}
                    >
                      {def.nameAr}
                      <span className="mr-1 tabular-nums opacity-60">({avail!.total})</span>
                    </Pill>
                  ))}
                </div>
                {skillIds.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-3"
                    onClick={() => setSkillIds([])}
                  >
                    إلغاء تحديد الكل
                  </Button>
                )}
              </>
            )}
          </Card>
        </>
      )}

      {/* ---------- difficulty + count ---------- */}
      <Card className="animate-fade-up p-6">
        <SectionTitle>الصعوبة</SectionTitle>
        <div className="mb-5 flex flex-wrap gap-2">
          <Pill active={difficulty === null} onClick={() => setDifficulty(null)}>
            كل المستويات
          </Pill>
          {(Object.keys(DIFFICULTY_LABEL) as Difficulty[]).map((d) => {
            // A band with nothing behind it is offered as disabled rather
            // than hidden, so the bank's shape stays visible.
            const avail = mode === 'targeted'
              ? (skillIds.length ? skillIds : sectionSkills.map((s) => s.def.id))
                  .reduce((n, id) => n + (byId.get(id)?.byDifficulty[d] ?? 0), 0)
              : availability.reduce((n, a) => n + a.byDifficulty[d], 0);

            return (
              <Pill
                key={d}
                active={difficulty === d}
                disabled={avail === 0}
                onClick={() => setDifficulty(d)}
                title={avail === 0 ? 'لا توجد أسئلة بهذا المستوى' : undefined}
              >
                {DIFFICULTY_LABEL[d]}
                <span className="mr-1 tabular-nums opacity-60">({avail})</span>
              </Pill>
            );
          })}
        </div>

        <SectionTitle>عدد الأسئلة</SectionTitle>
        <div className="flex flex-wrap gap-2">
          {COUNTS.map((n) => (
            <Pill
              key={n}
              tone="accent"
              active={count === n}
              disabled={reachable < n}
              onClick={() => setCount(n)}
              title={reachable < n ? `المتاح ${reachable} فقط` : undefined}
            >
              {n} سؤالًا
            </Pill>
          ))}
        </div>
      </Card>

      {/* ---------- launch ---------- */}
      <Card className="animate-fade-up p-6">
        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Stat label="المتاح لاختيارك" value={reachable} />
          <Stat label="طول الجلسة" value={Math.min(count, reachable)} hint="سؤالًا" />
          <Stat label="المؤقت" value="بلا مؤقت" />
        </div>

        <Button variant="primary" size="lg" block onClick={launch} disabled={!canStart}>
          {pending ? '…جارٍ التحضير' : 'ابدأ التدريب'}
        </Button>

        {reachable === 0 && (
          <p className="mt-3 text-center text-xs text-[color:var(--app-muted)]">
            لا توجد أسئلة تطابق هذا الاختيار.
          </p>
        )}
      </Card>
    </div>
  );
}
