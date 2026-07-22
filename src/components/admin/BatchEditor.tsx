'use client';

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import { QuestionForm, emptyDraft } from './QuestionForm';
import {
  deleteQuestionAction, moveQuestionsAction, swapQuestionOrderAction,
  saveQuestionAction, setStatusAction,
} from '@/app/actions/content';
import {
  DIFFICULTIES, SECTION_DEFS, SECTION_LIST, SKILLS_BY_SECTION, SKILL_BY_ID,
  type Difficulty, type SectionId,
} from '@/lib/content/taxonomy';
import { validateDraft, type DraftQuestion } from '@/lib/content/validation';
import type { BatchSummary, ContentStatus, AudioClipRef, EditableQuestion, PassageRef } from '@/lib/content/repository';
import { Alert, Button, Card, EmptyState, Pill, inputClass } from '@/components/ui';

const STATUS_STYLE: Record<string, string> = {
  published: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  draft: 'bg-slate-500/15 text-slate-600 dark:text-slate-300',
  review: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  retired: 'bg-red-500/15 text-red-700 dark:text-red-300',
};

const STATUS_LABELS: Record<ContentStatus, string> = {
  draft: 'مسودة', review: 'للمراجعة', published: 'منشور', retired: 'متقاعد',
};

export interface BatchEditorProps {
  batch: BatchSummary;
  initialQuestions: EditableQuestion[];
  passages: PassageRef[];
  audioClips: AudioClipRef[];
  otherBatches: BatchSummary[];
}

type Filter = 'all' | 'draft' | 'review' | 'published' | 'no-skill';

const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  easy: 'سهل', medium: 'متوسط', hard: 'صعب',
};

/**
 * Structural filters — the ones that answer "what is wrong with this
 * batch", not "what is in it".
 *
 * Each is a defect the bank actually accumulates: an item with no answer
 * key cannot be published, a reading item with no passage is the
 * mis-tagging bug, and an item with no explanation gives the candidate
 * nothing after the exam.
 */
const FLAG_FILTERS = {
  'no-key': {
    label: 'بلا مفتاح إجابة',
    test: (q: EditableQuestion) => !q.correctOption,
  },
  'no-explanation': {
    label: 'بلا شرح',
    test: (q: EditableQuestion) => !q.explanationAr?.trim(),
  },
  'no-stimulus': {
    label: 'قراءة/استماع بلا مُثير',
    test: (q: EditableQuestion) =>
      (q.section === 'reading' && !q.passageId && !q.imageUrl) ||
      (q.section === 'listening' && !q.audioClipId),
  },
  'has-passage': {
    label: 'له قطعة',
    test: (q: EditableQuestion) => Boolean(q.passageId),
  },
  'has-audio': {
    label: 'له صوت',
    test: (q: EditableQuestion) => Boolean(q.audioClipId),
  },
} as const;

type FlagKey = keyof typeof FLAG_FILTERS;

