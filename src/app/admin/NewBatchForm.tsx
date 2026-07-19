'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { createBatchAction } from '@/app/actions/content';

export function NewBatchForm() {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  const create = () => {
    setError(null);
    start(async () => {
      const res = await createBatchAction(title, notes);
      if (!res.ok || !res.data) { setError(res.error ?? 'فشل الإنشاء'); return; }
      // Straight into the editor — creating an empty batch is never the
      // goal, adding questions to it is.
      router.push(`/admin/batch/${res.data.id}`);
    });
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="glass w-full rounded-2xl py-4 text-sm font-bold text-[color:var(--app-brand)]"
      >
        + تجميعة جديدة
      </button>
    );
  }

  return (
    <section className="glass space-y-3 rounded-2xl p-5">
      <h2 className="font-bold">تجميعة جديدة</h2>

      <label className="block">
        <span className="mb-1 block text-xs font-semibold">
          العنوان <span className="text-red-500">*</span>
        </span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && title.trim()) create(); }}
          placeholder="تجميعات يوليو — المصدر X"
          autoFocus
          className="w-full rounded-lg border border-[color:var(--app-line)] bg-transparent px-3 py-2 text-sm"
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-xs font-semibold">ملاحظات المصدر</span>
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="أكاديمية فلان — ملف PDF"
          className="w-full rounded-lg border border-[color:var(--app-line)] bg-transparent px-3 py-2 text-sm"
        />
      </label>

      {error && <p className="text-xs text-red-600">{error}</p>}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={create}
          disabled={pending || !title.trim()}
          className="rounded-xl bg-[color:var(--app-brand)] px-5 py-2 text-sm font-bold text-white disabled:opacity-50"
        >
          {pending ? '…جارٍ الإنشاء' : 'إنشاء وفتح المحرر'}
        </button>
        <button
          type="button"
          onClick={() => { setOpen(false); setError(null); }}
          className="rounded-xl border border-[color:var(--app-line)] px-4 py-2 text-sm font-semibold"
        >
          إلغاء
        </button>
      </div>
    </section>
  );
}
