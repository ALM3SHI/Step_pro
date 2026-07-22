import Link from 'next/link';
import { isSupabaseConfigured } from '@/lib/supabase/server';
import { listBatchHistory } from '@/app/actions/ingestion';
import { SECTION_DEFS, type SectionId } from '@/lib/content/taxonomy';
import { Alert, Badge, Card, EmptyState, SectionTitle, Stat, linkClass } from '@/components/ui';

export const dynamic = 'force-dynamic';

const STATUS_TONE: Record<string, 'good' | 'warn' | 'bad' | 'brand'> = {
  completed: 'good',
  processing: 'warn',
  failed: 'bad',
};

const STATUS_LABEL: Record<string, string> = {
  completed: 'مكتملة',
  processing: 'قيد المعالجة',
  failed: 'فشلت',
};

/**
 * The import audit trail.
 *
 * Restored alongside the importers: without it, a paste that silently
 * dropped half its questions to deduplication leaves no record of having
 * happened, and the only way to notice is to count the bank by hand.
 */
export default async function HistoryPage() {
  // Degrade to an explanation rather than a 500 when the keys are absent
  // (a fresh clone, or a preview deploy without env vars).
  if (!isSupabaseConfigured()) {
    return (
      <Card className="p-6">
        <SectionTitle>سجل التسليمات</SectionTitle>
        <Alert tone="warn">
          لم تُضبط متغيّرات Supabase بعد. أضف <code dir="ltr">NEXT_PUBLIC_SUPABASE_URL</code> و{' '}
          <code dir="ltr">SUPABASE_SERVICE_ROLE_KEY</code> في <code dir="ltr">.env.local</code>.
        </Alert>
      </Card>
    );
  }

  const res = await listBatchHistory();
  if (!res.ok) {
    return <Alert tone="bad">تعذّر تحميل السجل: {res.error}</Alert>;
  }

  const rows = res.rows ?? [];
  const totals = rows.reduce(
    (acc, r) => {
      acc.saved += r.saved;
      acc.duplicates += r.duplicates;
      if (r.status === 'failed') acc.failed++;
      return acc;
    },
    { saved: 0, duplicates: 0, failed: 0 },
  );

  return (
    <div className="space-y-5">
      <Card className="p-6">
        <SectionTitle hint="كل عملية استيراد وما نتج عنها فعلًا — لا ما طُلب منها.">
          سجل التسليمات
        </SectionTitle>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="التسليمات" value={rows.length} />
          <Stat label="أسئلة محفوظة" value={totals.saved} tone="good" />
          <Stat label="مكررة (مُتجاهَلة)" value={totals.duplicates} />
          <Stat label="فشلت" value={totals.failed} tone={totals.failed ? 'bad' : undefined} />
        </div>
      </Card>

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            icon="📜"
            title="لا توجد تسليمات بعد"
            body="ابدأ من صفحة الاستيراد."
          />
        </Card>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => {
            const section = r.category ? SECTION_DEFS[r.category as SectionId] : undefined;
            // Parsed but not saved is the number worth surfacing: it is
            // almost always deduplication, and almost always a surprise.
            const dropped = r.parsed - r.saved;

            return (
              <Card key={r.id} as="li" className="p-5">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <h3 className="font-bold">{r.title}</h3>
                  <Badge tone={STATUS_TONE[r.status] ?? 'brand'}>
                    {STATUS_LABEL[r.status] ?? r.status}
                  </Badge>
                  {section && (
                    <span className="text-xs text-[color:var(--app-muted)]">{section.nameAr}</span>
                  )}
                  <span className="flex-1" />
                  <span className="text-xs text-[color:var(--app-muted)]">
                    {new Date(r.createdAt).toLocaleString('ar-SA', {
                      year: 'numeric', month: 'short', day: 'numeric',
                      hour: '2-digit', minute: '2-digit',
                    })}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Stat label="مُحلَّلة" value={r.parsed} />
                  <Stat label="محفوظة" value={r.saved} tone="good" />
                  <Stat label="مكررة" value={r.duplicates} />
                  <Stat
                    label="لم تُحفظ"
                    value={dropped > 0 ? dropped : 0}
                    tone={dropped > 0 ? 'warn' : undefined}
                  />
                </div>

                {r.notes && (
                  <p className="mt-2 text-xs text-[color:var(--app-muted)]">{r.notes}</p>
                )}

                {r.errorMessage && (
                  <Alert tone="bad">
                    <span dir="ltr" className="block text-left font-mono text-xs">
                      {r.errorMessage}
                    </span>
                  </Alert>
                )}

                <Link
                  href={`/admin/batch/${r.id}`}
                  className={linkClass({ size: 'sm', className: 'mt-3 inline-block' })}
                >
                  فتح المحرر
                </Link>
              </Card>
            );
          })}
        </ul>
      )}
    </div>
  );
}
