import Link from 'next/link';
import { isSupabaseConfigured } from '@/lib/supabase/server';
import { listBatches } from '@/lib/content/repository';
import { SECTION_LIST } from '@/lib/content/taxonomy';
import { NewBatchForm } from './NewBatchForm';
import { DeleteBatchButton } from './DeleteBatchButton';

export const dynamic = 'force-dynamic';

export default async function AdminHome() {
  if (!isSupabaseConfigured()) {
    return (
      <div className="glass rounded-2xl p-6">
        <h1 className="mb-2 text-xl font-bold">لوحة الإدخال</h1>
        <p className="text-sm text-[color:var(--app-muted)]">
          لم تُضبط متغيّرات Supabase. أضف <code dir="ltr">NEXT_PUBLIC_SUPABASE_URL</code> و{' '}
          <code dir="ltr">SUPABASE_SERVICE_ROLE_KEY</code> في <code dir="ltr">.env.local</code>.
        </p>
      </div>
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
      <section className="glass rounded-2xl p-6">
        <h1 className="text-xl font-bold">لوحة الإدخال</h1>
        <p className="text-sm text-[color:var(--app-muted)]">
          كل إضافة أو تعديل يُحفظ مباشرة في قاعدة البيانات — وهي المصدر الوحيد للمحتوى.
        </p>

        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {SECTION_LIST.map((s) => (
            <div key={s.id} className="rounded-xl bg-black/[0.04] px-3 py-2 text-center dark:bg-white/[0.05]">
              <b className="block text-lg tabular-nums text-[color:var(--app-brand)]">
                {totals.bySection[s.id] ?? 0}
              </b>
              <span className="text-xs text-[color:var(--app-muted)]">{s.nameAr}</span>
            </div>
          ))}
        </div>

        <p className="mt-3 text-xs text-[color:var(--app-muted)]">
          الإجمالي {totals.total} · منشور {totals.published} · مسودة {totals.draft} · للمراجعة {totals.review}
        </p>
      </section>

      <NewBatchForm />

      {error && (
        <p className="glass rounded-2xl px-5 py-4 text-sm text-red-700 dark:text-red-300">{error}</p>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-bold">التجميعات</h2>
        {batches.length === 0 ? (
          <p className="glass rounded-2xl px-5 py-8 text-center text-[color:var(--app-muted)]">
            لا توجد تجميعات بعد. أنشئ واحدة للبدء.
          </p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {batches.map((b) => (
              <li key={b.id} className="glass rounded-2xl p-5">
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

                <div className="mb-2 grid grid-cols-3 gap-1.5 text-center">
                  <Stat label="منشور" value={b.counts.published} tone="emerald" />
                  <Stat label="مسودة" value={b.counts.draft} tone="slate" />
                  <Stat label="مراجعة" value={b.counts.review} tone="amber" />
                </div>

                {b.notes && (
                  <p className="truncate text-xs text-[color:var(--app-muted)]" title={b.notes}>
                    {b.notes}
                  </p>
                )}

                <Link
                  href={`/admin/batch/${b.id}`}
                  className="mt-3 block rounded-xl bg-[color:var(--app-brand)] py-2 text-center text-sm font-bold text-white"
                >
                  فتح المحرر
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  const cls: Record<string, string> = {
    emerald: 'text-emerald-700 dark:text-emerald-300',
    slate: 'text-slate-600 dark:text-slate-300',
    amber: 'text-amber-700 dark:text-amber-300',
  };
  return (
    <div className="rounded-lg bg-black/[0.04] py-1.5 dark:bg-white/[0.05]">
      <b className={`block text-sm tabular-nums ${cls[tone]}`}>{value}</b>
      <span className="text-[0.65rem] text-[color:var(--app-muted)]">{label}</span>
    </div>
  );
}
