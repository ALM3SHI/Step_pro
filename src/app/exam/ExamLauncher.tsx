'use client';

import Link from 'next/link';
import { useEffect, useState, useTransition } from 'react';
import { ExamRunner, type ResumeState } from '@/components/exam/ExamRunner';
import { rehydrateExam, startFullExam, startPractice } from '@/app/actions/exam';
import {
  abandonAttempt, findResumableAttempt, resumeAttempt, type ResumableSummary,
} from '@/app/actions/attempts';
import { SECTION_LIST, type SectionId } from '@/lib/content/taxonomy';
import { Alert, Badge, Button, Card, Pill, Stat, linkClass } from '@/components/ui';
import type { BuiltExam } from '@/lib/exam/buildExam';

const PRACTICE_SIZES = [5, 10, 20];

const SECTION_ICON: Record<string, string> = {
  reading: '📖',
  grammar: '✏️',
  listening: '🎧',
  writing: '📝',
};

/**
 * Entry point for both modes, plus resume.
 *
 * Once an exam is built the runner replaces the entire viewport — the
 * launcher is not rendered underneath it, so there is nothing for the
 * candidate to click back to mid-sitting.
 */
export function ExamLauncher({
  pool,
  persist = true,
}: {
  pool: Record<string, number>;
  /** Off when Supabase is unconfigured — the exam still runs locally. */
  persist?: boolean;
}) {
  const [exam, setExam] = useState<BuiltExam | null>(null);
  const [resume, setResume] = useState<ResumeState | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [practiceSection, setPracticeSection] = useState<SectionId>('grammar');
  const [practiceSize, setPracticeSize] = useState(10);
  const [pending, start] = useTransition();

  const [resumable, setResumable] = useState<ResumableSummary | null>(null);
  const [checkedResume, setCheckedResume] = useState(!persist);

  useEffect(() => {
    if (!persist) return;
    let cancelled = false;
    void findResumableAttempt().then((res) => {
      if (cancelled) return;
      if (res.ok && res.attempt) setResumable(res.attempt);
      setCheckedResume(true);
    });
    return () => { cancelled = true; };
  }, [persist]);

  const launch = (fn: () => Promise<Awaited<ReturnType<typeof startFullExam>>>) => {
    setError(null);
    setWarnings([]);
    start(async () => {
      const res = await fn();
      if (!res.ok || !res.exam) { setError(res.error ?? 'تعذّر بناء الاختبار'); return; }

      if (res.shortfalls?.length) {
        // Surface a short section rather than letting the candidate
        // discover mid-exam that Reading was 30 questions, not 40.
        setWarnings(
          res.shortfalls.map(
            (s) => `${SECTION_LIST.find((x) => x.id === s.section)?.nameAr ?? s.section}: ${s.got} سؤالًا متاحًا من ${s.wanted}`,
          ),
        );
      }
      setResume(undefined);
      setExam(res.exam);
    });
  };

  const continueAttempt = (attemptId: string) => {
    setError(null);
    start(async () => {
      const saved = await resumeAttempt(attemptId);
      if (!saved.ok || !saved.payload) { setError(saved.error ?? 'تعذّر الاستئناف'); return; }

      const rebuilt = await rehydrateExam(saved.payload.skeleton);
      if (!rebuilt.ok || !rebuilt.exam) { setError(rebuilt.error ?? 'تعذّر إعادة بناء الاختبار'); return; }

      if (rebuilt.missing?.length) {
        setWarnings([`${rebuilt.missing.length} سؤالًا لم يعد متاحًا وحُذف من الاختبار.`]);
      }

      setResume({
        attemptId: saved.payload.attemptId,
        answers: saved.payload.answers,
        flags: saved.payload.flags,
        partIndex: saved.payload.partIndex,
        screenIndex: saved.payload.screenIndex,
        phase: saved.payload.phase,
        partTimings: saved.payload.partTimings,
        lockedScreens: saved.payload.lockedScreens,
        revision: saved.payload.revision,
      });
      setExam(rebuilt.exam);
    });
  };

  const discardAttempt = (attemptId: string) => {
    if (!window.confirm('تجاهل المحاولة السابقة نهائيًا؟ لن تستطيع العودة إليها.')) return;
    start(async () => {
      await abandonAttempt(attemptId);
      setResumable(null);
    });
  };

  if (exam) {
    return (
      <ExamRunner
        exam={exam}
        persist={persist}
        resume={resume}
        onPractice={(section, count) => {
          setExam(null);
          setResume(undefined);
          launch(() => startPractice(section as SectionId, count));
        }}
        onExit={() => { setExam(null); setResume(undefined); setResumable(null); }}
      />
    );
  }

  const practiceAvailable = pool[practiceSection] ?? 0;

  return (
    <div className="mx-auto max-w-3xl space-y-5 px-6 py-10 sm:py-14">
      <header className="animate-fade-up flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold tracking-tight text-[color:var(--app-brand)] sm:text-3xl">
            محاكي STEP
          </h1>
          <p className="mt-1 text-sm text-[color:var(--app-muted)]">
            اختبار كامل بتوزيع قياس، أو تدريب على قسم واحد.
          </p>
        </div>
        <Link
          href="/"
          className={linkClass({ variant: 'ghost', size: 'sm', className: 'text-[color:var(--app-muted)]' })}
        >
          الرئيسية
        </Link>
      </header>

      {error && <Alert tone="bad">{error}</Alert>}

      {/* ---------- resume ---------- */}
      {resumable && (
        <Card accent="warn" className="animate-scale-in p-6">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-bold">لديك اختبار غير مكتمل</h2>
            <Badge tone="warn">متوقّف</Badge>
          </div>

          <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="أجبت عنها" value={`${resumable.answered}`} />
            <Stat label="من أصل" value={`${resumable.totalQuestions}`} />
            <Stat label="الجزء" value={`${resumable.partIndex + 1} / ${resumable.totalParts}`} />
            <Stat
              label="بدأته"
              value={new Date(resumable.startedAt).toLocaleDateString('ar-SA', {
                month: 'short', day: 'numeric',
              })}
            />
          </div>

          <Alert tone="warn">
            ستكمل من بداية الجزء الذي توقفت عنده بمؤقت جديد — الوقت المنقضي في ذلك الجزء
            لا يُسترجع.
          </Alert>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              variant="primary"
              onClick={() => continueAttempt(resumable.attemptId)}
              disabled={pending}
            >
              {pending ? '…جارٍ التحميل' : 'إكمال الاختبار'}
            </Button>
            <Button onClick={() => discardAttempt(resumable.attemptId)} disabled={pending}>
              تجاهل والبدء من جديد
            </Button>
          </div>
        </Card>
      )}

      {/* ---------- full exam ---------- */}
      <Card className="animate-fade-up p-6">
        <div className="mb-1 flex flex-wrap items-baseline gap-2">
          <h2 className="text-lg font-bold">الاختبار الكامل</h2>
          <Badge tone="brand">مطابق لقياس</Badge>
        </div>
        <p className="mb-5 text-sm text-[color:var(--app-muted)]">
          100 سؤال · 120 دقيقة · 4 أقسام × 3 أجزاء
        </p>

        <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {SECTION_LIST.map((s) => {
            const available = pool[s.id] ?? 0;
            return (
              <div
                key={s.id}
                className="rounded-xl bg-black/[0.04] px-3 py-3 text-center dark:bg-white/[0.05]"
              >
                <div className="text-lg" aria-hidden>{SECTION_ICON[s.id]}</div>
                <div className="mt-0.5 text-sm font-bold">{s.nameAr}</div>
                <div className="text-[0.68rem] text-[color:var(--app-muted)]">
                  {s.weightPct}%
                  <span className={available === 0 ? 'text-amber-600 dark:text-amber-400' : ''}>
                    {' '}· {available === 0 ? 'لا يوجد' : `${available} سؤال`}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        <Button
          variant="primary"
          size="lg"
          block
          onClick={() => launch(() => startFullExam())}
          disabled={pending || !checkedResume}
        >
          {pending ? '…جارٍ التحضير' : resumable ? 'بدء اختبار جديد' : 'ابدأ الاختبار'}
        </Button>

        <p className="mt-3 text-center text-xs text-[color:var(--app-muted)]">
          ⛶ سيملأ الاختبار الشاشة بالكامل ولن تظهر واجهة الموقع
        </p>
      </Card>

      {/* ---------- practice ---------- */}
      <Card className="animate-fade-up p-6">
        <div className="mb-1 flex flex-wrap items-baseline gap-2">
          <h2 className="text-lg font-bold">تدريب على قسم</h2>
          <Badge>مع الشرح</Badge>
        </div>
        <p className="mb-4 text-sm text-[color:var(--app-muted)]">
          نفس واجهة الاختبار، مع شرح بعد كل سؤال.
        </p>

        <div className="mb-3 flex flex-wrap gap-2">
          {SECTION_LIST.map((s) => {
            const available = pool[s.id] ?? 0;
            return (
              <Pill
                key={s.id}
                active={practiceSection === s.id}
                disabled={available === 0}
                onClick={() => setPracticeSection(s.id)}
                title={available === 0 ? 'لا توجد أسئلة منشورة في هذا القسم' : undefined}
              >
                <span aria-hidden className="ml-1">{SECTION_ICON[s.id]}</span>
                {s.nameAr}
                <span className="mr-1 opacity-60">({available})</span>
              </Pill>
            );
          })}
        </div>

        <div className="mb-4 flex flex-wrap gap-2">
          {PRACTICE_SIZES.map((n) => (
            <Pill
              key={n}
              tone="accent"
              active={practiceSize === n}
              onClick={() => setPracticeSize(n)}
              disabled={practiceAvailable < n}
            >
              {n} أسئلة
            </Pill>
          ))}
        </div>

        <Button
          block
          onClick={() => launch(() => startPractice(practiceSection, practiceSize))}
          disabled={pending || practiceAvailable === 0}
        >
          ابدأ التدريب
        </Button>
      </Card>

      {warnings.length > 0 && (
        <Alert tone="warn">
          <b className="mb-1 block">ملاحظة على المحتوى المتاح</b>
          <ul className="space-y-0.5">{warnings.map((w, i) => <li key={i}>• {w}</li>)}</ul>
        </Alert>
      )}
    </div>
  );
}

