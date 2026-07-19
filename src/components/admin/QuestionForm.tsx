'use client';

import { useMemo, useState } from 'react';
import { OPTION_KEYS, type OptionKey } from '@/lib/content/schema';
import {
  DIFFICULTIES, SECTION_LIST, SKILLS_BY_SECTION, type SectionId,
} from '@/lib/content/taxonomy';
import { issuesByField, validateDraft, type DraftQuestion } from '@/lib/content/validation';
import type { AudioClipRef, ContentStatus, PassageRef } from '@/lib/content/repository';

const STATUS_LABELS: Record<ContentStatus, string> = {
  draft: 'مسودة',
  review: 'للمراجعة',
  published: 'منشور',
  retired: 'متقاعد',
};

const DIFFICULTY_LABELS: Record<string, string> = {
  easy: 'سهل',
  medium: 'متوسط',
  hard: 'صعب',
};

export interface QuestionFormProps {
  value: DraftQuestion;
  onChange: (next: DraftQuestion) => void;
  passages: PassageRef[];
  audioClips: AudioClipRef[];
  /** Server-side errors that the client check cannot produce (duplicates). */
  serverError?: string | null;
  compact?: boolean;
}

/**
 * The single question editor.
 *
 * Used for creating and for editing, and for every section — the form
 * adapts rather than existing in four near-identical copies that drift.
 *
 * Validation runs on every keystroke and renders inline, so a missing
 * skill is visible before the save button is ever pressed.
 */