export function BatchEditor({
  batch, initialQuestions, passages, audioClips, otherBatches,
}: BatchEditorProps) {
  const [questions, setQuestions] = useState(initialQuestions);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftQuestion | null>(null);
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [section, setSection] = useState<SectionId | ''>('');
  const [skillId, setSkillId] = useState('');
  const [difficulty, setDifficulty] = useState<Difficulty | ''>('');
  const [flags, setFlags] = useState<Set<FlagKey>>(new Set());
  const PAGE_SIZE = 40;
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [message, setMessage] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const toDraft = (q: EditableQuestion): DraftQuestion => ({
    section: q.section,
    skillId: q.skillId ?? '',
    difficulty: q.difficulty,
    status: q.status,
    text: q.text,
    options: q.options,
    correctOption: q.correctOption ?? '',
    explanationAr: q.explanationAr ?? '',
    tags: q.tags,
    passageId: q.passageId,
    audioClipId: q.audioClipId,
    imageUrl: q.imageUrl,
    imageAlt: q.imageAlt,
  });

  /**
   * Every active filter narrows further — they compose as AND.
   *
   * Written as one pass with early returns rather than a chain of
   * `.filter()` calls: at 1,100 questions a chain allocates a fresh array
   * per dimension on every keystroke, and the search box is the one
   * control that re-runs this on every character.
   */
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const activeFlags = [...flags];

    return questions.filter((q) => {
      // --- status / missing-skill tab ---
      if (filter === 'no-skill') { if (q.skillId) return false; }
      else if (filter !== 'all' && q.status !== filter) return false;

      // --- taxonomy ---
      if (section && q.section !== section) return false;
      if (skillId && q.skillId !== skillId) return false;
      if (difficulty && q.difficulty !== difficulty) return false;

      // --- structural flags ---
      for (const key of activeFlags) {
        if (!FLAG_FILTERS[key].test(q)) return false;
      }

      // --- free text, last: it is the most expensive test ---
      if (needle) {
        const hit =
          q.text.toLowerCase().includes(needle) ||
          Object.values(q.options).some((o) => o?.toLowerCase().includes(needle)) ||
          (q.explanationAr ?? '').toLowerCase().includes(needle);
        if (!hit) return false;
      }

      return true;
    });
  }, [questions, filter, search, section, skillId, difficulty, flags]);

  /**
   * Skills offered in the picker.
   *
   * Scoped to the chosen section, and otherwise to the skills this batch
   * actually contains — listing all 27 when the batch holds four is a
   * menu of dead ends.
   */
  const skillOptions = useMemo(() => {
    const present = new Set(questions.map((q) => q.skillId).filter(Boolean) as string[]);
    const pool = section ? (SKILLS_BY_SECTION[section] ?? []) : Object.values(SKILL_BY_ID);
    return pool
      .filter((s) => present.has(s.id))
      .map((s) => ({
        ...s,
        count: questions.filter((q) => q.skillId === s.id).length,
      }));
  }, [questions, section]);

  /** Sections this batch actually contains, with counts. */
  const sectionOptions = useMemo(
    () => SECTION_LIST
      .map((s) => ({ ...s, count: questions.filter((q) => q.section === s.id).length }))
      .filter((s) => s.count > 0),
    [questions],
  );

  const activeFilterCount =
    (filter !== 'all' ? 1 : 0) + (section ? 1 : 0) + (skillId ? 1 : 0) +
    (difficulty ? 1 : 0) + flags.size + (search.trim() ? 1 : 0);

  const clearFilters = () => {
    setFilter('all'); setSection(''); setSkillId('');
    setDifficulty(''); setFlags(new Set()); setSearch('');
  };

  const toggleFlag = (key: FlagKey) => setFlags((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  /**
   * Render a window, not the whole batch.
   *
   * A migrated batch holds 1,100+ questions; mounting that many editable
   * cards locks the page for seconds and makes every keystroke laggy.
   * Search narrows it, and "show more" reveals the rest on demand.
   */
  const visible = useMemo(() => filtered.slice(0, limit), [filtered, limit]);

  // Same validator the form renders inline, so the button and the
  // messages can never disagree about whether the draft is saveable.
  const canSave = useMemo(() => (draft ? validateDraft(draft).canSave : false), [draft]);

  const counts = useMemo(() => ({
    all: questions.length,
    draft: questions.filter((q) => q.status === 'draft').length,
    review: questions.filter((q) => q.status === 'review').length,
    published: questions.filter((q) => q.status === 'published').length,
    'no-skill': questions.filter((q) => !q.skillId).length,
  }), [questions]);

  // Any narrowing returns to page one. Keeping a 400-row window after
  // the result set shrank to 12 leaves "show more" visible with nothing
  // behind it.
  useEffect(() => {
    setLimit(PAGE_SIZE);
  }, [filter, search, section, skillId, difficulty, flags]);

  /**
   * A skill from another section would filter to nothing.
   *
   * Picking "grammar" while "Main Idea" is still selected yields an empty
   * list with two controls that each look reasonable — so the stale one
   * is dropped rather than left to produce a confusing empty state.
   */
  useEffect(() => {
    if (section && skillId && SKILL_BY_ID[skillId]?.section !== section) setSkillId('');
  }, [section, skillId]);

  const save = useCallback((allowDuplicate = false) => {
    if (!draft) return;
    setServerError(null);
    start(async () => {
      const res = await saveQuestionAction({
        ...draft,
        batchId: batch.id,
        questionId: editingId ?? undefined,
        allowDuplicate,
      });

      if (!res.ok || !res.data) { setServerError(res.error ?? 'فشل الحفظ'); return; }

      const saved = res.data;
      setQuestions((prev) =>
        editingId ? prev.map((q) => (q.id === editingId ? saved : q)) : [...prev, saved],
      );
      setEditingId(null);
      setDraft(null);
      setAdding(false);
      setMessage({
        tone: 'ok',
        text: res.warnings?.length
          ? `✓ حُفظ · ${res.warnings.join(' · ')}`
          : '✓ حُفظ',
      });
    });
  }, [draft, editingId, batch.id]);

  const remove = (id: string) => {
    const q = questions.find((x) => x.id === id);
    if (!window.confirm(`حذف السؤال نهائيًا؟\n\n${q?.text.slice(0, 80)}`)) return;
    start(async () => {
      const res = await deleteQuestionAction(id, batch.id);
      if (!res.ok) { setMessage({ tone: 'err', text: res.error ?? 'فشل الحذف' }); return; }
      setQuestions((prev) => prev.filter((x) => x.id !== id));
      setSelected((prev) => { const n = new Set(prev); n.delete(id); return n; });
      setMessage({ tone: 'ok', text: '✓ حُذف السؤال' });
    });
  };

  /**
   * Swap one question with the neighbour ABOVE OR BELOW IT ON SCREEN.
   *
   * The neighbour comes from `filtered`, not from the full list. Reading
   * it from the full list meant that with a filter active the arrow
   * swapped the question with a row the user could not see: the visible
   * order appeared unchanged, so the button read as broken while it was
   * quietly reordering the batch.
   *
   * Two ids go to the server, never the whole order — see
   * `swapQuestionOrderAction`.
   */
  const nudge = (id: string, dir: -1 | 1) => {
    const pos = filtered.findIndex((q) => q.id === id);
    const neighbour = filtered[pos + dir];
    if (pos < 0 || !neighbour) return;

    const i = questions.findIndex((q) => q.id === id);
    const j = questions.findIndex((q) => q.id === neighbour.id);
    if (i < 0 || j < 0) return;

    const previous = questions;
    const next = [...questions];
    [next[i], next[j]] = [next[j], next[i]];
    setQuestions(next); // optimistic — reordering should feel instant

    start(async () => {
      const res = await swapQuestionOrderAction(id, neighbour.id);
      if (!res.ok) {
        setQuestions(previous); // roll back to the order the server still holds
        setMessage({ tone: 'err', text: res.error ?? 'فشل إعادة الترتيب' });
      }
    });
  };

  const bulkStatus = (status: ContentStatus) => {
    const ids = [...selected];
    if (!ids.length) return;
    start(async () => {
      const res = await setStatusAction(ids, status, batch.id);
      if (!res.ok) { setMessage({ tone: 'err', text: res.error ?? 'فشل التغيير' }); return; }
      setQuestions((prev) => prev.map((q) => (selected.has(q.id) ? { ...q, status } : q)));
      setSelected(new Set());
      setMessage({ tone: 'ok', text: `✓ تم تغيير حالة ${ids.length} سؤالًا` });
    });
  };

  const bulkMove = (targetId: string) => {
    const ids = [...selected];
    if (!ids.length || !targetId) return;
    start(async () => {
      const res = await moveQuestionsAction(ids, targetId);
      if (!res.ok) { setMessage({ tone: 'err', text: res.error ?? 'فشل النقل' }); return; }
      setQuestions((prev) => prev.filter((q) => !selected.has(q.id)));
      setSelected(new Set());
      setMessage({ tone: 'ok', text: `✓ نُقل ${ids.length} سؤالًا` });
    });
  };

  const TABS: Array<[Filter, string]> = [
    ['all', 'الكل'], ['published', 'منشور'], ['draft', 'مسودة'],
    ['review', 'للمراجعة'], ['no-skill', 'بلا مهارة'],
  ];

  return (
    <div className="space-y-4">
      {message && (
        <Alert tone={message.tone === 'ok' ? 'good' : 'bad'}>{message.text}</Alert>
      )}

      {/* --- toolbar --- */}
      <Card as="div" className="sticky top-24 z-30 space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          {TABS.map(([key, label]) => (
            <Pill
              key={key}
              active={filter === key}
              onClick={() => setFilter(key)}
              disabled={counts[key] === 0 && key !== 'all'}
            >
              {label} <span className="tabular-nums opacity-70">({counts[key]})</span>
            </Pill>
          ))}
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="بحث في النص أو الخيارات أو الشرح…"
            className={inputClass({ className: 'min-w-[200px] flex-1' })}
          />
          <Button
            variant="primary"
            onClick={() => { setAdding(true); setEditingId(null); setDraft(emptyDraft()); setServerError(null); }}
          >
            + سؤال جديد
          </Button>
        </div>

        {/* --- taxonomy filters --- */}
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={section}
            onChange={(e) => setSection(e.target.value as SectionId | '')}
            aria-label="تصفية بالقسم"
            className={inputClass({ className: 'w-auto py-1.5 text-sm' })}
          >
            <option value="">كل الأقسام</option>
            {sectionOptions.map((s) => (
              <option key={s.id} value={s.id}>{s.nameAr} ({s.count})</option>
            ))}
          </select>

          <select
            value={skillId}
            onChange={(e) => setSkillId(e.target.value)}
            aria-label="تصفية بالمهارة"
            disabled={skillOptions.length === 0}
            className={inputClass({ className: 'w-auto py-1.5 text-sm' })}
          >
            <option value="">كل المهارات</option>
            {skillOptions.map((s) => (
              <option key={s.id} value={s.id}>{s.nameAr} ({s.count})</option>
            ))}
          </select>

          <select
            value={difficulty}
            onChange={(e) => setDifficulty(e.target.value as Difficulty | '')}
            aria-label="تصفية بالصعوبة"
            className={inputClass({ className: 'w-auto py-1.5 text-sm' })}
          >
            <option value="">كل المستويات</option>
            {DIFFICULTIES.map((d) => (
              <option key={d} value={d}>
                {DIFFICULTY_LABELS[d]} ({questions.filter((q) => q.difficulty === d).length})
              </option>
            ))}
          </select>

          {(Object.keys(FLAG_FILTERS) as FlagKey[]).map((key) => {
            const n = questions.filter(FLAG_FILTERS[key].test).length;
            return (
              <Pill
                key={key}
                tone="accent"
                active={flags.has(key)}
                onClick={() => toggleFlag(key)}
                disabled={n === 0 && !flags.has(key)}
              >
                {FLAG_FILTERS[key].label} <span className="tabular-nums opacity-70">({n})</span>
              </Pill>
            );
          })}

          <span className="flex-1" />

          {/* The count is the feedback that the filters did something —
              without it an empty list reads as a broken page. */}
          <span className="text-xs tabular-nums text-[color:var(--app-muted)]">
            {filtered.length} من {questions.length}
          </span>

          {activeFilterCount > 0 && (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              مسح الفلاتر ({activeFilterCount})
            </Button>
          )}
        </div>

        {selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl bg-black/[0.04] px-3 py-2 dark:bg-white/[0.05]">
            <span className="text-sm font-semibold">{selected.size} محدَّد</span>
            <span className="flex-1" />
            {(['published', 'draft', 'review'] as ContentStatus[]).map((s) => (
              <Button key={s} size="sm" onClick={() => bulkStatus(s)} disabled={pending}>
                → {STATUS_LABELS[s]}
              </Button>
            ))}
            {otherBatches.length > 0 && (
              <select
                onChange={(e) => { bulkMove(e.target.value); e.target.value = ''; }}
                defaultValue=""
                className={inputClass({ className: 'w-auto py-1 text-xs' })}
              >
                <option value="">نقل إلى…</option>
                {otherBatches.map((b) => (
                  <option key={b.id} value={b.id}>{b.title}</option>
                ))}
              </select>
            )}
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
              إلغاء التحديد
            </Button>
          </div>
        )}
      </Card>

      {/* --- new question --- */}
      {adding && draft && (
        <Card className="p-5">
          <h3 className="mb-4 text-base font-bold">سؤال جديد</h3>
          <QuestionForm
            value={draft}
            onChange={setDraft}
            passages={passages}
            audioClips={audioClips}
            serverError={serverError}
          />
          <FormActions
            pending={pending}
            serverError={serverError}
            onSave={() => save(false)}
            onSaveAnyway={() => save(true)}
            canSave={canSave}
            onCancel={() => { setAdding(false); setDraft(null); setServerError(null); }}
          />
        </Card>
      )}

      {/* --- list --- */}
      {filtered.length > visible.length && (
        <p className="text-center text-xs text-[color:var(--app-muted)]">
          عرض {visible.length} من {filtered.length}
        </p>
      )}

      {visible.length === 0 ? (
        <Card>
          <EmptyState
            icon={activeFilterCount > 0 ? '🔍' : '📝'}
            title={
              activeFilterCount > 0
                ? 'لا سؤال يطابق هذه الفلاتر'
                : 'لا توجد أسئلة في هذه التجميعة'
            }
            // Naming the count is what turns a dead end into an action —
            // the combination is usually one filter too many, not empty.
            body={
              activeFilterCount > 0
                ? `${activeFilterCount} فلترًا مفعّلًا على ${questions.length} سؤالًا. جرّب مسحها.`
                : undefined
            }
          />
          {activeFilterCount > 0 && (
            <div className="px-6 pb-6">
              <Button block onClick={clearFilters}>مسح كل الفلاتر</Button>
            </div>
          )}
        </Card>
      ) : (
        <ul className="space-y-3">
          {visible.map((q, visibleIdx) => {
            const isEditing = editingId === q.id;
            const idx = questions.findIndex((x) => x.id === q.id);
            // Enabled per the VISIBLE list, matching what the arrow will
            // actually do. Keyed off `filtered` rather than `visible` so
            // the last row of a page can still move into the next page.
            const canMoveUp = visibleIdx > 0;
            const canMoveDown = visibleIdx < filtered.length - 1;

            return (
              <Card key={q.id} as="li" className="p-4">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <input
                    type="checkbox"
                    checked={selected.has(q.id)}
                    onChange={() => setSelected((prev) => {
                      const n = new Set(prev);
                      if (n.has(q.id)) n.delete(q.id); else n.add(q.id);
                      return n;
                    })}
                    className="h-4 w-4 accent-emerald-600"
                    aria-label="تحديد"
                  />
                  <span className="text-xs font-bold tabular-nums text-[color:var(--app-muted)]">
                    #{idx + 1}
                  </span>
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${STATUS_STYLE[q.status]}`}>
                    {STATUS_LABELS[q.status as ContentStatus]}
                  </span>
                  <span className="text-xs text-[color:var(--app-muted)]">
                    {SECTION_DEFS[q.section]?.nameAr}
                  </span>
                  {q.skillId ? (
                    <span className="text-xs text-[color:var(--app-muted)]">
                      · {SKILL_BY_ID[q.skillId]?.nameAr ?? q.skillId}
                    </span>
                  ) : (
                    <span className="text-xs font-bold text-red-600">· بلا مهارة</span>
                  )}
                  {q.correctOption && (
                    <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-bold text-emerald-700 dark:text-emerald-300">
                      {q.correctOption}
                    </span>
                  )}

                  <span className="flex-1" />

                  <Button variant="ghost" size="sm" onClick={() => nudge(q.id, -1)}
                    disabled={!canMoveUp || pending} aria-label="لأعلى">▲</Button>
                  <Button variant="ghost" size="sm" onClick={() => nudge(q.id, 1)}
                    disabled={!canMoveDown || pending} aria-label="لأسفل">▼</Button>
                  <Button
                    size="sm"
                    onClick={() => {
                      setEditingId(isEditing ? null : q.id);
                      setDraft(isEditing ? null : toDraft(q));
                      setAdding(false);
                      setServerError(null);
                    }}
                  >
                    {isEditing ? 'إغلاق' : 'تعديل'}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => remove(q.id)}
                    disabled={pending}
                    className="text-red-600 hover:bg-red-500/10"
                    aria-label="حذف"
                  >
                    ✕
                  </Button>
                </div>

                {isEditing && draft ? (
                  <div className="mt-3 border-t border-[color:var(--app-line)] pt-4">
                    <QuestionForm
                      value={draft}
                      onChange={setDraft}
                      passages={passages}
                      audioClips={audioClips}
                      serverError={serverError}
                    />
                    <FormActions
                      pending={pending}
                      serverError={serverError}
                      canSave={canSave}
                      onSave={() => save(false)}
                      onSaveAnyway={() => save(true)}
                      onCancel={() => { setEditingId(null); setDraft(null); setServerError(null); }}
                    />
                  </div>
                ) : (
                  <>
                    {/* whitespace-pre-wrap: authored newlines are content
                        and must read here exactly as in the simulator. */}
                    <p dir="ltr" className="whitespace-pre-wrap text-left font-serif text-sm">
                      {q.text}
                    </p>
                    <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1" dir="ltr">
                      {Object.entries(q.options).map(([k, v]) => (
                        <span
                          key={k}
                          className={`text-xs ${
                            k === q.correctOption
                              ? 'font-bold text-emerald-700 dark:text-emerald-300'
                              : 'text-[color:var(--app-muted)]'
                          }`}
                        >
                          {k}) {v}
                        </span>
                      ))}
                    </div>
                  </>
                )}
              </Card>
            );
          })}
        </ul>
      )}

      {filtered.length > visible.length && (
        <Button block onClick={() => setLimit((n) => n + PAGE_SIZE)}>
          عرض {Math.min(PAGE_SIZE, filtered.length - visible.length)} إضافية
        </Button>
      )}
    </div>
  );
}

function FormActions({
  pending, serverError, canSave, onSave, onSaveAnyway, onCancel,
}: {
  pending: boolean;
  serverError: string | null;
  canSave: boolean;
  onSave: () => void;
  onSaveAnyway: () => void;
  onCancel: () => void;
}) {
  // Only a duplicate is overridable; a structural error must be fixed.
  const isDuplicate = Boolean(serverError && serverError.includes('موجود مسبقًا'));

  return (
    <div className="mt-4 flex flex-wrap gap-2">
      <Button
        onClick={onSave}
        disabled={pending || !canSave}
        title={canSave ? undefined : 'أكمل الحقول المطلوبة أولًا'}
        variant="primary"
        className="bg-emerald-600"
      >
        {pending ? '…جارٍ الحفظ' : 'حفظ'}
      </Button>
      {isDuplicate && (
        <Button
          onClick={onSaveAnyway}
          disabled={pending}
          className="border-amber-500 text-amber-700 dark:text-amber-300"
        >
          حفظ رغم التكرار
        </Button>
      )}
      <Button onClick={onCancel} disabled={pending}>
        إلغاء
      </Button>
    </div>
  );
}
