'use client';

/**
 * The exam runner.
 *
 * Owns the session reducer and renders whichever phase is active:
 * briefing -> part intro -> questions -> review -> ... -> results.
 *
 * Takes over the whole viewport: `position: fixed; inset: 0` with a high
 * z-index, so no site header, nav, or footer is reachable. The candidate
 * should not be able to tell there is a website behind this.
 */

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { ExamShell } from './ExamShell';
import { QuestionBlock } from './QuestionBlock';
import { ReviewGrid, ReviewFooter } from './ReviewGrid';
import { ExamStimulus } from './ExamStimulus';
import { ResultsDashboard, type SkillBaseline } from '@/components/results/ResultsDashboard';
import {
  createSession, sessionReducerWithRevision, canGoBack, currentPart, currentScreen,
  currentQuestions, isLastPart, isLastScreen, isScreenLocked, questionCountLabel,
  incompleteIn, allQuestionIds,
} from '@/lib/exam/session';
import { useAttemptSync } from '@/lib/exam/useAttemptSync';
import { openAttempt, submitAttempt } from '@/app/actions/attempts';
import { buildOutcomes } from '@/lib/exam/scoring';
import { SECTION_DEFS, SKILL_BY_ID } from '@/lib/content/taxonomy';
import type { BuiltExam } from '@/lib/exam/buildExam';
import type { OptionKey } from '@/lib/content/schema';

const SYNC_LABEL: Record<string, string> = {
  idle: '',
  saving: '…حفظ',
  saved: '✓ محفوظ',
  error: '⚠ تعذّر الحفظ',
  offline: '⚠ غير متصل',
  disabled: '',
};

const HELP_TEXT = [
  ['⚑ Flag for Review', 'يعلّم السؤال الحالي لتجده بسهولة في شاشة المراجعة قبل نهاية الجزء.'],
  ['Font Size', 'يغيّر حجم خط الأسئلة والقطع.'],
  ['⛶', 'ملء الشاشة الكامل للمتصفح.'],
  ['⏱ Time Remaining', 'لكل جزء مؤقت مستقل. عند انتهائه يُغلق الجزء تلقائيًا وتنتقل للتالي.'],
  ['Next / Back', 'التنقل بين الشاشات. في قسم الاستماع لا يوجد رجوع.'],
  ['Review', 'في نهاية كل جزء (عدا الاستماع) تظهر شاشة مراجعة بحالة كل سؤال.'],
  ['🎧 الاستماع', 'يُشغَّل كل تسجيل مرة واحدة فقط بعد مهلة قراءة قصيرة، ولا يمكن إعادته.'],
] as const;

const SECTION_DIRECTIONS: Record<string, string> = {
  reading: 'اقرأ القطعة في الجهة اليسرى بعناية، ثم أجب عن الأسئلة في الجهة اليمنى.',
  grammar: 'اختر الإجابة التي تُكمل الجملة بشكل صحيح نحويًا.',
  listening: 'استمع إلى التسجيل. سيُشغَّل مرة واحدة فقط، ثم أجب عن الأسئلة.',
  writing: 'اقرأ كل بند بعناية واختر الصياغة الأصح.',
};

export interface ResumeState {
  attemptId: string;
  answers: Record<string, OptionKey>;
  flags: string[];
  partIndex: number;
  screenIndex: number;
  phase: string;
  partTimings: Record<number, unknown>;
  lockedScreens: Record<string, true>;
  revision: number;
}

export interface ExamRunnerProps {
  exam: BuiltExam;
  onExit: () => void;
  /** Persist to Supabase. Off for previews with no database behind them. */
  persist?: boolean;
  userId?: string;
  /** Saved progress to continue from, instead of starting fresh. */
  resume?: ResumeState;
  /** Launch a targeted drill from the study plan. */
  onPractice?: (section: string, count: number) => void;
  /**
   * Per-skill standing BEFORE this sitting, for the practice summary.
   *
   * Purely a pass-through to the results screen — the runner neither
   * reads it nor lets it affect the session. The exam never supplies it.
   */
  skillBaseline?: SkillBaseline[];
}

