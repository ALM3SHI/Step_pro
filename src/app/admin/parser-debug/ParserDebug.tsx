'use client';

import { useState, useTransition } from 'react';
import {
  debugParseAction, type DebugPassage, type DebugQuestion, type DebugResult,
} from '@/app/actions/parser-debug';
import { SECTION_LIST, SKILL_BY_ID, type SectionId } from '@/lib/content/taxonomy';
import { Alert, Badge, Button, Card, Pill, SectionTitle, Stat, inputClass } from '@/components/ui';

/**
 * Visual review of what the parser produced.
 *
 * Built to answer one question that counters cannot: is each question
 * actually attached to the RIGHT passage? So a passage renders as a
 * container with its questions inside it — if the grouping is wrong, it
 * is wrong on screen, not hidden behind a total.
 */

const OPTION_ORDER = ['A', 'B', 'C', 'D'] as const;

export function ParserDebug({
  samples,
}: {
  samples: Array<{ key: string; label: string; section: SectionId }>;
}) {
  const [section, setSection] = useState<SectionId>('reading');
  const [mode, setMode] = useState<'sample' | 'paste'>('sample');
  const [sampleKey, setSampleKey] = useState(samples[0]?.key ?? '');
  const [paste, setPaste] = useState('');
  const [limit, setLimit] = useState(20);
  const [result, setResult] = useState<DebugResult | null>(null);
  const [pending, start] = useTransition();

  const run = () => {
    setResult(null);
    start(async () => {
      const res = await debugParseAction({
        section,
        limit,
        source: mode === 'sample'
          ? { kind: 'sample', key: sampleKey }
          : { kind: 'paste', text: paste },
      });
      setResult(res);
    });
  };

  return (
    <div className="space-y-5">
      {/* ---------- controls ---------- */}
      <Card className="p-6">
        <SectionTitle hint="لا يكتب شيئًا في قاعدة البيانات — معاينة فقط.">
          مراجعة مُحلّل الاستيراد
        </SectionTitle>

        <div className="mb-3 flex flex-wrap gap-2">
          {SECTION_LIST.map((s) => (
            <Pill key={s.id} active={section === s.id} onClick={() => setSection(s.id)}>
              {s.nameAr}
            </Pill>
          ))}
        </div>

        <div className="mb-3 flex flex-wrap gap-2">
          <Pill tone="accent" active={mode === 'sample'} onClick={() => setMode('sample')}>
            ملف من المشروع
          </Pill>
          <Pill tone="accent" active={mode === 'paste'} onClick={() => setMode('paste')}>
            نص ملصوق
          </Pill>
        </div>

        {mode === 'sample' ? (
          <select
            value={sampleKey}
            onChange={(e) => setSampleKey(e.target.value)}
            className={inputClass({ className: 'mb-3' })}
            aria-label="اختر ملفًا"
          >
            {samples.map((s) => (
              <option key={s.key} value={s.key}>{s.label}</option>
            ))}
          </select>
        ) : (
          <textarea
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            rows={10}
            dir="ltr"
            placeholder="Paste raw question text here…"
            className={inputClass({ className: 'mb-3 text-left font-mono text-sm' })}
          />
        )}

        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            عدد القطع المعروضة:
            <input
              type="number"
              min={1}
              max={200}
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value) || 20)}
              className={inputClass({ className: 'w-24 py-1' })}
            />
          </label>
          <Button variant="primary" onClick={run} disabled={pending}>
            {pending ? '…جارٍ التحليل' : 'حلّل واعرض'}
          </Button>
        </div>
      </Card>

      {result && !result.ok && <Alert tone="bad">{result.error}</Alert>}
      {result?.ok && <Results result={result} />}
    </div>
  );
}

// ---------------------------------------------------------------------

