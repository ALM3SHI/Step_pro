'use client';

import { useState, useTransition } from 'react';
import { ExamRunner } from '@/components/exam/ExamRunner';
import { startFullExam, startPractice } from '@/app/actions/exam';
import { SECTION_LIST, type SectionId } from '@/lib/content/taxonomy';
import type { BuiltExam } from '@/lib/exam/buildExam';

const PRACTICE_SIZES = [5, 10, 20];

/**
 * Entry point for both modes.
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
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [practiceSection, setPracticeSection] = useState<SectionId>('grammar');
  const [practiceSize, setPracticeSize] = useState(10);
  const [pending, start] = useTransition();

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
      setExam(res.exam);
    });
  };

  if (exam) return <ExamRunner exam={exam} persist={persist} onExit={() => setExam(null)} />;

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
          disabled={pending}
          className="w-full rounded-xl bg-[color:var(--app-brand)] py-3.5 text-lg font-bold text-white disabled:opacity-50"
        >
          {pending ? '…جارٍ التحضير' : 'ابدأ الاختبار'}
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
