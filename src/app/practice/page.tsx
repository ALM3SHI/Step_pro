import { getSkillAvailability, getWeakestSkills } from '@/app/actions/practice';
import { PracticeLauncher } from './PracticeLauncher';
import { Alert } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function PracticePage() {
  const availability = await getSkillAvailability();

  if (!availability.ok) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-12">
        <Alert tone="bad">تعذّر تحميل بنك الأسئلة: {availability.error}</Alert>
      </main>
    );
  }

  /**
   * A missing progress history is not a failure here.
   *
   * The weakest-skill mode simply stays disabled with its reason shown;
   * the rest of the page must still work for a learner who has never
   * sat an exam.
   */
  const weak = await getWeakestSkills();

  return (
    <PracticeLauncher
      availability={availability.skills ?? []}
      bySection={availability.bySection ?? {}}
      weakest={weak.skills ?? []}
      weakestReason={weak.reason ?? weak.error}
    />
  );
}
