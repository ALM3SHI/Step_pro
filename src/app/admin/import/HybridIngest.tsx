'use client';

import { useCallback, useMemo, useState, useTransition } from 'react';
import { FastKeyPanel } from '@/components/admin/FastKeyPanel';
import { ManualKeyCard, type ManualKeyQuestion } from '@/components/admin/ManualKeyCard';
import { runPipeline } from '@/lib/ingestion/pipeline';
import { saveHybridBatch, type SaveCategory, type SaveQuestion } from '@/app/actions/ingestion';
import type { OptionKey } from '@/lib/ingestion/fastkey';

export type IngestMode = 'hybrid' | 'api';

import { SAVE_CHUNK } from '@/lib/ingestion/constants';

const CATEGORIES: Array<[SaveCategory, string]> = [
  ['grammar', 'القواعد والتراكيب'],
  ['reading', 'فهم المقروء'],
  ['writing', 'التحليل الكتابي'],
];

/**
 * Hybrid ingestion workspace.
 *
 * Parsing runs IN THE BROWSER via the same pipeline the server uses — no
 * API key, no network, no cost. Only the final approved batch is sent to
 * the server, so the paste/parse/key loop stays instant.
 */
export function HybridIngest({ mode }: { mode: IngestMode }) {
  const [raw, setRaw] = useState('');
  const [staged, setStaged] = useState<ManualKeyQuestion[]>([]);
  const [passages, setPassages] = useState<Array<{ title?: string; body: string; contentHash: string }>>([]);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [stats, setStats] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'unset'>('all');

  const [batchTitle, setBatchTitle] = useState('');
  const [sourceNotes, setSourceNotes] = useState('');
  const [category, setCategory] = useState<SaveCategory>('grammar');
  const [saveMsg, setSaveMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [saving, startSave] = useTransition();

  const parse = () => {
    setError(null);
    const result = runPipeline(raw);

    if (!result.questions.length) {
      setError(`لم يُستخرج أي سؤال. رُفض ${result.rejected.length} مقطع — تحقّق من التنسيق.`);
      setStaged([]);
      return;
    }

    setStaged(
      result.questions.map((q, i) => ({
        ref: `q${i}`,
        questionText: q.questionText,
        options: q.options,
      })),
    );
    setPassages(result.passages);
    setStats(result.stats as unknown as Record<string, unknown>);
    setExcluded(new Set());
  };

  /** Bulk-apply Fast-Key results. One state write, not one per card. */
  const applyFastKeys = useCallback(
    (updates: Array<{ ref: string; option: OptionKey; explanation?: string }>) => {
      const byRef = new Map(updates.map((u) => [u.ref, u]));
      setStaged((prev) =>
        prev.map((q) => {
          const u = byRef.get(q.ref);
          if (!u) return q;
          return {
            ...q,
            correctOption: u.option,
            // Never overwrite an explanation a human already typed.
            explanationAr: q.explanationAr?.trim() ? q.explanationAr : u.explanation,
            source: 'fastkey' as const,
          };
        }),
      );
    },
    [],
  );

  const setOption = useCallback((ref: string, option: OptionKey) => {
    setStaged((prev) =>
      prev.map((q) => (q.ref === ref ? { ...q, correctOption: option, source: 'manual' as const } : q)),
    );
  }, []);

  const setExplanation = useCallback((ref: string, text: string) => {
    setStaged((prev) => prev.map((q) => (q.ref === ref ? { ...q, explanationAr: text } : q)));
  }, []);

  const toggleInclude = useCallback((ref: string) => {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(ref)) next.delete(ref);
      else next.add(ref);
      return next;
    });
  }, []);

  const unsetCount = useMemo(() => staged.filter((q) => !q.correctOption).length, [staged]);
  const visible = filter === 'unset' ? staged.filter((q) => !q.correctOption) : staged;
  const readyQuestions = useMemo(
    () => staged.filter((q) => !excluded.has(q.ref) && q.correctOption),
    [staged, excluded],
  );
  const keepCount = readyQuestions.length;

  /**
   * Save in chunks.
   *
   * All chunks after the first append to the SAME batch id, so a
   * 300-question paste stays one batch in the history and one click on
   * "delete batch" still removes all of it.
   */
  const save = () => {
    setSaveMsg(null);
    startSave(async () => {
      const payload: SaveQuestion[] = readyQuestions.map((q) => ({
        ref: q.ref,
        questionText: q.questionText,
        options: q.options,
        correctOption: q.correctOption!,
        explanationAr: q.explanationAr,
      }));

      let batchId: string | undefined;
      let inserted = 0;
      let duplicates = 0;

      for (let i = 0; i < payload.length; i += SAVE_CHUNK) {
        const chunk = payload.slice(i, i + SAVE_CHUNK);
        setProgress(`${Math.min(i + chunk.length, payload.length)} / ${payload.length}`);

        const res = await saveHybridBatch({
          batchTitle,
          sourceNotes,
          category,
          questions: chunk,
          passages: category === 'reading' ? passages.map((p) => ({ title: p.title, body: p.body })) : undefined,
          existingBatchId: batchId,
        });

        if (!res.ok) {
          setProgress(null);
          setSaveMsg({
            tone: 'err',
            text: inserted > 0
              ? `${res.error} — حُفظ ${inserted} سؤال قبل التوقف.`
              : res.error ?? 'فشل الحفظ',
          });
          return;
        }

        batchId = res.batchId;
        inserted += res.inserted ?? 0;
        duplicates += res.duplicates ?? 0;
      }

      setProgress(null);
      setSaveMsg({
        tone: 'ok',
        text: `✓ حُفظ ${inserted} سؤال${duplicates ? ` · تم تجاهل ${duplicates} مكرر` : ''}`,
      });
      setStaged([]);
      setRaw('');
      setBatchTitle('');
    });
  };

  if (mode === 'api') {
    return (
      <section className="glass rounded-2xl p-8 text-center">
        <h2 className="mb-2 text-lg font-bold">الوضع الآلي الكامل</h2>
        <p className="text-sm text-[color:var(--app-muted)]">
          يستخدم محوّل Gemini / OpenAI مع التصويت الذاتي. يتطلّب ضبط مفتاح API في البيئة.
        </p>
        <a
          href="/admin"
          className="mt-4 inline-block rounded-xl bg-[color:var(--app-brand)] px-6 py-2.5 font-bold text-white"
        >
          الانتقال إلى المعالجة الآلية
        </a>
      </section>
    );
  }

  return (
    <div className="space-y-5">
      {!staged.length ? (
        <section className="glass space-y-4 rounded-2xl p-6">
          <div>
            <h2 className="text-lg font-bold">١ · الصق الأسئلة الخام</h2>
            <p className="text-sm text-[color:var(--app-muted)]">
              يتم التنظيف والتقطيع محليًا في المتصفح — بلا تكلفة وبلا انتظار.
            </p>
          </div>

          <textarea
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            rows={14}
            dir="ltr"
            placeholder="Paste the raw text here…"
            className="w-full rounded-xl border border-[color:var(--app-line)] bg-transparent p-4 text-left font-mono text-sm"
          />

          <button
            type="button"
            onClick={parse}
            disabled={raw.trim().length < 20}
            className="rounded-xl bg-[color:var(--app-brand)] px-7 py-3 font-bold text-white disabled:opacity-40"
          >
            تحليل وتقطيع الأسئلة
          </button>

          {error && (
            <p className="rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">{error}</p>
          )}
        </section>
      ) : (
        <>
          <FastKeyPanel questions={staged} onApply={applyFastKeys} />

          <div className="glass sticky top-24 z-30 flex flex-wrap items-center gap-3 rounded-2xl p-4">
            <span className="text-sm">
              <b className="text-lg tabular-nums text-[color:var(--app-brand)]">{keepCount}</b> جاهز
              {unsetCount > 0 && (
                <span className="mr-2 text-amber-700 dark:text-amber-300">· {unsetCount} بلا إجابة</span>
              )}
            </span>

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
                onClick={() => setFilter('unset')}
                disabled={!unsetCount}
                className={`rounded-full px-4 py-1.5 text-sm font-semibold disabled:opacity-40 ${filter === 'unset' ? 'bg-amber-600 text-white' : 'border border-[color:var(--app-line)]'}`}
              >
                بلا إجابة ({unsetCount})
              </button>
            </div>

            <span className="flex-1" />

            <button
              type="button"
              onClick={() => { setStaged([]); setRaw(''); }}
              className="rounded-xl border border-[color:var(--app-line)] px-4 py-2 text-sm font-semibold"
            >
              إعادة البدء
            </button>

            <button
              type="button"
              onClick={save}
              disabled={!keepCount || saving || !batchTitle.trim()}
              className="rounded-xl bg-emerald-600 px-6 py-2.5 font-bold text-white disabled:opacity-40"
              title={
                !batchTitle.trim() ? 'أدخل عنوان التسليمة أولًا'
                  : unsetCount ? `${unsetCount} سؤال بلا إجابة لن يُحفظ`
                  : undefined
              }
            >
              {saving ? `…جارٍ الحفظ ${progress ?? ''}` : `اعتماد وحفظ (${keepCount})`}
            </button>
          </div>

          {/* Batch metadata — required before saving. */}
          <section className="glass grid gap-3 rounded-2xl p-5 sm:grid-cols-3">
            <label className="block sm:col-span-1">
              <span className="mb-1 block text-sm font-semibold">القسم</span>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as SaveCategory)}
                className="w-full rounded-xl border border-[color:var(--app-line)] bg-transparent px-3 py-2.5"
              >
                {CATEGORIES.map(([v, label]) => (
                  <option key={v} value={v}>{label}</option>
                ))}
              </select>
            </label>

            <label className="block sm:col-span-1">
              <span className="mb-1 block text-sm font-semibold">
                عنوان التسليمة <span className="text-red-500">*</span>
              </span>
              <input
                value={batchTitle}
                onChange={(e) => setBatchTitle(e.target.value)}
                placeholder="تجميعات يوليو — المصدر X"
                className="w-full rounded-xl border border-[color:var(--app-line)] bg-transparent px-3 py-2.5"
              />
            </label>

            <label className="block sm:col-span-1">
              <span className="mb-1 block text-sm font-semibold">ملاحظات المصدر</span>
              <input
                value={sourceNotes}
                onChange={(e) => setSourceNotes(e.target.value)}
                placeholder="أكاديمية فلان — ملف PDF"
                className="w-full rounded-xl border border-[color:var(--app-line)] bg-transparent px-3 py-2.5"
              />
            </label>

            {saveMsg && (
              <p
                className={`rounded-xl px-4 py-3 text-sm sm:col-span-3 ${
                  saveMsg.tone === 'ok'
                    ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                    : 'bg-red-500/10 text-red-700 dark:text-red-300'
                }`}
              >
                {saveMsg.text}
              </p>
            )}
          </section>

          {stats && (
            <details className="glass rounded-2xl p-4 text-sm">
              <summary className="cursor-pointer font-semibold">إحصائيات التحليل</summary>
              <pre dir="ltr" className="mt-3 overflow-x-auto text-left text-xs">
                {JSON.stringify(stats, null, 2)}
              </pre>
              <p className="mt-2 text-xs text-[color:var(--app-muted)]">
                {passages.length} قطعة قراءة مستخرجة
              </p>
            </details>
          )}

          <div className="space-y-4">
            {visible.map((q) => (
              <ManualKeyCard
                key={q.ref}
                index={staged.indexOf(q)}
                question={q}
                included={!excluded.has(q.ref)}
                onToggleInclude={() => toggleInclude(q.ref)}
                onSetOption={(opt) => setOption(q.ref, opt)}
                onSetExplanation={(text) => setExplanation(q.ref, text)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
