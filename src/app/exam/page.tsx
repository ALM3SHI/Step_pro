import { ExamLauncher } from './ExamLauncher';
import { getPoolSummary } from '@/app/actions/exam';
import { isSupabaseConfigured } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function ExamPage() {
  const pool = await getPoolSummary();
  // Decided on the server: the simulator runs from the content bundle
  // either way, and attempting to persist without keys just produces a
  // failed round trip and a misleading "لم يُحفظ" badge.
  return <ExamLauncher pool={pool} persist={isSupabaseConfigured()} />;
}
