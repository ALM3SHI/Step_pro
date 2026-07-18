import { createServiceClient, isSupabaseConfigured } from '@/lib/supabase/server';
import { HistoryGrid } from './HistoryGrid';
import type { BatchSummary } from '@/components/admin/BatchCard';

export const dynamic = 'force-dynamic';

export default async function HistoryPage() {
  // Degrade to an explanation rather than a 500 when the keys are absent
  // (a fresh clone, or a preview deploy without env vars).
  if (!isSupabaseConfigured()) {
    return (
      <div className="glass rounded-2xl p-6">
        <h1 className="mb-2 text-xl font-bold">سجل التسليمات</h1>
        <p className="text-sm text-[color:var(--app-muted)]">
          لم تُضبط متغيّرات Supabase بعد. أضف{' '}
          <code dir="ltr">NEXT_PUBLIC_SUPABASE_URL</code> و{' '}
          <code dir="ltr">SUPABASE_SERVICE_ROLE_KEY</code> في{' '}
          <code dir="ltr">.env.local</code> أو في إعدادات Vercel.
        </p>
        <p className="mt-2 text-xs text-[color:var(--app-muted)]">
          محاكي الاختبار يعمل بدونها — فهو يقرأ من حزمة المحتوى مباشرة.
        </p>
      </div>
    );
  }

  const db = createServiceClient();
  const { data, error } = await db
    .from('ingestion_batch_overview')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    return (
      <p className="glass rounded-2xl px-5 py-4 text-red-700 dark:text-red-300">
        تعذّر تحميل السجل: {error.message}
      </p>
    );
  }

  const batches = (data ?? []) as BatchSummary[];
  const totalQuestions = batches.reduce((n, b) => n + (b.live_questions ?? 0), 0);

  return (
    <div className="space-y-6">
      <div className="glass rounded-2xl p-6">
        <h1 className="text-xl font-bold">سجل التسليمات</h1>
        <p className="text-sm text-[color:var(--app-muted)]">
          {batches.length} تسليمة · {totalQuestions} سؤالًا نشطًا
        </p>
      </div>

      {batches.length === 0 ? (
        <p className="glass rounded-2xl px-5 py-8 text-center text-[color:var(--app-muted)]">
          لا توجد تسليمات بعد.
        </p>
      ) : (
        <HistoryGrid initial={batches} />
      )}
    </div>
  );
}
