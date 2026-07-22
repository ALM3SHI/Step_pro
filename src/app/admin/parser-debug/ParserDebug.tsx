'use client';

import { useState, useTransition } from 'react';
import {
  debugParseAction, type DebugPassage, type DebugQuestion, type DebugResult,
  type ParserComparison,
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

  const run = (compare = false) => {
    setResult(null);
    start(async () => {
      const res = await debugParseAction({
        section,
        limit,
        compare,
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
          <Button variant="primary" onClick={() => run(false)} disabled={pending}>
            {pending ? '…جارٍ التحليل' : 'حلّل واعرض'}
          </Button>
          <Button onClick={() => run(true)} disabled={pending}>
            ⇄ قارن المحرك القديم بالجديد
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
  const unlinkedCount = result.unlinked?.length ?? 0;

  return (
    <>
      {result.comparison && <Comparison c={result.comparison} />}

      {/* ---------- statistics ---------- */}
      <Card className="p-6">
        <SectionTitle>إحصائيات التحليل</SectionTitle>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="صفحات مفحوصة" value={r.pagesScanned} />
          <Stat label="قطع" value={r.passagesFound} tone="good" />
          <Stat label="أسئلة" value={r.questionsFound} tone="good" />
          <Stat label="مفاتيح إجابة" value={r.answerKeysFound} />
          <Stat
            label="أسئلة بلا ربط"
            value={r.unlinkedQuestions}
            tone={r.unlinkedQuestions ? 'bad' : 'good'}
          />
          <Stat
            label="قطع بلا أسئلة"
            value={r.emptyPassages}
            tone={r.emptyPassages ? 'warn' : 'good'}
          />
          <Stat
            label="مهارات مؤقتة"
            value={r.temporarySkills}
            tone={r.temporarySkills ? 'warn' : undefined}
          />
          <Stat label="قطع مكررة مدموجة" value={r.duplicatePassagesMerged} />
          <Stat
            label="كتل فاشلة"
            value={r.failedBlocks}
            tone={r.failedBlocks ? 'warn' : 'good'}
          />
          <Stat label="مفاتيح مربوطة" value={r.answerKeysBound} />
          <Stat
            label="بلا مفتاح"
            value={r.questionsWithoutKey}
            tone={r.questionsWithoutKey ? 'warn' : undefined}
          />
          <Stat label="تكرار داخل الملف" value={r.duplicatesInPayload} />
        </div>

        <p className="mt-3 text-xs text-[color:var(--app-muted)]">
          المُحلّل: <b>{r.parser}</b> · صور متخطاة: {r.imagesSkipped} · جداول:{' '}
          {r.tablesSkipped} · رسوم: {r.chartsSkipped}
        </p>

        {/* Confidence spread — an audit of the links, not their cause. */}
        <div className="mt-3 rounded-xl bg-black/[0.04] p-3 dark:bg-white/[0.05]">
          <p className="mb-1 text-xs font-bold">توزيع ثقة الربط</p>
          <div className="flex flex-wrap gap-3 text-xs">
            <span className="text-emerald-700 dark:text-emerald-300">عالية {r.confidence.high}</span>
            <span className="text-amber-700 dark:text-amber-300">متوسطة {r.confidence.medium}</span>
            <span className="text-red-700 dark:text-red-300">منخفضة {r.confidence.low}</span>
          </div>
          <p className="mt-1.5 text-[0.68rem] leading-relaxed text-[color:var(--app-muted)]">
            هذه الدرجة <b>تقييم لاحق</b> للربط ولا تصنعه. الربط موضعي بحت: السؤال يرث
            قطعة المنطقة النصية التي ورد فيها. الدرجة تُقاس بعد ذلك بمقارنة مفردات السؤال
            بالقطعة، فتكشف ربطًا سليمًا بنيويًا لكنه خاطئ دلاليًا. الثقة المنخفضة شائعة
            في أسئلة «الفكرة الرئيسية» و«مرجع الضمير» لأنها لا تشارك القطعة مفرداتها.
          </p>
        </div>

        <div className="mt-3">
          <Alert tone={unlinkedCount === 0 ? 'good' : 'bad'}>
            {unlinkedCount === 0
              ? '✓ كل سؤال مرتبط بقطعة — لا يوجد سؤال بلا ربط.'
              : `⚠ ${unlinkedCount} سؤالًا لم يُربط. لم يُنسب لأقرب قطعة — انظر القسم أدناه.`}
          </Alert>
        </div>

        {r.answerKeyConflicts.length > 0 && (
          <Alert tone="warn">
            مفاتيح متضاربة (حُجبت ولم تُخمَّن):{' '}
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

      {/* ---------- unlinked questions ---------- */}
      {unlinkedCount > 0 && (
        <Card accent="bad" className="p-5">
          <h3 className="mb-1 font-bold text-red-700 dark:text-red-300">
            أسئلة بلا ربط ({unlinkedCount})
          </h3>
          <p className="mb-3 text-xs text-[color:var(--app-muted)]">
            لم تُنسب لأقرب قطعة عمدًا — الربط الخاطئ لا يُميَّز عن الصحيح بعد الحفظ.
          </p>
          <ol className="space-y-3">
            {result.unlinked!.map((q) => (
              <li key={q.index}>
                <div className="mb-1 text-xs font-semibold text-red-700 dark:text-red-300">
                  سبب الفشل: {q.reason}
                </div>
                <QuestionRow q={q} />
              </li>
            ))}
          </ol>
        </Card>
      )}

      {/* ---------- passages nothing pointed at ---------- */}
      {result.emptyPassages && result.emptyPassages.length > 0 && (
        <Card accent="warn" className="p-5">
          <h3 className="mb-1 font-bold">قطع بلا أسئلة ({result.emptyPassages.length})</h3>
          <p className="mb-3 text-xs text-[color:var(--app-muted)]">
            وُجدت في المصدر لكن لم يُنسب إليها أي سؤال.
          </p>
          <ul className="space-y-3">
            {result.emptyPassages.map((p) => (
              <li key={p.index} className="rounded-xl border border-[color:var(--app-line)] p-3">
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  <Badge tone="warn">قطعة {p.index + 1}</Badge>
                  <b className="text-sm">{p.title ?? '(بلا عنوان)'}</b>
                  <span className="flex-1" />
                  <SourceRef line={p.sourceLine} page={p.sourcePage} />
                </div>
                <p className="mb-2 text-xs font-semibold text-amber-700 dark:text-amber-300">
                  السبب المرجّح: {p.probableCause}
                </p>
                <pre dir="ltr" className="max-h-32 overflow-y-auto whitespace-pre-wrap text-left font-serif text-xs text-[color:var(--app-muted)]">
                  {p.body.slice(0, 400)}
                </pre>
              </li>
            ))}
          </ul>
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

/** Line and page in the original source, so a bad parse can be looked up. */
function SourceRef({ line, page }: { line: number; page?: number }) {
  return (
    <span className="whitespace-nowrap text-[0.65rem] text-[color:var(--app-muted)]">
      {page != null && <>صفحة <b className="tabular-nums">{page}</b> · </>}
      سطر <b className="tabular-nums">{line}</b>
    </span>
  );
}

function Comparison({ c }: { c: ParserComparison }) {
  const rows: Array<[string, string | number, string | number, boolean]> = [
    ['الأسئلة المستخرجة', c.old.questions, c.neu.questions, c.neu.questions >= c.old.questions],
    ['القطع', c.old.passages, c.neu.passages, c.neu.passages >= c.old.passages],
    ['أسئلة مرتبطة بقطعة', c.old.questionsWithPassage, c.neu.questionsWithPassage,
      c.neu.questionsWithPassage >= c.old.questionsWithPassage],
    ['مفاتيح إجابة مستخرجة', c.old.answerKeys, c.neu.answerKeys, c.neu.answerKeys >= c.old.answerKeys],
    ['مرفوض / فاشل', c.old.rejected, c.neu.failed, true],
    ['أسئلة بلا ربط (معزولة)', '—', c.neu.unlinked, true],
    ['اختيار المُحلّل', `${c.old.strategy} (تخمين ${(c.old.strategyConfidence * 100).toFixed(0)}%)`,
      `${c.neu.parser} (اختيار يدوي)`, true],
  ];

  return (
    <Card accent="brand" className="p-6">
      <SectionTitle hint="نفس النص، مُرِّر على المحركين.">مقارنة المحرك القديم بالجديد</SectionTitle>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[color:var(--app-line)] text-right">
              <th className="py-2 font-bold">المقياس</th>
              <th className="py-2 font-bold text-[color:var(--app-muted)]">القديم</th>
              <th className="py-2 font-bold text-[color:var(--app-brand)]">الجديد</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, oldV, newV, better]) => (
              <tr key={label} className="border-b border-[color:var(--app-line)]/50">
                <td className="py-2">{label}</td>
                <td className="py-2 tabular-nums text-[color:var(--app-muted)]">{oldV}</td>
                <td className={`py-2 font-bold tabular-nums ${
                  better ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'
                }`}>
                  {newV}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {c.notes.map((n, i) => (
        <p key={i} className="mt-2 text-xs leading-relaxed text-[color:var(--app-muted)]">• {n}</p>
      ))}
    </Card>
  );
}

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
        <Badge tone={passage.hadExplicitHeader ? undefined : 'warn'}>
          {passage.hadExplicitHeader ? 'ترويسة صريحة' : 'مستنتجة من الفقرات'}
        </Badge>
        <span className="flex-1" />
        <SourceRef line={passage.sourceLine} page={passage.sourcePage} />
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

        {q.confidenceBand && (
          <Badge
            tone={
              q.confidenceBand === 'high' ? 'good'
                : q.confidenceBand === 'medium' ? 'warn' : 'bad'
            }
          >
            ثقة الربط {Math.round((q.confidenceScore ?? 0) * 100)}%
          </Badge>
        )}

        <span className="flex-1" />
        <SourceRef line={q.sourceLine} page={q.sourcePage} />
      </div>

      {/* Why this question is under this passage — shown, not implied. */}
      {q.linkMechanism && (
        <details className="mb-2 rounded-lg bg-black/[0.03] px-2.5 py-1.5 dark:bg-white/[0.04]">
          <summary className="cursor-pointer text-[0.7rem] font-semibold">
            آلية الربط: {q.linkMechanism === 'region-position' ? 'موضعية (منطقة القطعة)' : 'بلا ربط'}
          </summary>
          <ul className="mt-1.5 space-y-0.5">
            {q.linkEvidence?.map((e, i) => (
              <li key={i} className="text-[0.68rem] text-[color:var(--app-muted)]">— {e}</li>
            ))}
          </ul>
          {q.confidenceSignals && (
            <>
              <p className="mt-1.5 text-[0.68rem] font-semibold">إشارات الثقة:</p>
              <ul className="space-y-0.5">
                {q.confidenceSignals.map((s, i) => (
                  <li key={i} className="text-[0.68rem]">
                    <span className={s.passed ? 'text-emerald-700 dark:text-emerald-300' : 'text-[color:var(--app-muted)]'}>
                      {s.passed ? '✓' : '✗'} {s.label}
                    </span>
                    <span className="opacity-60"> ({Math.round(s.weight * 100)}%)</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </details>
      )}

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
