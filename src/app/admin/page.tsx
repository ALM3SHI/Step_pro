'use client';

import { useState, useTransition } from 'react';
import { approveBatch, processRawText, type ProcessResult, type StagedQuestion } from './actions';
import { QuickReviewCard } from '@/components/admin/QuickReviewCard';

type Filter = 'all' | 'flagged';

export default function IngestPage() {
  const [result, setResult] = useState<ProcessResult | null>(null);
  const [staged, setStaged] = useState<StagedQuestion[]>([]);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<Filter>('all');
  const [saved, setSaved] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (formData: FormData) => {
    setSaved(null);
    startTransition(async () => {
      const res = await processRawText(formData);
      setResult(res);
      setStaged(res.staged);
      // Pre-exclude nothing: flagged items are still probably right, and
      // defaulting them off would quietly drop most of a messy batch.
      setExcluded(new Set());
    });
  };

  const commit = () => {
    if (!result?.batchId) return;
    const keep = staged.filter((q) => !excluded.has(q.ref));
    startTransition(async () => {
      const res = await approveBatch(result.batchId!, keep, result.passages);
      if (res.ok) { setSaved(res.saved ?? 0); setResult(null); setStaged([]); }
      else alert(res.error);
    });
  };

  const flaggedCount = staged.filter((q) => q.needsHumanReview).length;
  const visible = filter === 'flagged' ? staged.filter((q) => q.needsHumanReview) : staged;
  const keepCount = staged.length - excluded.size;

  return (
    <div className="space-y-6">
      {/* ---------- ingestion form ---------- */}
      {!staged.length && (
        <form action={run} className="glass space-y-4 rounded-2xl p-6">
          <div>
            <h1 className="text-xl font-bold">تسليمة جديدة</h1>
            <p className="text-sm text-[color:var(--app-muted)]">
              الصق النص الخام من ملفات التجميعات. سيتم التنظيف وإزالة التكرار والحل تلقائيًا.
            </p>
          </div>

          <label className="block">
            <span className="mb-1 block text-sm font-semibold">عنوان التسليمة</span>
            <input
              name="batchTitle"
              required
              placeholder="تجميعات شهر يوليو — المصدر X"
              className="w-full rounded-xl border border-[color:var(--app-line)] bg-transparent px-4 py-2.5"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-semibold">ملاحظات المصدر</span>
            <input
              name="sourceNotes"
              placeholder="أكاديمية فلان — ملف PDF مجاني"
              className="w-full rounded-xl border border-[color:var(--app-line)] bg-transparent px-4 py-2.5"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-semibold">النص الخام</span>
            <textarea
              name="rawText"
              required
              rows={14}
              dir="ltr"
              placeholder="Paste the raw text here…"
              className="w-full rounded-xl border border-[color:var(--app-line)] bg-transparent p-4 text-left font-mono text-sm"
            />
          </label>

          <button
            type="submit"
            disabled={pending}
            className="rounded-xl bg-[color:var(--app-brand)] px-7 py-3 font-bold text-white disabled:opacity-50"
          >
            {pending ? '…جارٍ المعالجة' : 'ابدأ المعالجة'}
          </button>

          {result && !result.ok && (
            <p className="rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">{result.error}</p>
          )}
        </form>
      )}

      {saved !== null && (
        <p className="glass rounded-2xl px-5 py-4 text-emerald-700 dark:text-emerald-300">
          ✓ تم حفظ {saved} سؤالًا بنجاح.
        </p>
      )}

      {/* ---------- quick review staging ---------- */}
      {staged.length > 0 && result?.ok && (
        <>
          <div className="glass sticky top-24 z-30 flex flex-wrap items-center gap-3 rounded-2xl p-4">
            <div className="text-sm">
              <b className="text-lg tabular-nums text-[color:var(--app-brand)]">{keepCount}</b> جاهز للحفظ
              {flaggedCount > 0 && (
                <span className="mr-2 text-amber-700 dark:text-amber-300">· {flaggedCount} بحاجة لمراجعة</span>
              )}
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setFilter('all')}
                className={`rounded-full px-4 py-1.5 text-sm font-semibold ${filter === 'all' ? 'bg-[color:var(--app-brand)] text-white' : 'border border-[color:var(--app-line)]'}`}
              >
                الكل ({staged.length})
              </button>
              <button
                type="button"
                onClick={() => setFilter('flagged')}
                disabled={!flaggedCount}
                className={`rounded-full px-4 py-1.5 text-sm font-semibold disabled:opacity-40 ${filter === 'flagged' ? 'bg-amber-600 text-white' : 'border border-[color:var(--app-line)]'}`}
              >
                للمراجعة ({flaggedCount})
              </button>
            </div>

            <span className="flex-1" />

            <button
              type="button"
              onClick={commit}
              disabled={pending || !keepCount}
              className="rounded-xl bg-emerald-600 px-6 py-2.5 font-bold text-white disabled:opacity-50"
            >
              {pending ? '…جارٍ الحفظ' : `اعتماد وحفظ (${keepCount})`}
            </button>
          </div>

          <details className="glass rounded-2xl p-4 text-sm">
            <summary className="cursor-pointer font-semibold">إحصائيات المعالجة</summary>
            <pre dir="ltr" className="mt-3 overflow-x-auto text-left text-xs">
              {JSON.stringify(result.stats, null, 2)}
            </pre>
          </details>

          <div className="space-y-4">
            {visible.map((q) => (
              <QuickReviewCard
                key={q.ref}
                index={staged.indexOf(q)}
                question={q}
                included={!excluded.has(q.ref)}
                onToggle={() =>
                  setExcluded((prev) => {
                    const next = new Set(prev);
                    if (next.has(q.ref)) next.delete(q.ref);
                    else next.add(q.ref);
                    return next;
                  })
                }
                onEdit={(patch) =>
                  setStaged((prev) => prev.map((x) => (x.ref === q.ref ? { ...x, ...patch } : x)))
                }
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
