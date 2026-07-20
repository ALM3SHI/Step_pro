'use client';

import { useMemo, useState } from 'react';
import { bindFastKeys, buildExternalPrompt, parseFastKeys, type BindableQuestion, type OptionKey } from '@/lib/ingestion/fastkey';
import { Alert, Button, Card } from '@/components/ui';

export interface FastKeyPanelProps<T extends BindableQuestion> {
  questions: T[];
  onApply: (updates: Array<{ ref: string; option: OptionKey; explanation?: string }>) => void;
}

/**
 * Fast-Key paste box.
 *
 * Parses as you type and shows the outcome BEFORE anything is applied.
 * Applying 100 answers is the moment mistakes become invisible, so every
 * anomaly the binder found is surfaced first — and the destructive cases
 * (positional guessing, conflicts) require an explicit acknowledgement.
 */
export function FastKeyPanel<T extends BindableQuestion>({ questions, onApply }: FastKeyPanelProps<T>) {
  const [raw, setRaw] = useState('');
  const [copied, setCopied] = useState(false);
  const [ackPositional, setAckPositional] = useState(false);

  const outcome = useMemo(() => {
    if (!raw.trim()) return null;
    return bindFastKeys(questions, parseFastKeys(raw));
  }, [raw, questions]);

  const prompt = useMemo(() => buildExternalPrompt(questions), [questions]);

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const blocked = Boolean(outcome?.positional && !ackPositional);
  const canApply = Boolean(outcome && outcome.stats.applied > 0 && !blocked);

  return (
    <Card className="space-y-4 p-5">
      <div>
        <h3 className="text-base font-bold">مفاتيح الإجابات السريعة</h3>
        <p className="text-sm text-[color:var(--app-muted)]">
          انسخ الأسئلة إلى ChatGPT أو Gemini، ثم الصق سلسلة الإجابات هنا.
        </p>
      </div>

      {/* Step 1 — copy a prompt that guarantees a parseable reply. */}
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={copyPrompt}>
          {copied ? '✓ تم النسخ' : `نسخ الأسئلة (${questions.length}) للذكاء الاصطناعي`}
        </Button>
        <span className="text-xs text-[color:var(--app-muted)]">
          يتضمّن الترقيم نفسه المستخدم في الربط
        </span>
      </div>

      {/* Step 2 — paste the reply. */}
      <label className="block">
        <span className="mb-1 block text-sm font-semibold">الصق مفاتيح الإجابات</span>
        <textarea
          value={raw}
          onChange={(e) => { setRaw(e.target.value); setAckPositional(false); }}
          rows={4}
          dir="ltr"
          placeholder={'1:A, 2:B, 3:D …\nأو\n1. A\n2. B'}
          className="w-full rounded-xl border border-[color:var(--app-line)] bg-transparent p-3 text-left font-mono text-sm"
        />
      </label>

      {outcome && (
        <div className="space-y-3">
          {/* Headline coverage */}
          <div className="flex flex-wrap items-center gap-3 rounded-xl bg-black/[0.04] px-4 py-3 text-sm dark:bg-white/[0.05]">
            <span>
              الصيغة: <b dir="ltr">{outcome.detectedFormat}</b>
            </span>
            <span className="flex-1" />
            <span
              className={
                outcome.stats.coverage === 1
                  ? 'font-bold text-emerald-700 dark:text-emerald-300'
                  : 'font-bold text-amber-700 dark:text-amber-300'
              }
            >
              {outcome.stats.applied} / {outcome.stats.staged} سؤال
              ({Math.round(outcome.stats.coverage * 100)}%)
            </span>
          </div>

          {/* Positional mode is the one that can silently shift everything. */}
          {outcome.positional && (
            <label className="flex items-start gap-3 rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-800 dark:text-red-200">
              <input
                type="checkbox"
                checked={ackPositional}
                onChange={(e) => setAckPositional(e.target.checked)}
                className="mt-1 h-4 w-4 accent-red-600"
              />
              <span>
                <b>تحذير: لا توجد أرقام في اللصق.</b> تم الربط بالترتيب فقط — أي حرف ناقص
                يُزيح كل الإجابات بعده. راجع البطاقات يدويًا قبل الحفظ.
              </span>
            </label>
          )}

          {outcome.conflicts.length > 0 && (
            <Issue tone="amber" title={`تعارض في ${outcome.conflicts.length} سؤال`}>
              {outcome.conflicts.map((c) => (
                <li key={c.index} dir="ltr">
                  #{c.index}: kept {c.kept}, discarded {c.discarded}
                </li>
              ))}
            </Issue>
          )}

          {outcome.invalidOption.length > 0 && (
            <Issue tone="amber" title={`${outcome.invalidOption.length} مفتاح يشير لخيار غير موجود`}>
              {outcome.invalidOption.map((v, i) => (
                <li key={i} dir="ltr">#{v.entry.index}: option {v.entry.option} not on this question</li>
              ))}
            </Issue>
          )}

          {outcome.outOfRange.length > 0 && (
            <Issue tone="amber" title={`${outcome.outOfRange.length} رقم خارج النطاق`}>
              {outcome.outOfRange.slice(0, 8).map((e) => (
                <li key={e.index} dir="ltr">#{e.index} (staged: 1–{outcome.stats.staged})</li>
              ))}
            </Issue>
          )}

          {outcome.unmatched.length > 0 && (
            <Issue tone="slate" title={`${outcome.unmatched.length} سؤال بلا مفتاح`}>
              <li>ستبقى هذه الأسئلة بدون إجابة — حدّدها يدويًا على البطاقات.</li>
            </Issue>
          )}

          {outcome.malformed.length > 0 && (
            <Issue tone="slate" title={`${outcome.malformed.length} سطر لم يُفهم`}>
              {outcome.malformed.slice(0, 5).map((m, i) => (
                <li key={i} dir="ltr" className="truncate font-mono text-xs">{m}</li>
              ))}
            </Issue>
          )}

          <Button
            variant="primary"
            size="lg"
            block
            className="bg-emerald-600"
            disabled={!canApply}
            onClick={() =>
              onApply(
                outcome.applied.map((a) => ({
                  ref: a.question.ref,
                  option: a.option,
                  explanation: a.explanation,
                })),
              )
            }
          >
            {blocked
              ? 'أكّد التحذير أعلاه أولًا'
              : `تطبيق ${outcome.stats.applied} إجابة على البطاقات`}
          </Button>
        </div>
      )}
    </Card>
  );
}

function Issue({
  tone,
  title,
  children,
}: {
  tone: 'amber' | 'slate';
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Alert tone={tone === 'amber' ? 'warn' : 'info'}>
      <b className="mb-1 block">{title}</b>
      <ul className="space-y-0.5">{children}</ul>
    </Alert>
  );
}
