'use client';

import { useCallback, useMemo, useRef, useState, useTransition } from 'react';
import { ManualKeyCard, type ManualKeyQuestion } from '@/components/admin/ManualKeyCard';
import { FastKeyPanel } from '@/components/admin/FastKeyPanel';
import { runPipeline } from '@/lib/ingestion/pipeline';
import { uploadListeningAudio } from '@/lib/ingestion/uploadAudio';
import { saveListeningBatch, type SaveQuestion } from '@/app/actions/ingestion';
import type { OptionKey } from '@/lib/ingestion/fastkey';

const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const ALLOWED = ['audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/x-m4a', 'audio/wav'];

/**
 * Listening ingestion.
 *
 * One clip, its questions, and their keys — set by clicking, because
 * listening keys come from the source document and there is no text for
 * an LLM to reason over. Fast-Key is available too for clips that ship
 * with a written key list.
 */
export default function ListeningIngestPage() {
  const [file, setFile] = useState<File | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [duration, setDuration] = useState<number | null>(null);

  const [raw, setRaw] = useState('');
  const [staged, setStaged] = useState<ManualKeyQuestion[]>([]);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [parseError, setParseError] = useState<string | null>(null);

  const [batchTitle, setBatchTitle] = useState('');
  const [sourceNotes, setSourceNotes] = useState('');
  const [saveMsg, setSaveMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [stage, setStage] = useState<string | null>(null);
  const [busy, startSave] = useTransition();

  const objectUrlRef = useRef<string | null>(null);

  const onPickFile = (f: File | null) => {
    setAudioError(null);
    setDuration(null);

    // Revoke the previous blob URL — swapping files repeatedly without
    // this leaks the whole audio buffer for the life of the tab.
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }

    if (!f) { setFile(null); setAudioUrl(null); return; }

    if (!ALLOWED.includes(f.type) && !/\.(mp3|m4a|wav)$/i.test(f.name)) {
      setAudioError(`نوع الملف غير مدعوم (${f.type || 'غير معروف'}). استخدم MP3 أو M4A أو WAV.`);
      setFile(null); setAudioUrl(null);
      return;
    }
    if (f.size > MAX_AUDIO_BYTES) {
      setAudioError(`حجم الملف ${(f.size / 1024 / 1024).toFixed(1)}MB يتجاوز الحد (25MB).`);
      setFile(null); setAudioUrl(null);
      return;
    }

    const url = URL.createObjectURL(f);
    objectUrlRef.current = url;
    setFile(f);
    setAudioUrl(url);
  };

  /**
   * The audio key. Derived from the filename, matching the existing
   * corpus convention (1742938770.mp3 -> "1742938770") so a re-upload of
   * the same clip maps onto the same row.
   */
  const audioKey = useMemo(
    () => (file ? file.name.replace(/\.[^.]+$/, '').replace(/[^\w-]/g, '_') : ''),
    [file],
  );

  const parse = () => {
    setParseError(null);
    const result = runPipeline(raw);
    if (!result.questions.length) {
      setParseError(`لم يُستخرج أي سؤال. رُفض ${result.rejected.length} مقطع.`);
      return;
    }
    setStaged(
      result.questions.map((q, i) => ({
        ref: `l${i}`,
        questionText: q.questionText,
        options: q.options,
      })),
    );
    setExcluded(new Set());
  };

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
            explanationAr: q.explanationAr?.trim() ? q.explanationAr : u.explanation,
            source: 'fastkey' as const,
          };
        }),
      );
    },
    [],
  );

  const setOption = useCallback((ref: string, option: OptionKey) => {
    setStaged((prev) => prev.map((q) => (q.ref === ref ? { ...q, correctOption: option, source: 'manual' as const } : q)));
  }, []);

  const setExplanation = useCallback((ref: string, text: string) => {
    setStaged((prev) => prev.map((q) => (q.ref === ref ? { ...q, explanationAr: text } : q)));
  }, []);

  const unsetCount = staged.filter((q) => !q.correctOption).length;
  const readyQuestions = staged.filter((q) => !excluded.has(q.ref) && q.correctOption);
  const keepCount = readyQuestions.length;
  const ready = Boolean(file) && keepCount > 0 && unsetCount === 0 && batchTitle.trim().length > 0;

  /**
   * Upload the clip, then save the questions.
   *
   * Strictly sequential: the questions carry a foreign key to the audio
   * row, so writing them before the object exists would produce rows
   * pointing at nothing — silently broken audio the student only
   * discovers mid-exam.
   */
  const uploadAndSave = () => {
    if (!file) return;
    setSaveMsg(null);

    startSave(async () => {
      setStage('رفع الملف الصوتي…');
      const up = await uploadListeningAudio(file);
      if (!up.ok || !up.storagePath || !up.audioKey) {
        setStage(null);
        setSaveMsg({ tone: 'err', text: up.error ?? 'فشل رفع الصوت' });
        return;
      }

      setStage('حفظ الأسئلة…');
      const payload: SaveQuestion[] = readyQuestions.map((q) => ({
        ref: q.ref,
        questionText: q.questionText,
        options: q.options,
        correctOption: q.correctOption!,
        explanationAr: q.explanationAr,
      }));

      const res = await saveListeningBatch({
        batchTitle,
        sourceNotes,
        audioKey: up.audioKey,
        storagePath: up.storagePath,
        durationMs: duration ? Math.round(duration * 1000) : undefined,
        questions: payload,
      });

      setStage(null);
      if (!res.ok) {
        setSaveMsg({ tone: 'err', text: res.error ?? 'فشل الحفظ' });
        return;
      }

      setSaveMsg({
        tone: 'ok',
        text: `✓ حُفظ ${res.inserted} سؤال مع التسجيل${res.duplicates ? ` · تجاهل ${res.duplicates} مكرر` : ''}`,
      });
      setStaged([]);
      setRaw('');
      setBatchTitle('');
      onPickFile(null);
    });
  };

  return (
    <div className="space-y-5">
      <section className="glass rounded-2xl p-6">
        <h1 className="text-xl font-bold">إدخال قسم الاستماع</h1>
        <p className="text-sm text-[color:var(--app-muted)]">
          ارفع التسجيل، ألصق أسئلته، ثم حدّد الإجابة الصحيحة بالنقر على كل بطاقة.
        </p>
      </section>

      {/* ---------- 1. audio ---------- */}
      <section className="glass space-y-4 rounded-2xl p-6">
        <h2 className="text-base font-bold">١ · ملف الصوت</h2>

        <input
          type="file"
          accept="audio/mpeg,audio/mp4,audio/wav,.mp3,.m4a,.wav"
          onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
          className="block w-full text-sm file:mr-4 file:rounded-xl file:border-0 file:bg-[color:var(--app-brand)] file:px-5 file:py-2.5 file:font-bold file:text-white"
        />

        {audioError && (
          <p className="rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">{audioError}</p>
        )}

        {audioUrl && file && (
          <div className="rounded-xl bg-black/[0.04] p-4 dark:bg-white/[0.05]">
            <div className="mb-2 flex flex-wrap items-baseline gap-3 text-sm">
              <b dir="ltr">{file.name}</b>
              <span className="text-xs text-[color:var(--app-muted)]">
                {(file.size / 1024 / 1024).toFixed(2)}MB
                {duration !== null && ` · ${Math.floor(duration / 60)}:${String(Math.round(duration % 60)).padStart(2, '0')}`}
              </span>
              <span className="flex-1" />
              <span className="text-xs text-[color:var(--app-muted)]">
                المعرّف: <b dir="ltr">{audioKey}</b>
              </span>
            </div>
            {/* Full controls here on purpose — this is the admin preview,
                not the exam player, so replay is expected. */}
            <audio
              src={audioUrl}
              controls
              onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
              className="w-full"
            />
          </div>
        )}
      </section>

      {/* ---------- 2. questions ---------- */}
      <section className="glass space-y-4 rounded-2xl p-6">
        <h2 className="text-base font-bold">٢ · أسئلة التسجيل</h2>

        <textarea
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          rows={10}
          dir="ltr"
          placeholder={'1. This conversation most likely takes place\nIn a grocery store\nIn a restaurant\nIn a house\nOn a train'}
          className="w-full rounded-xl border border-[color:var(--app-line)] bg-transparent p-4 text-left font-mono text-sm"
        />

        <button
          type="button"
          onClick={parse}
          disabled={raw.trim().length < 20}
          className="rounded-xl bg-[color:var(--app-brand)] px-6 py-2.5 font-bold text-white disabled:opacity-40"
        >
          تحليل الأسئلة
        </button>

        {parseError && (
          <p className="rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">{parseError}</p>
        )}
      </section>

      {/* ---------- 3. keys ---------- */}
      {staged.length > 0 && (
        <>
          <FastKeyPanel questions={staged} onApply={applyFastKeys} />

          <div className="glass sticky top-24 z-30 flex flex-wrap items-center gap-3 rounded-2xl p-4">
            <span className="text-sm">
              <b className="text-lg tabular-nums text-[color:var(--app-brand)]">{keepCount}</b> جاهز
              {unsetCount > 0 && (
                <span className="mr-2 text-amber-700 dark:text-amber-300">· {unsetCount} بلا إجابة</span>
              )}
            </span>
            <span className="flex-1" />
            <button
              type="button"
              onClick={uploadAndSave}
              disabled={!ready || busy}
              className="rounded-xl bg-emerald-600 px-6 py-2.5 font-bold text-white disabled:opacity-40"
              title={
                !file ? 'ارفع ملف الصوت أولًا'
                  : !batchTitle.trim() ? 'أدخل عنوان التسليمة'
                  : unsetCount ? `${unsetCount} سؤال بلا إجابة`
                  : undefined
              }
            >
              {busy ? (stage ?? '…جارٍ العمل') : 'رفع وحفظ التسليمة'}
            </button>
          </div>

          <section className="glass grid gap-3 rounded-2xl p-5 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-sm font-semibold">
                عنوان التسليمة <span className="text-red-500">*</span>
              </span>
              <input
                value={batchTitle}
                onChange={(e) => setBatchTitle(e.target.value)}
                placeholder="استماع — تجميعات يوليو"
                className="w-full rounded-xl border border-[color:var(--app-line)] bg-transparent px-3 py-2.5"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-semibold">ملاحظات المصدر</span>
              <input
                value={sourceNotes}
                onChange={(e) => setSourceNotes(e.target.value)}
                placeholder="المصدر الأصلي للتسجيل"
                className="w-full rounded-xl border border-[color:var(--app-line)] bg-transparent px-3 py-2.5"
              />
            </label>
            {saveMsg && (
              <p
                className={`rounded-xl px-4 py-3 text-sm sm:col-span-2 ${
                  saveMsg.tone === 'ok'
                    ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                    : 'bg-red-500/10 text-red-700 dark:text-red-300'
                }`}
              >
                {saveMsg.text}
              </p>
            )}
          </section>

          <div className="space-y-4">
            {staged.map((q, i) => (
              <ManualKeyCard
                key={q.ref}
                index={i}
                question={q}
                included={!excluded.has(q.ref)}
                onToggleInclude={() =>
                  setExcluded((prev) => {
                    const next = new Set(prev);
                    if (next.has(q.ref)) next.delete(q.ref);
                    else next.add(q.ref);
                    return next;
                  })
                }
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