export function QuestionForm({
  value,
  onChange,
  passages,
  audioClips,
  serverError,
  compact = false,
}: QuestionFormProps) {
  const [tagInput, setTagInput] = useState('');

  const validation = useMemo(() => validateDraft(value), [value]);
  const fieldIssues = useMemo(() => issuesByField(validation), [validation]);

  const set = <K extends keyof DraftQuestion>(key: K, v: DraftQuestion[K]) =>
    onChange({ ...value, [key]: v });

  const skills = SKILLS_BY_SECTION[value.section] ?? [];

  const setSection = (section: SectionId) => {
    // Changing section invalidates the skill — a grammar skill on a
    // reading question is rejected by the database, so clear it rather
    // than let the author hit that error later.
    const stillValid = SKILLS_BY_SECTION[section]?.some((s) => s.id === value.skillId);
    onChange({
      ...value,
      section,
      skillId: stillValid ? value.skillId : '',
      // Stimuli are section-specific too.
      passageId: section === 'reading' ? value.passageId : null,
      audioClipId: section === 'listening' ? value.audioClipId : null,
    });
  };

  const addTag = () => {
    const t = tagInput.trim().replace(/\s+/g, '-');
    if (!t) return;
    if (!(value.tags ?? []).includes(t)) set('tags', [...(value.tags ?? []), t]);
    setTagInput('');
  };

  const Err = ({ field }: { field: string }) => {
    const list = fieldIssues[field];
    if (!list?.length) return null;
    return (
      <ul className="mt-1 space-y-0.5">
        {list.map((i, n) => (
          <li
            key={n}
            className={`text-xs ${i.severity === 'error' ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400'}`}
          >
            {i.severity === 'error' ? '✕' : '⚠'} {i.message}
          </li>
        ))}
      </ul>
    );
  };

  return (
    <div className="space-y-4">
      {serverError && (
        <p className="rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          {serverError}
        </p>
      )}

      {/* --- classification --- */}
      <div className={`grid gap-3 ${compact ? 'sm:grid-cols-2' : 'sm:grid-cols-4'}`}>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold">القسم</span>
          <select
            value={value.section}
            onChange={(e) => setSection(e.target.value as SectionId)}
            className="w-full rounded-lg border border-[color:var(--app-line)] bg-transparent px-3 py-2 text-sm"
          >
            {SECTION_LIST.map((s) => (
              <option key={s.id} value={s.id}>{s.nameAr}</option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-semibold">
            المهارة <span className="text-red-500">*</span>
          </span>
          <select
            value={value.skillId}
            onChange={(e) => set('skillId', e.target.value)}
            className={`w-full rounded-lg border bg-transparent px-3 py-2 text-sm ${
              fieldIssues.skillId?.some((i) => i.severity === 'error')
                ? 'border-red-500'
                : 'border-[color:var(--app-line)]'
            }`}
          >
            <option value="">— اختر —</option>
            {skills.map((s) => (
              <option key={s.id} value={s.id}>{s.nameAr}</option>
            ))}
          </select>
          <Err field="skillId" />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-semibold">الصعوبة</span>
          <select
            value={value.difficulty}
            onChange={(e) => set('difficulty', e.target.value)}
            className="w-full rounded-lg border border-[color:var(--app-line)] bg-transparent px-3 py-2 text-sm"
          >
            {DIFFICULTIES.map((d) => (
              <option key={d} value={d}>{DIFFICULTY_LABELS[d]}</option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-semibold">الحالة</span>
          <select
            value={value.status}
            onChange={(e) => set('status', e.target.value)}
            className="w-full rounded-lg border border-[color:var(--app-line)] bg-transparent px-3 py-2 text-sm"
          >
            {(Object.keys(STATUS_LABELS) as ContentStatus[]).map((s) => (
              <option key={s} value={s}>{STATUS_LABELS[s]}</option>
            ))}
          </select>
          <Err field="status" />
        </label>
      </div>

      {/* --- stimulus, per section --- */}
      {value.section === 'reading' && (
        <label className="block">
          <span className="mb-1 block text-xs font-semibold">قطعة القراءة</span>
          <select
            value={value.passageId ?? ''}
            onChange={(e) => set('passageId', e.target.value || null)}
            className="w-full rounded-lg border border-[color:var(--app-line)] bg-transparent px-3 py-2 text-sm"
          >
            <option value="">— بلا قطعة —</option>
            {passages.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title ? `${p.title} — ` : ''}{p.body.slice(0, 60)}…
              </option>
            ))}
          </select>
          <Err field="passageId" />
        </label>
      )}

      {value.section === 'listening' && (
        <label className="block">
          <span className="mb-1 block text-xs font-semibold">
            التسجيل الصوتي <span className="text-red-500">*</span>
          </span>
          <select
            value={value.audioClipId ?? ''}
            onChange={(e) => set('audioClipId', e.target.value || null)}
            className={`w-full rounded-lg border bg-transparent px-3 py-2 text-sm ${
              fieldIssues.audioClipId?.some((i) => i.severity === 'error')
                ? 'border-red-500'
                : 'border-[color:var(--app-line)]'
            }`}
          >
            <option value="">— اختر تسجيلًا —</option>
            {audioClips.map((c) => (
              <option key={c.id} value={c.id}>{c.audioKey}</option>
            ))}
          </select>
          <Err field="audioClipId" />
          {audioClips.length === 0 && (
            <p className="mt-1 text-xs text-[color:var(--app-muted)]">
              لا توجد تسجيلات بعد — ارفع تسجيلًا من تبويب الصوتيات أولًا.
            </p>
          )}
        </label>
      )}

      {/* --- question text --- */}
      <label className="block">
        <span className="mb-1 flex items-baseline gap-2 text-xs font-semibold">
          نص السؤال <span className="text-red-500">*</span>
          <span className="font-normal text-[color:var(--app-muted)]">
            الأسطر الجديدة تُحفظ وتظهر كما هي في المحاكي
          </span>
        </span>
        <textarea
          value={value.text}
          onChange={(e) => set('text', e.target.value)}
          rows={compact ? 3 : 5}
          dir="ltr"
          spellCheck={false}
          className={`w-full whitespace-pre-wrap rounded-lg border bg-transparent p-3 text-left font-serif text-sm ${
            fieldIssues.text?.some((i) => i.severity === 'error')
              ? 'border-red-500'
              : 'border-[color:var(--app-line)]'
          }`}
        />
        <Err field="text" />
      </label>

      {/* --- options --- */}
      <div>
        <span className="mb-1 block text-xs font-semibold">
          الخيارات <span className="text-red-500">*</span>
          <span className="mr-2 font-normal text-[color:var(--app-muted)]">
            اضغط الحرف لتحديد الإجابة الصحيحة
          </span>
        </span>

        <div className="space-y-2">
          {OPTION_KEYS.map((k) => {
            const isCorrect = value.correctOption === k;
            const filled = Boolean(value.options[k]?.trim());
            return (
              <div key={k} className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => set('correctOption', isCorrect ? '' : k)}
                  disabled={!filled}
                  aria-pressed={isCorrect}
                  title={filled ? 'اجعل هذا هو الجواب الصحيح' : 'اكتب نص الخيار أولًا'}
                  className={`h-9 w-9 flex-shrink-0 rounded-lg border-2 text-sm font-bold transition-colors disabled:opacity-30 ${
                    isCorrect
                      ? 'border-emerald-600 bg-emerald-600 text-white'
                      : 'border-[color:var(--app-line)]'
                  }`}
                >
                  {k}
                </button>
                <input
                  value={value.options[k] ?? ''}
                  onChange={(e) => {
                    const next = { ...value.options, [k]: e.target.value };
                    // Clearing the option that was marked correct must
                    // clear the answer too, or the row saves pointing at
                    // an empty choice.
                    const clearedCorrect = isCorrect && !e.target.value.trim();
                    onChange({
                      ...value,
                      options: next,
                      correctOption: clearedCorrect ? '' : value.correctOption,
                    });
                  }}
                  dir="ltr"
                  placeholder={`الخيار ${k}`}
                  className={`flex-1 rounded-lg border bg-transparent px-3 py-2 text-left font-serif text-sm ${
                    isCorrect ? 'border-emerald-500 bg-emerald-500/5' : 'border-[color:var(--app-line)]'
                  }`}
                />
              </div>
            );
          })}
        </div>
        <Err field="options" />
        <Err field="correctOption" />
      </div>

      {/* --- explanation --- */}
      <label className="block">
        <span className="mb-1 flex items-baseline gap-2 text-xs font-semibold">
          الشرح بالعربية
          <span className="font-normal text-[color:var(--app-muted)]">
            يظهر للطالب بعد الاختبار · الأسطر تُحفظ كما هي
          </span>
        </span>
        <textarea
          value={value.explanationAr ?? ''}
          onChange={(e) => set('explanationAr', e.target.value)}
          rows={compact ? 2 : 4}
          dir="rtl"
          className="w-full whitespace-pre-wrap rounded-lg border border-[color:var(--app-line)] bg-transparent p-3 text-sm"
        />
        <Err field="explanationAr" />
      </label>

      {/* --- tags --- */}
      <div>
        <span className="mb-1 block text-xs font-semibold">الوسوم</span>
        <div className="mb-2 flex flex-wrap gap-1.5">
          {(value.tags ?? []).map((t) => (
            <span
              key={t}
              className="inline-flex items-center gap-1 rounded-full bg-black/[0.06] px-3 py-1 text-xs dark:bg-white/[0.08]"
            >
              {t}
              <button
                type="button"
                onClick={() => set('tags', (value.tags ?? []).filter((x) => x !== t))}
                className="text-[color:var(--app-muted)] hover:text-red-600"
                aria-label={`إزالة ${t}`}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); addTag(); }
            }}
            placeholder="أضف وسمًا ثم Enter"
            className="flex-1 rounded-lg border border-[color:var(--app-line)] bg-transparent px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={addTag}
            className="rounded-lg border border-[color:var(--app-line)] px-4 text-sm font-semibold"
          >
            إضافة
          </button>
        </div>
      </div>

      {/* --- validation summary --- */}
      {validation.warnings.length > 0 && (
        <ul className="space-y-0.5 rounded-xl bg-amber-500/10 px-4 py-3 text-xs text-amber-800 dark:text-amber-200">
          {validation.warnings.map((w, i) => <li key={i}>⚠ {w.message}</li>)}
        </ul>
      )}
    </div>
  );
}

/** A blank draft for a new question. */
export function emptyDraft(section: SectionId = 'grammar'): DraftQuestion {
  return {
    section,
    skillId: '',
    difficulty: 'medium',
    status: 'draft',
    text: '',
    options: { A: '', B: '', C: '', D: '' },
    correctOption: '',
    explanationAr: '',
    tags: [],
    passageId: null,
    audioClipId: null,
  };
}
