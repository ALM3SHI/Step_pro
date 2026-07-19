'use client';

import { useEffect, useState, useTransition } from 'react';
import { ExamRunner, type ResumeState } from '@/components/exam/ExamRunner';
import { rehydrateExam, startFullExam, startPractice } from '@/app/actions/exam';
import {
  abandonAttempt, findResumableAttempt, resumeAttempt, type ResumableSummary,
} from '@/app/actions/attempts';
import { SECTION_LIST, type SectionId } from '@/lib/content/taxonomy';
import type { BuiltExam } from '@/lib/exam/buildExam';

const PRACTICE_SIZES = [5, 10, 20];

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

  // Look for an unfinished sitting on load.
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
            (s) => `${SECTION_LIST.find((x) => x.id === s.section)?.nameAr ?? s.section}: ${s.got} سؤالًا متاحًا من ${s.wanted} مطلوبة`,
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

      // Content is re-fetched by id from the stored skeleton, so the
      // paper is the same one — not a fresh draw from the live pool.
      const rebuilt = await rehydrateExam(saved.payload.skeleton);
      if (!rebuilt.ok || !rebuilt.exam) { setError(rebuilt.error ?? 'تعذّر إعادة بناء الاختبار'); return; }

      if (rebuilt.missing?.length) {
        setWarnings([
          `${rebuilt.missing.length} سؤالًا من هذا الاختبار لم يعد متاحًا وحُذف منه.`,
        ]);
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

  return (
    <div className="mx-auto max-w-3xl space-y-5 px-6 py-12">
      <header>
        <h1 className="text-2xl font-bold text-[color:var(--app-brand)]">محاكي STEP</h1>
        <p className="text-sm text-[color:var(--app-muted)]">
          اختبار كامل مطابق لتوزيع قياس، أو تدريب على قسم واحد.
        </p>
      </header>

      {error && (
        <p className="rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">{error}</p>
      )}

      {/* ---------- resume ---------- */}
      {resumable && (
        <section className="glass rounded-2xl border-r-4 border-r-amber-500 p-6">
          <h2 className="text-lg font-bold">لديك اختبار غير مكتمل</h2>
          <p className="mt-1 text-sm text-[color:var(--app-muted)]">
            {resumable.nameAr} · بدأته{' '}
            {new Date(resumable.startedAt).toLocaleDateString('ar-SA', {
              month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit',
            })}
          </p>
          <p className="mt-1 text-sm">
            أجبت <b className="tabular-nums">{resumable.answered}</b> من{' '}
            <b className="tabular-nums">{resumable.totalQuestions}</b> · وصلت للجزء{' '}
            <b className="tabular-nums">{resumable.partIndex + 1}</b> من {resumable.totalParts}
          </p>

          <p className="mt-3 rounded-xl bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
            ستكمل من بداية الجزء الذي توقفت عنده بمؤقت جديد — الوقت المنقضي في ذلك الجزء لا يُسترجع.
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => continueAttempt(resumable.attemptId)}
              disabled={pending}
              className="rounded-xl bg-[color:var(--app-brand)] px-6 py-2.5 font-bold text-white disabled:opacity-50"
            >
              {pending ? '…جارٍ التحميل' : 'إكمال الاختبار'}
            </button>
            <button
              type="button"
              onClick={() => discardAttempt(resumable.attemptId)}
              disabled={pending}
              className="rounded-xl border border-[color:var(--app-line)] px-4 py-2.5 text-sm font-semibold"
            >
              تجاهل والبدء من جديد
            </button>
          </div>
        </section>
      )}

      {/* ---------- full exam ---------- */}
      <section className="glass rounded-2xl p-6">
        <h2 className="text-lg font-bold">الاختبار الكامل</h2>
        <p className="mb-4 text-sm text-[color:var(--app-muted)]">
          100 سؤال · 120 دقيقة · 4 أقسام × 3 أجزاء
        </p>

        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {SECTION_LIST.map((s) => (
            <div key={s.id} className="rounded-xl bg-black/[0.04] px-3 py-2 text-center dark:bg-white/[0.05]">
              <b className="block text-sm">{s.nameAr}</b>
              <span className="text-xs text-[color:var(--app-muted)]">
                {s.weightPct}% · متاح {pool[s.id] ?? 0}
              </span>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={() => launch(() => startFullExam())}
          disabled={pending || !checkedResume}
          className="w-full rounded-xl bg-[color:var(--app-brand)] py-3.5 text-lg font-bold text-white disabled:opacity-50"
        >
          {pending ? '…جارٍ التحضير' : resumable ? 'بدء اختبار جديد' : 'ابدأ الاختبار'}
        </button>

        <p className="mt-2 text-center text-xs text-[color:var(--app-muted)]">
          سيتم الدخول في وضع الاختبار الكامل ولن تظهر واجهة الموقع.
        </p>
      </section>

      {/* ---------- practice ---------- */}
      <section className="glass rounded-2xl p-6">
        <h2 className="text-lg font-bold">تدريب على قسم</h2>
        <p className="mb-4 text-sm text-[color:var(--app-muted)]">
          نفس واجهة الاختبار، مع شرح بعد كل سؤال.
        </p>

        <div className="mb-3 flex flex-wrap gap-2">
          {SECTION_LIST.map((s) => {
            const available = pool[s.id] ?? 0;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setPracticeSection(s.id)}
                disabled={available === 0}
                className={`rounded-full px-4 py-2 text-sm font-semibold disabled:opacity-40 ${
                  practiceSection === s.id
                    ? 'bg-[color:var(--app-brand)] text-white'
                    : 'border border-[color:var(--app-line)]'
                }`}
                title={available === 0 ? 'لا توجد أسئلة منشورة في هذا القسم' : undefined}
              >
                {s.nameAr} ({available})
              </button>
            );
          })}
        </div>

        <div className="mb-4 flex flex-wrap gap-2">
          {PRACTICE_SIZES.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setPracticeSize(n)}
              disabled={(pool[practiceSection] ?? 0) < n}
              className={`rounded-full px-4 py-1.5 text-sm font-semibold disabled:opacity-40 ${
                practiceSize === n
                  ? 'bg-[color:var(--app-accent)] text-[#221503]'
                  : 'border border-[color:var(--app-line)]'
              }`}
            >
              {n} أسئلة
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => launch(() => startPractice(practiceSection, practiceSize))}
          disabled={pending || (pool[practiceSection] ?? 0) === 0}
          className="w-full rounded-xl border border-[color:var(--app-line)] py-3 font-bold disabled:opacity-40"
        >
          ابدأ التدريب
        </button>
      </section>

      {warnings.length > 0 && (
        <div className="glass rounded-2xl px-5 py-4 text-sm text-amber-700 dark:text-amber-300">
          <b className="mb-1 block">ملاحظة على المحتوى المتاح</b>
          <ul className="space-y-0.5">{warnings.map((w, i) => <li key={i}>• {w}</li>)}</ul>
        </div>
      )}
    </div>
  );
}