export function ExamRunner({
  exam, onExit, persist = true, userId, resume, onPractice, skillBaseline,
}: ExamRunnerProps) {
  const [state, dispatch] = useReducer(
    sessionReducerWithRevision,
    exam,
    // Restored sittings re-enter at the PART INTRO, never mid-question:
    // the previous part's clock is gone, so dropping the candidate back
    // into a live question with a fresh timer would hand them extra time.
    (e) => {
      const base = createSession(e);
      if (!resume) return base;
      return {
        ...base,
        answers: resume.answers,
        flags: Object.fromEntries(resume.flags.map((id) => [id, true as const])),
        partIndex: Math.min(resume.partIndex, e.parts.length - 1),
        screenIndex: 0,
        phase: 'part-intro' as const,
        maxPartIndex: Math.min(resume.partIndex, e.parts.length - 1),
        lockedScreens: resume.lockedScreens,
        partTimings: resume.partTimings as typeof base.partTimings,
        revision: resume.revision,
        startedAt: Date.now(),
      };
    },
  );
  const [attemptId, setAttemptId] = useState<string | null>(resume?.attemptId ?? null);
  const [showHelp, setShowHelp] = useState(false);

  const part = currentPart(state);
  const screen = currentScreen(state);
  const questions = useMemo(() => currentQuestions(state), [state]);
  const locked = isScreenLocked(state);

  const stateRef = useRef(state);
  stateRef.current = state;

  // Open the attempt row once. Guarded by a ref because Strict Mode
  // double-invokes effects in development and would create two attempts.
  const openedRef = useRef(false);
  useEffect(() => {
    // A resumed sitting already has its row; opening a second would
    // orphan the first and lose the progress being continued.
    if (!persist || openedRef.current || resume) return;
    openedRef.current = true;

    void openAttempt({
      // The full skeleton, so a resumed sitting is the SAME paper.
      // Content is left out and re-fetched by id on resume.
      skeleton: {
        blueprintId: exam.blueprintId,
        seed: exam.seed,
        nameAr: exam.nameAr,
        instantFeedback: exam.instantFeedback,
        totalSeconds: exam.totalSeconds,
        numberInSection: exam.numberInSection,
        parts: exam.parts.map((p) => ({
          index: p.index,
          section: p.section,
          partNo: p.partNo,
          labelAr: p.labelAr,
          labelEn: p.labelEn,
          screens: p.screens.map((s) => ({
            questionIds: s.questionIds,
            passageId: s.passageId,
            audioClipId: s.audioClipId,
          })),
          questionIds: p.questionIds,
          durationSeconds: p.durationSeconds,
          allowsBack: p.allowsBack,
          allowsReview: p.allowsReview,
        })),
      },
      questionIds: exam.parts.flatMap((p) => p.questionIds),
      totalQuestions: exam.totalQuestions,
      userId,
    }).then((res) => {
      // Persistence is best-effort — a failure here must not block the
      // sitting, so the exam continues locally and the badge shows it.
      if (res.ok && res.attemptId) setAttemptId(res.attemptId);
    });
  }, [persist, exam, userId, resume]);

  const sync = useAttemptSync(attemptId, state);

  // --- stable handlers -------------------------------------------------
  const begin = useCallback(() => dispatch({ type: 'BEGIN', now: Date.now() }), []);
  const startPart = useCallback(() => dispatch({ type: 'START_PART', now: Date.now() }), []);
  const next = useCallback(() => dispatch({ type: 'NEXT', now: Date.now() }), []);
  const back = useCallback(() => dispatch({ type: 'BACK', now: Date.now() }), []);
  const nextPart = useCallback(() => dispatch({ type: 'NEXT_PART', now: Date.now() }), []);
  const expire = useCallback(() => dispatch({ type: 'TIME_EXPIRED', now: Date.now() }), []);
  // Just the transition. Submission is driven by the phase reaching
  // `finished` (see the effect below), so EVERY path that ends the exam —
  // the finish button, quitting early, and a last-part timer expiry that
  // never calls finish() — grades and persists exactly once. Wiring the
  // submit into finish() alone silently dropped the expiry case.
  const finish = useCallback(() => {
    dispatch({ type: 'FINISH', now: Date.now() });
  }, []);

  // Grade and persist on entry to `finished`, once. Guarded by a ref
  // rather than phase-diffing so a re-render cannot double-submit; keyed
  // on attemptId too, so a sitting that finished before its row finished
  // opening still submits the moment the id arrives.
  const flushRef = useRef(sync.flushNow);
  flushRef.current = sync.flushNow;
  const submittedRef = useRef(false);
  useEffect(() => {
    if (state.phase !== 'finished' || !attemptId || submittedRef.current) return;
    submittedRef.current = true;

    // Results are already on screen; grading is a background round trip.
    void (async () => {
      // Flush first so the graded row reflects the final answer, not the
      // one before the debounce window closed.
      await flushRef.current();
      await submitAttempt(
        attemptId,
        stateRef.current.answers,
        allQuestionIds(stateRef.current),
        // Per-question outcomes power every longitudinal analysis.
        buildOutcomes(stateRef.current),
      );
    })();
  }, [state.phase, attemptId]);

  /** End the exam early, matching the legacy quit control. */
  const quitEarly = useCallback(() => {
    const s = stateRef.current;
    const unanswered = allQuestionIds(s).filter((id) => !s.answers[id]).length;
    if (!window.confirm(
      `إنهاء الاختبار الآن؟\nلديك ${unanswered} سؤالًا دون إجابة، وستُحتسب خطأً.`,
    )) return;
    finish();
  }, [finish]);
  const jump = useCallback((screenIndex: number) => dispatch({ type: 'GOTO_SCREEN', screenIndex, now: Date.now() }), []);
  const answer = useCallback(
    (questionId: string, option: OptionKey) => dispatch({ type: 'ANSWER', questionId, option }),
    [],
  );
  const reveal = useCallback(
    (questionId: string) => dispatch({ type: 'REVEAL', questionId }),
    [],
  );

  const screenIds = screen?.questionIds ?? [];
  const anyFlagged = screenIds.some((id) => state.flags[id]);
  const toggleFlag = useCallback(() => {
    for (const id of stateRef.current.exam.parts[stateRef.current.partIndex]
      ?.screens[stateRef.current.screenIndex]?.questionIds ?? []) {
      dispatch({ type: 'TOGGLE_FLAG', questionId: id });
    }
  }, []);

  // Warn on accidental navigation away mid-exam — a refresh loses the
  // sitting, and the browser's own dialog is the only reliable guard.
  useEffect(() => {
    if (state.phase === 'finished' || state.phase === 'briefing') return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [state.phase]);

  const advanceFromReview = useCallback(() => {
    const s = stateRef.current;
    const p = currentPart(s);
    const incomplete = p ? incompleteIn(s, p).length : 0;
    if (incomplete > 0) {
      const msg = isLastPart(s)
        ? `لديك ${incomplete} سؤالًا دون إجابة. هل تريد إنهاء الاختبار؟`
        : `لديك ${incomplete} سؤالًا دون إجابة. الانتقال للجزء التالي؟\nلن تستطيع العودة لهذا الجزء.`;
      if (!window.confirm(msg)) return;
    }
    if (isLastPart(s)) finish();
    else nextPart();
  }, [finish, nextPart]);

  // ---------------------------------------------------------------------
  // finished
  // ---------------------------------------------------------------------
  if (state.phase === 'finished') {
    return (
      <div className="fixed inset-0 z-[100] overflow-y-auto bg-[color:var(--app-bg)] p-4 sm:p-8">
        <div className="mx-auto max-w-5xl">
          {persist && (
            <p className="mb-3 text-center text-xs text-[color:var(--app-muted)]">
              {attemptId ? `${SYNC_LABEL[sync.status] || '✓ محفوظ'} · رقم المحاولة ${attemptId.slice(0, 8)}` : '⚠ لم تُحفظ هذه المحاولة'}
            </p>
          )}
          <ResultsDashboard
            session={state}
            onExit={onExit}
            onPractice={onPractice}
            skillBaseline={skillBaseline}
          />
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------
  // briefing — the last screen before the exam takes over
  // ---------------------------------------------------------------------
  if (state.phase === 'briefing') {
    const sections = [...new Set(exam.parts.map((p) => p.section))];
    return (
      <FullScreenFrame>
        <div className="x-intro">
          <h1>{exam.nameAr}</h1>
          <h3>تعليمات عامة</h3>
          <p>عدد الأسئلة: <b>{exam.totalQuestions}</b></p>
          <p>المدة الكلية: <b>{Math.round(exam.totalSeconds / 60)} دقيقة</b></p>
          <p>عدد الأجزاء: <b>{exam.parts.length}</b></p>

          <ul className="mt-4 space-y-1.5 text-[#333f4b]" dir="rtl">
            {sections.map((sec) => {
              const def = SECTION_DEFS[sec];
              const ps = exam.parts.filter((p) => p.section === sec);
              const qs = ps.reduce((n, p) => n + p.questionIds.length, 0);
              const mins = Math.round(ps.reduce((n, p) => n + p.durationSeconds, 0) / 60);
              return (
                <li key={sec}>
                  <b>{def.nameAr}</b> — {qs} سؤالًا · {mins} دقيقة · {ps.length} أجزاء
                  {!def.allowsBack && <span className="text-[#c0392b]"> · لا يمكن الرجوع</span>}
                </li>
              );
            })}
          </ul>

          <p className="mt-4 text-[#5a6b7a]" dir="rtl">
            ⏱ لكل جزء مؤقت مستقل. بعد الانتقال لجزء جديد لا يمكنك العودة للسابق.
            <br />
            🎧 في قسم الاستماع يُشغَّل كل تسجيل <b>مرة واحدة فقط</b> ولا يمكن الرجوع للأسئلة السابقة.
          </p>
        </div>

        <div className="x-footer">
          <button type="button" className="x-btn x-btn--go" onClick={begin}>
            ابدأ الاختبار &gt;
          </button>
          <span className="flex-1" />
          <button type="button" className="x-btn x-btn--dim" onClick={() => setShowHelp(true)}>
            Help | ？
          </button>
          <button type="button" className="x-btn x-btn--dim" onClick={onExit}>
            ✕ خروج
          </button>
        </div>
        {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
      </FullScreenFrame>
    );
  }

  if (!part) return null;

  // ---------------------------------------------------------------------
  // part intro
  // ---------------------------------------------------------------------
  if (state.phase === 'part-intro') {
    return (
      <FullScreenFrame>
        <div className="x-intro">
          <h1>{part.labelEn} - Part {part.partNo}</h1>
          <h3>{part.labelAr}</h3>
          <p dir="rtl">{SECTION_DIRECTIONS[part.section]}</p>
          <p>عدد الأسئلة: <b>{part.questionIds.length}</b></p>
          <p>الوقت: <b>{Math.round(part.durationSeconds / 60)} دقيقة</b></p>
          {!part.allowsBack && (
            <p dir="rtl" className="text-[#c0392b]">
              <b>تنبيه:</b> في هذا القسم لا يمكنك العودة لسؤال سابق.
            </p>
          )}
          <p className="text-[#5a6b7a]" dir="rtl">⏱ يبدأ المؤقت فور الضغط على «ابدأ».</p>
        </div>

        <div className="x-footer">
          <button type="button" className="x-btn x-btn--go" onClick={startPart}>ابدأ &gt;</button>
          <span className="flex-1" />
          <span className="px-5 py-4 text-sm text-white/70">
            الجزء {state.partIndex + 1} من {exam.parts.length}
          </span>
          <button type="button" className="x-btn x-btn--dim" onClick={() => setShowHelp(true)}>
            Help | ？
          </button>
        </div>
        {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
      </FullScreenFrame>
    );
  }

  // ---------------------------------------------------------------------
  // review grid
  // ---------------------------------------------------------------------
  if (state.phase === 'review') {
    return (
      <ExamShell
        fullScreen
        deadlineAt={state.deadlineAt}
        onTimeExpired={expire}
        questionLabel={questionCountLabel(state)}
        footer={null}
        footerOverride={
          <ReviewFooter
            isLastPart={isLastPart(state)}
            hasFlagged={part.questionIds.some((id) => state.flags[id])}
            hasIncomplete={part.questionIds.some((id) => !state.answers[id])}
            onAdvance={advanceFromReview}
            onReviewAll={() => jump(0)}
            onReviewIncomplete={() => {
              const i = part.screens.findIndex((sc) => sc.questionIds.some((id) => !state.answers[id]));
              if (i >= 0) jump(i);
            }}
            onReviewFlagged={() => {
              const i = part.screens.findIndex((sc) => sc.questionIds.some((id) => state.flags[id]));
              if (i >= 0) jump(i);
            }}
          />
        }
      >
        <ReviewGrid session={state} part={part} isLastPart={isLastPart(state)} onJumpToScreen={jump} />
      </ExamShell>
    );
  }

  // ---------------------------------------------------------------------
  // questions
  // ---------------------------------------------------------------------
  const lastScreen = isLastScreen(state);
  const nextLabel = lastScreen
    ? part.allowsReview ? 'Review >' : isLastPart(state) ? 'Finish ✓' : 'Next Part >'
    : 'Next >';

  const stimulusQuestion = questions[0];

  return (
    <ExamShell
      fullScreen
      deadlineAt={state.deadlineAt}
      onTimeExpired={expire}
      questionLabel={questionCountLabel(state)}
      showFlag
      flagged={anyFlagged}
      onToggleFlag={toggleFlag}
      stimulus={
        <ExamStimulus
          // Keyed by stimulus identity, not screen index: moving between
          // two questions on one clip must not remount the player and
          // replay the recording.
          key={screen?.audioClipId ?? screen?.passageId ?? `s${state.partIndex}-${state.screenIndex}`}
          passageText={screen?.passageId ? exam.passages?.[screen.passageId]?.body : undefined}
          audioUrl={screen?.audioClipId ? exam.audioUrls?.[screen.audioClipId] : undefined}
          imageUrl={stimulusQuestion?.imageUrl}
          imageAlt={stimulusQuestion?.imageAlt}
          instructions={SECTION_DIRECTIONS[part.section]}
        />
      }
      footer={
        <div className="flex w-full flex-wrap items-stretch">
          <button type="button" className="x-btn x-btn--go" onClick={next}>{nextLabel}</button>
          {part.allowsBack && (
            <button type="button" className="x-btn" onClick={back} disabled={!canGoBack(state)}>
              &lt; Back
            </button>
          )}
          <span className="flex-1" />
          <span className="px-3 py-4 text-xs text-white/60">
            {part.labelEn} · Part {part.partNo}/{exam.parts.filter((p) => p.section === part.section).length}
            {persist && sync.status !== 'disabled' && (
              <span className="mr-2">{SYNC_LABEL[sync.status]}</span>
            )}
          </span>
          <button type="button" className="x-btn x-btn--dim" onClick={() => setShowHelp(true)}>
            Help | ？
          </button>
          <button type="button" className="x-btn x-btn--dim" onClick={quitEarly}>
            ✕ إنهاء
          </button>
        </div>
      }
    >
      {questions.map((q) => (
        <div key={q.id}>
          <QuestionBlock
            number={state.exam.numberInSection[q.id]}
            questionText={q.text}
            options={q.options}
            selected={state.answers[q.id]}
            disabled={locked || Boolean(state.revealed[q.id])}
            onSelect={(opt) => answer(q.id, opt)}
          />

          {/* Practice mode only: feedback after each answer. */}
          {exam.instantFeedback && state.answers[q.id] && (
            state.revealed[q.id] ? (
              <div
                dir="rtl"
                className={`mb-4 rounded-xl px-4 py-3 text-[0.95rem] leading-[1.9] ${
                  state.answers[q.id] === q.correctOption
                    ? 'bg-[#e3f1e8] text-[#1c4a30]'
                    : 'bg-[#f9e5e2] text-[#7a2018]'
                }`}
              >
                <b className="mb-1 block">
                  {state.answers[q.id] === q.correctOption
                    ? '✓ إجابة صحيحة'
                    : `✗ الإجابة الصحيحة هي ${q.correctOption}`}
                </b>
                {q.explanationAr ?? 'لا يوجد شرح لهذا السؤال بعد.'}
                {/* Naming the skill is what turns a wrong answer into a
                    study target — without it the learner knows they
                    missed one but not what to go work on. */}
                {SKILL_BY_ID[q.skillId] && (
                  <span className="mt-2 block text-xs opacity-75">
                    المهارة: {SKILL_BY_ID[q.skillId].nameAr}
                  </span>
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => reveal(q.id)}
                className="mb-4 rounded-lg border border-[#c8d2db] px-4 py-2 text-sm font-semibold text-[#01589b]"
              >
                تحقّق من الإجابة
              </button>
            )
          )}
        </div>
      ))}
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
    </ExamShell>
  );
}

/** Help overlay. Sits above the exam chrome but never unmounts it. */
function HelpModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/55 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="مساعدة"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-6"
        dir="rtl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-lg font-bold text-[#01589b]">مساعدة</h2>
        <dl className="space-y-3">
          {HELP_TEXT.map(([term, desc]) => (
            <div key={term} className="rounded-xl bg-[#f2f5f7] px-4 py-3">
              <dt className="mb-0.5 font-bold text-[#1c2733]" dir="ltr">{term}</dt>
              <dd className="text-sm leading-[1.8] text-[#333f4b]">{desc}</dd>
            </div>
          ))}
        </dl>
        <button
          type="button"
          onClick={onClose}
          className="mt-5 w-full rounded-xl bg-[#01589b] py-2.5 font-bold text-white"
        >
          إغلاق
        </button>
      </div>
    </div>
  );
}

/** Bare fullscreen chrome for the briefing and part-intro screens. */
function FullScreenFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-white">
      <div className="x-header">
        <span className="whitespace-nowrap rounded-md bg-white px-3 py-[3px] text-[0.85rem] font-extrabold text-[#01589b]">
          STEP PRO
        </span>
        <span className="min-w-[140px] flex-1 text-center font-bold" />
      </div>
      <div className="flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}
