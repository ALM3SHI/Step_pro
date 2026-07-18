'use client';

import { useState, useTransition } from 'react';
import { deleteBatch } from '@/app/admin/actions';

export interface BatchSummary {
  id: string;
  batch_title: string;
  status: string;
  created_at: string;
  live_questions: number;
  grammar_count: number;
  reading_count: number;
  listening_count: number;
  total_questions_saved: number;
  source_metadata: { notes?: string } | null;
}

const STATUS_STYLE: Record<string, string> = {
  completed: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  review: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  processing: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  failed: 'bg-red-500/15 text-red-700 dark:text-red-300',
  pending: 'bg-slate-500/15 text-slate-600 dark:text-slate-300',
};

/**
 * A batch widget with cascade delete.
 *
 * The confirmation requires typing the question count rather than a bare
 * "are you sure": this button destroys hundreds of rows irreversibly, and
 * a single mis-click on the wrong card is otherwise unrecoverable.
 */
export function BatchCard({ batch, onDeleted }: { batch: BatchSummary; onDeleted: (id: string) => void }) {
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const expected = String(batch.live_questions);
  const canDelete = typed.trim() === expected;

  const doDelete = () => {
    setError(null);
    startTransition(async () => {
      const res = await deleteBatch(batch.id);
      if (res.ok) onDeleted(batch.id);
      else setError(res.error ?? 'Delete failed');
    });
  };

  const date = new Date(batch.created_at).toLocaleDateString('ar-SA', {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  return (
    <article className="glass relative rounded-2xl p-5">
      <header className="mb-3 flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[1.05rem] font-bold" title={batch.batch_title}>{batch.batch_title}</h3>
          <p className="mt-0.5 text-xs text-[color:var(--app-muted)]">{date}</p>
        </div>

        <span className={`rounded-full px-3 py-0.5 text-xs font-bold ${STATUS_STYLE[batch.status] ?? ''}`}>
          {batch.status}
        </span>

        <button
          type="button"
          onClick={() => { setConfirming(true); setTyped(''); }}
          disabled={pending}
          aria-label={`حذف التسليمة ${batch.batch_title}`}
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-lg font-bold text-red-600 transition-colors hover:bg-red-500/15 disabled:opacity-40"
        >
          ✕
        </button>
      </header>

      <div className="mb-3 grid grid-cols-4 gap-2 text-center">
        {[
          ['الإجمالي', batch.live_questions],
          ['قواعد', batch.grammar_count],
          ['قراءة', batch.reading_count],
          ['استماع', batch.listening_count],
        ].map(([label, value]) => (
          <div key={label as string} className="rounded-xl bg-black/[0.04] px-2 py-2 dark:bg-white/[0.05]">
            <b className="block text-lg tabular-nums text-[color:var(--app-brand)]">{value as number}</b>
            <span className="text-[0.7rem] text-[color:var(--app-muted)]">{label as string}</span>
          </div>
        ))}
      </div>

      {batch.source_metadata?.notes && (
        <p className="truncate text-xs text-[color:var(--app-muted)]" title={batch.source_metadata.notes}>
          {batch.source_metadata.notes}
        </p>
      )}

      {confirming && (
        <div className="absolute inset-0 z-10 flex flex-col justify-center gap-3 rounded-2xl bg-[color:var(--app-surface)]/95 p-5 backdrop-blur">
          <p className="text-sm font-bold text-red-600">
            سيتم حذف التسليمة و {batch.live_questions} سؤالًا نهائيًا.
          </p>
          <p className="text-xs text-[color:var(--app-muted)]">
            لا يمكن التراجع. اكتب <b className="tabular-nums">{expected}</b> للتأكيد:
          </p>

          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            inputMode="numeric"
            autoFocus
            className="rounded-lg border border-[color:var(--app-line)] bg-transparent px-3 py-2 text-center tabular-nums"
          />

          {error && <p className="text-xs text-red-600">{error}</p>}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={doDelete}
              disabled={!canDelete || pending}
              className="flex-1 rounded-lg bg-red-600 py-2 text-sm font-bold text-white disabled:opacity-40"
            >
              {pending ? '…جارٍ الحذف' : 'حذف نهائيًا'}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={pending}
              className="flex-1 rounded-lg border border-[color:var(--app-line)] py-2 text-sm font-semibold"
            >
              إلغاء
            </button>
          </div>
        </div>
      )}
    </article>
  );
}
