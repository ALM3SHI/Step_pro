'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { deleteBatchAction } from '@/app/actions/content';
import { Button, inputClass } from '@/components/ui';

/**
 * Cascade delete.
 *
 * Confirmation requires typing the question count rather than clicking
 * "yes": this destroys every question in the batch irreversibly, and a
 * single mis-click on the wrong card is unrecoverable.
 */
export function DeleteBatchButton({
  batchId, title, count,
}: {
  batchId: string;
  title: string;
  count: number;
}) {
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  const expected = String(count);

  const doDelete = () => {
    setError(null);
    start(async () => {
      const res = await deleteBatchAction(batchId);
      if (!res.ok) { setError(res.error ?? 'فشل الحذف'); return; }
      setConfirming(false);
      router.refresh();
    });
  };

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => { setConfirming(true); setTyped(''); }}
        aria-label={`حذف ${title}`}
        className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-red-600 hover:bg-red-500/15"
      >
        ✕
      </button>
    );
  }

  return (
    <div className="absolute inset-0 z-10 flex flex-col justify-center gap-2 rounded-2xl bg-[color:var(--app-surface)]/95 p-4 backdrop-blur">
      <p className="text-sm font-bold text-red-600">
        حذف «{title}» و{count} سؤالًا نهائيًا؟
      </p>
      <p className="text-xs text-[color:var(--app-muted)]">
        اكتب <b className="tabular-nums">{expected}</b> للتأكيد:
      </p>
      <input
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        inputMode="numeric"
        autoFocus
        className={inputClass({ className: 'text-center tabular-nums' })}
      />
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <Button
          variant="danger"
          size="sm"
          className="flex-1"
          onClick={doDelete}
          disabled={typed.trim() !== expected || pending}
        >
          {pending ? '…' : 'حذف'}
        </Button>
        <Button size="sm" className="flex-1" onClick={() => setConfirming(false)}>
          إلغاء
        </Button>
      </div>
    </div>
  );
}
