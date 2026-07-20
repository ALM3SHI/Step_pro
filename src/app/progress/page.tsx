import Link from 'next/link';
import { getProgressOverview } from '@/app/actions/analytics';
import { LevelCard } from '@/components/results/LevelCard';
import { AttemptHistory } from '@/components/results/AttemptHistory';
import { SkillTrendTable } from '@/components/results/SkillTrendTable';
import { Alert, Card, EmptyState, PageHeader, linkClass } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function ProgressPage() {
  const res = await getProgressOverview();

  if (!res.ok) {
    return (
      <main className="mx-auto max-w-4xl px-6 py-12">
        <Alert tone="bad">تعذّر تحميل التقدم: {res.error}</Alert>
      </main>
    );
  }

  const { attempts, skills, hasTrend } = res.data!;

  if (!attempts.length) {
    return (
      <main className="mx-auto max-w-4xl space-y-5 px-6 py-12">
        <PageHeader title="تقدّمي" />
        <Card>
          <EmptyState
            icon="📈"
            title="لم تُكمل أي اختبار بعد"
            body="أكمل اختبارًا وستظهر هنا درجتك وتحليل مهاراتك وتطوّرك."
            action={
              <Link href="/exam" className={linkClass({ variant: 'primary', size: 'lg' })}>
                ابدأ اختبارًا
              </Link>
            }
          />
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl space-y-5 px-6 py-12">
      <PageHeader
        title="تقدّمي"
        action={
          <Link href="/exam" className={linkClass({ variant: 'ghost', size: 'sm' })}>
            اختبار جديد ←
          </Link>
        }
      />

      <LevelCard attempts={attempts} hasTrend={hasTrend} />
      <SkillTrendTable skills={skills} hasTrend={hasTrend} />
      <AttemptHistory attempts={attempts} />
    </main>
  );
}
