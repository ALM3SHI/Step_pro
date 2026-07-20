import Link from 'next/link';
import { isSupabaseConfigured } from '@/lib/supabase/server';
import { listBatches } from '@/lib/content/repository';
import { SECTION_LIST } from '@/lib/content/taxonomy';
import { NewBatchForm } from './NewBatchForm';
import { DeleteBatchButton } from './DeleteBatchButton';
import { Alert, Card, EmptyState, SectionTitle, Stat, linkClass } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function AdminHome() {
  if (!isSupabaseConfigured()) {
    return (
      <Card className="p-6">
        <SectionTitle>لوحة الإدخال</SectionTitle>
        <Alert tone="warn">
          لم تُضبط متغيّرات Supabase. أضف <code dir="ltr">NEXT_PUBLIC_SUPABASE_URL</code> و{' '}
          <code dir="ltr">SUPABASE_SERVICE_ROLE_KEY</code> في <code dir="ltr">.env.local</code>.
        </Alert>
      </Card>
    );
  }

  let batches: Awaited<ReturnType<typeof listBatches>> = [];
  let error: string | null = null;
  try {
    batches = await listBatches();
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  const totals = batches.reduce(
    (acc, b) => {
      acc.total += b.counts.total;
      acc.published += b.counts.published;
      acc.draft += b.counts.draft;
      acc.review += b.counts.review;
      for (const [sec, n] of Object.entries(b.counts.bySection)) {
        acc.bySection[sec] = (acc.bySection[sec] ?? 0) + n;
      }
      return acc;
    },
    { total: 0, published: 0, draft: 0, review: 0, bySection: {} as Record<string, number> },
  );

  return (
    <div className="space-y-5">
      <Card className="p-6">
        <SectionTitle hint="كل إضافة أو تعديل يُحفظ مباشرة في قاعدة البيانات — وهي المصدر الوحيد للمحتوى.">
          لوحة الإدخال
        </SectionTitle>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {SECTION_LIST.map((s) => (
            <Stat key={s.id} label={s.nameAr} value={totals.bySection[s.id] ?? 0} />
          ))}
        </div>

        <p className="mt-3 text-xs text-[color:var(--app-muted)]">
          الإجمالي {totals.total} · منشور {totals.published} · مسودة {totals.draft} · للمراجعة {totals.review}
        </p>
      </Card>

      <NewBatchForm />

      {error && <Alert tone="bad">{error}</Alert>}

      <section className="space-y-3">
        <h2 className="text-lg font-bold">التجميعات</h2>
        {batches.length === 0 ? (
          <Card>
            <EmptyState icon="📦" title="لا توجد تجميعات بعد" body="أنشئ واحدة للبدء." />
          </Card>
        ) : (
          <ul className="stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {batches.map((b) => (
              <Card key={b.id} as="li" interactive className="p-5">
                <div className="mb-2 flex items-start gap-2">
                  <Link href={`/admin/batch/${b.id}`} className="min-w-0 flex-1">
                    <h3 className="truncate font-bold hover:underline" title={b.title}>{b.title}</h3>
                    <p className="mt-0.5 text-xs text-[color:var(--app-muted)]">
                      {new Date(b.createdAt).toLocaleDateString('ar-SA', {
                        year: 'numeric', month: 'long', day: 'numeric',
                      })}
                    </p>
                  </Link>
                  <DeleteBatchButton batchId={b.id} title={b.title} count={b.counts.total} />
                </div>

                <div className="mb-2 grid grid-cols-3 gap-1.5">
                  <Stat label="منشور" value={b.counts.published} tone="good" />
                  <Stat label="مسودة" value={b.counts.draft} />
                  <Stat label="مراجعة" value={b.counts.review} tone="warn" />
                </div>

                {b.notes && (
                  <p className="truncate text-xs text-[color:var(--app-muted)]" title={b.notes}>
                    {b.notes}
                  </p>
                )}

                <Link
                  href={`/admin/batch/${b.id}`}
                  className={linkClass({ variant: 'primary', size: 'sm', block: true, className: 'mt-3' })}
                >
                  فتح المحرر
                </Link>
              </Card>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
