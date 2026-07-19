import Link from 'next/link';
import { getProgressOverview } from '@/app/actions/analytics';
import { LevelCard } from '@/components/results/LevelCard';
import { AttemptHistory } from '@/components/results/AttemptHistory';
import { SkillTrendTable } from '@/components/results/SkillTrendTable';

export const dynamic = 'force-dynamic';

export default async function ProgressPage() {
  const res = await getProgressOverview();

  if (!res.ok) {
    return (
      <main className="mx-auto max-w-4xl px-6 py-12">
        <p className="glass rounded-2xl px-5 py-4 text-sm text-red-700 dark:text-red-300">
          تعذّر تحميل التقدم: {res.error}
        </p>
      </main>
    );
  }

  const { attempts, skills, hasTrend } = res.data!;

  if (!attempts.length) {
    return (
      <main className="mx-auto max-w-4xl space-y-5 px-6 py-12">
        <h1 className="text-2xl font-bold text-[color:var(--app-brand)]">تقدّمي</h1>
        <p className="glass rounded-2xl px-5 py-10 text-center text-[color:var(--app-muted)]">
          لم تُكمل أي اختبار بعد. أكمل اختبارًا وستظهر هنا درجتك وتحليل مهاراتك وتطوّرك.
        </p>
        <Link
          href="/exam"
          className="block rounded-xl bg-[color:var(--app-brand)] py-3.5 text-center text-lg font-bold text-white"
        >
          ابدأ اختبارًا
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl space-y-5 px-6 py-12">
      <header className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-2xl font-bold text-[color:var(--app-brand)]">تقدّمي</h1>
        <span className="flex-1" />
        <Link href="/exam" className="text-sm font-semibold text-[color:var(--app-brand)] hover:underline">
          اختبار جديد ←
        </Link>
      </header>

      <LevelCard attempts={attempts} hasTrend={hasTrend} />
      <SkillTrendTable skills={skills} hasTrend={hasTrend} />
      <AttemptHistory attempts={attempts} />
    </main>
  );
}