function Results({ result }: { result: DebugResult }) {
  const r = result.report!;
  const orphanCount = result.orphans?.length ?? 0;

  return (
    <>
      {/* ---------- report ---------- */}
      <Card className="p-6">
        <SectionTitle>تقرير التحليل</SectionTitle>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="صفحات" value={r.pagesScanned} />
          <Stat label="قطع" value={r.passagesFound} tone="good" />
          <Stat label="أسئلة" value={r.questionsFound} tone="good" />
          <Stat label="مفاتيح إجابة" value={r.answerKeysFound} />
          <Stat label="مفاتيح مربوطة" value={r.answerKeysBound} />
          <Stat label="بلا مفتاح" value={r.questionsWithoutKey} tone={r.questionsWithoutKey ? 'warn' : undefined} />
          <Stat label="تكرار داخل الملف" value={r.duplicatesInPayload} />
          <Stat label="كتل فاشلة" value={r.failedBlocks} tone={r.failedBlocks ? 'warn' : undefined} />
        </div>

        <p className="mt-3 text-xs text-[color:var(--app-muted)]">
          المُحلّل: <b>{r.parser}</b> · تكرار القطع المطوي: <b>{r.passageReprintsCollapsed}</b>
          {' '}· صور متخطاة: {r.imagesSkipped} · جداول: {r.tablesSkipped} · رسوم: {r.chartsSkipped}
        </p>

        {/* The single number that decides whether reading is correct. */}
        <div className="mt-3">
          <Alert tone={orphanCount === 0 ? 'good' : 'bad'}>
            {orphanCount === 0
              ? '✓ كل سؤال مرتبط بقطعة — لا يوجد سؤال يتيم.'
              : `⚠ ${orphanCount} سؤالًا بلا قطعة — الربط غير مكتمل.`}
          </Alert>
        </div>

        {r.answerKeyConflicts.length > 0 && (
          <Alert tone="warn">
            مفاتيح متضاربة (لم تُستخدم):{' '}
            {r.answerKeyConflicts.map((c) => `${c.number}=${c.options.join('/')}`).join('، ')}
          </Alert>
        )}
        {r.notes.map((n, i) => (
          <p key={i} className="mt-1 text-xs text-[color:var(--app-muted)]">• {n}</p>
        ))}
        {r.warnings.map((w, i) => (
          <p key={i} className="mt-1 text-xs text-amber-700 dark:text-amber-300">⚠ {w}</p>
        ))}
      </Card>

      {/* ---------- passages with their questions ---------- */}
      {result.passages?.map((p) => <PassageCard key={p.index} passage={p} />)}

      {result.flatQuestions && (
        <Card className="p-5">
          <h3 className="mb-3 font-bold">الأسئلة ({result.flatQuestions.length})</h3>
          <ol className="space-y-3">
            {result.flatQuestions.map((q) => (
              <QuestionRow key={q.index} q={q} />
            ))}
          </ol>
        </Card>
      )}

      {result.truncated && (
        <p className="text-center text-xs text-[color:var(--app-muted)]">
          عُرضت {result.truncated.shown} قطعة من {result.truncated.total}. ارفع العدد أعلاه لرؤية المزيد.
        </p>
      )}

      {/* ---------- orphans ---------- */}
      {orphanCount > 0 && (
        <Card accent="bad" className="p-5">
          <h3 className="mb-3 font-bold text-red-700 dark:text-red-300">
            أسئلة بلا قطعة ({orphanCount})
          </h3>
          <ol className="space-y-3">
            {result.orphans!.map((q) => <QuestionRow key={q.index} q={q} />)}
          </ol>
        </Card>
      )}

      {/* ---------- failed blocks ---------- */}
      {result.failed && result.failed.length > 0 && (
        <Card accent="warn" className="p-5">
          <h3 className="mb-1 font-bold">كتل لم تُفهم ({result.failed.length})</h3>
          <p className="mb-3 text-xs text-[color:var(--app-muted)]">
            محفوظة بنصها الأصلي — لم تُستورد ولم تُحذف.
          </p>
          <ul className="space-y-2">
            {result.failed.map((f, i) => (
              <li key={i} className="rounded-xl bg-black/[0.04] p-3 dark:bg-white/[0.05]">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <Badge tone="warn">سطر {f.sourceLine}</Badge>
                  <span className="text-xs font-semibold">{f.reason}</span>
                </div>
                <pre dir="ltr" className="overflow-x-auto whitespace-pre-wrap text-left font-mono text-[0.7rem] text-[color:var(--app-muted)]">
                  {f.text}
                </pre>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

// ---------------------------------------------------------------------

function PassageCard({ passage }: { passage: DebugPassage }) {
  const [open, setOpen] = useState(true);

  return (
    <Card accent={passage.questions.length ? 'brand' : 'warn'} className="p-5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Badge tone="brand">قطعة {passage.index + 1}</Badge>
        <h3 className="font-bold">{passage.title ?? '(بلا عنوان)'}</h3>
        <Badge tone={passage.questions.length ? 'good' : 'bad'}>
          {passage.questions.length} سؤالًا
        </Badge>
        {passage.occurrences > 1 && (
          <Badge>تكررت {passage.occurrences}× في المصدر</Badge>
        )}
        <span className="flex-1" />
        <Button variant="ghost" size="sm" onClick={() => setOpen((v) => !v)}>
          {open ? 'إخفاء النص' : 'إظهار النص'}
        </Button>
      </div>

      {open && (
        // dir=ltr and serif: this is English source text and must read
        // exactly as it will in the exam.
        <div
          dir="ltr"
          className="mb-4 max-h-64 overflow-y-auto rounded-xl bg-black/[0.04] p-4 text-left font-serif text-sm leading-[1.9] dark:bg-white/[0.05]"
        >
          {passage.body.split('\n').map((line, i) => (
            <p key={i} className="mb-2">{line}</p>
          ))}
        </div>
      )}

      {passage.questions.length === 0 ? (
        <Alert tone="warn">هذه القطعة بلا أسئلة — تحقق من التقطيع.</Alert>
      ) : (
        <ol className="space-y-3">
          {passage.questions.map((q) => <QuestionRow key={q.index} q={q} />)}
        </ol>
      )}
    </Card>
  );
}

function QuestionRow({ q }: { q: DebugQuestion }) {
  const skill = q.skillId ? SKILL_BY_ID[q.skillId] : undefined;

  return (
    <li className="rounded-xl border border-[color:var(--app-line)] p-3">
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <span className="text-xs font-bold tabular-nums text-[color:var(--app-muted)]">
          {q.sourceNumber != null ? `#${q.sourceNumber}` : `س${q.index + 1}`}
        </span>

        {q.correctOption ? (
          <Badge tone="good">الإجابة {q.correctOption}</Badge>
        ) : (
          <Badge tone="warn">بلا مفتاح</Badge>
        )}

        {skill ? (
          <Badge tone={q.skillIsTemporary ? 'warn' : undefined}>
            {skill.nameAr}{q.skillIsTemporary ? ' (مؤقتة)' : ''}
          </Badge>
        ) : (
          <Badge tone="bad">بلا مهارة</Badge>
        )}

        <span className="flex-1" />
        <span className="text-[0.65rem] text-[color:var(--app-muted)]">سطر {q.sourceLine}</span>
      </div>

      <p dir="ltr" className="mb-2 text-left font-serif text-[0.95rem] font-semibold">
        {q.text}
      </p>

      <div dir="ltr" className="space-y-1 text-left">
        {OPTION_ORDER.filter((k) => q.options[k]?.trim()).map((k) => {
          const correct = q.correctOption === k;
          return (
            <div
              key={k}
              className={`rounded-lg px-2.5 py-1 font-serif text-[0.85rem] ${
                correct
                  ? 'bg-emerald-500/15 font-bold text-emerald-800 dark:text-emerald-200'
                  : 'text-[color:var(--app-muted)]'
              }`}
            >
              <b className="mr-1.5">{k})</b> {q.options[k]}
            </div>
          );
        })}
      </div>

      {q.warnings.length > 0 && (
        <p className="mt-1.5 text-[0.7rem] text-amber-700 dark:text-amber-300">
          {q.warnings.join(' · ')}
        </p>
      )}
    </li>
  );
}
