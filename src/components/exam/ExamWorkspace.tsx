'use client';

/**
 * The exam workspace: owns the reducer and renders the current phase.
 *
 * Performance notes — the visuals are locked, so all the engineering
 * budget goes underneath them:
 *  - state lives in one useReducer; illegal actions return the same
 *    object, so React bails out of re-rendering entirely;
 *  - the countdown is isolated in <ExamTimer/>, so 1Hz ticks never touch
 *    the question list, passage, or audio element;
 *  - every dispatch handler is a stable useCallback, and the heavy
 *    children are memo()'d, so answering question 3 does not re-render
 *    the passage or restart the audio;
 *  - the audio element is keyed by audioId, so navigating between
 *    questions on the SAME clip does not remount the player and restart
 *    playback — which would let a candidate hear it twice.
 */

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { ExamShell } from './ExamShell';
import { ResultsDashboard } from '@/components/results/ResultsDashboard';
import { useAttemptSync } from '@/lib/exam/useAttemptSync';
import { startAttempt, submitAttempt } from '@/app/exam/actions';
import { QuestionBlock } from './QuestionBlock';
import { ReviewGrid, ReviewFooter } from './ReviewGrid';
import { ExamStimulus, SECTION_INSTRUCTIONS } from './ExamStimulus';
import {
  createExamState,
  examReducerWithRevision,
  canGoBack,
  currentPart,
  currentRule,
  currentScreen,
  isLastPart,
  isLastScreen,
  isScreenLocked,
  questionCountLabel,
  scoreExam,
} from '@/lib/exam/engine';
import type { ExamQuestion, OptionKey } from '@/lib/exam/types';

export interface ExamWorkspaceProps {
  questions: ExamQuestion[];
  totalMinutes: number;
  /** Set false for demo routes with no Supabase behind them. */
  persist?: boolean;
  userId?: string;
  onSubmit?: (payload: { answers: Record<string, OptionKey>; flags: string[] }) => void;
}

const SYNC_LABEL: Record<string, string> = {
  idle: '',
  saving: '…جارٍ الحفظ',
  saved: '✓ محفوظ',
  error: '⚠ تعذّر الحفظ',
  offline: '⚠ غير متصل',
};

export function ExamWorkspace({
  questions,
  totalMinutes,
  persist = false,
  userId,
  onSubmit,
}: ExamWorkspaceProps) {
  const [state, dispatch] = useReducer(
    examReducerWithRevision,
    undefined,
    // Lazy init: buildParts runs once, not on every render.
    () => createExamState(questions, { totalMinutes }),
  );

  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [serverScore, setServerScore] = useState<{ correct: number; total: number; weighted: number }>();

  // Open the attempt row once, on mount. Guarded by a ref because React
  // Strict Mode double-invokes effects in development and would
  // otherwise create two attempts per exam.
  const openedRef = useRef(false);
  useEffect(() => {
    if (!persist || openedRef.current) return;
    openedRef.current = true;

    void startAttempt(
      {
        parts: state.parts,
        questionIds: Object.keys(state.questions),
        totalMinutes,
      },
      userId,
    ).then((res) => {
      if (res.ok && res.attemptId) setAttemptId(res.attemptId);
    });
    // Intentionally mount-only: the blueprint is frozen at creation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persist]);

  const sync = useAttemptSync(attemptId, state);

  // Current state for callbacks that must not be recreated per change.
  const stateRef = useRef(state);
  stateRef.current = state;

  const part = currentPart(state);
  const rule = currentRule(state);
  const screen = currentScreen(state);

  const screenQuestions = useMemo(
    () => screen.map((id) => state.questions[id]).filter(Boolean),
    [screen, state.questions],
  );

  const locked = isScreenLocked(state, state.partIndex, state.screenIndex);
  const lastScreen = isLastScreen(state);
  const lastPart = isLastPart(state);

  // --- stable handlers -------------------------------------------------
  const start = useCallback(() => dispatch({ type: 'START_PART', now: Date.now() }), []);
  const next = useCallback(() => dispatch({ type: 'NEXT', now: Date.now() }), []);
  const back = useCallback(() => dispatch({ type: 'BACK' }), []);
  const nextPart = useCallback(() => dispatch({ type: 'NEXT_PART', now: Date.now() }), []);
  const expire = useCallback(() => dispatch({ type: 'TIME_EXPIRED', now: Date.now() }), []);
  const jump = useCallback((screenIndex: number) => dispatch({ type: 'GOTO_SCREEN', screenIndex }), []);
  const answer = useCallback(
    (questionId: string, option: OptionKey) => dispatch({ type: 'ANSWER', questionId, option }),
    [],
  );

  const finish = useCallback(() => {
    dispatch({ type: 'FINISH', now: Date.now() });

    // Show the dashboard immediately; grade in the background. Making
    // the candidate wait on a round trip to see their score would be the
    // one moment of lag they actually notice.
    if (!persist || !attemptId) {
      onSubmit?.({ answers: stateRef.current.answers, flags: Object.keys(stateRef.current.flags) });
      return;
    }

    void (async () => {
      // Flush first so the graded row reflects the final answer, not the
      // one before the debounce window closed.
      await sync.flushNow();
      const res = await submitAttempt(attemptId, stateRef.current.answers);
      if (res.ok) {
        setServerScore({ correct: res.correct ?? 0, total: res.total ?? 0, weighted: res.weighted ?? 0 });
      }
      onSubmit?.({ answers: stateRef.current.answers, flags: Object.keys(stateRef.current.flags) });
    })();
  }, [persist, attemptId, sync, onSubmit]);

  /**
   * Leaving a part is irreversible, so an incomplete part is confirmed
   * first — matching the legacy prompt. Lives here rather than in
   * ReviewGrid so the grid stays a pure presentational component.
   */
  const advanceFromReview = useCallback(() => {
    const p = currentPart(state);
    const incomplete = p ? p.questionIds.filter((id) => !state.answers[id]).length : 0;
    if (incomplete > 0) {
      const msg = lastPart
        ? `You still have ${incomplete} incomplete question(s). Finish the exam?`
        : `You still have ${incomplete} incomplete question(s). Continue to the next part?\nلن تستطيع العودة لهذا الجزء.`;
      if (!window.confirm(msg)) return;
    }
    if (lastPart) finish();
    else nextPart();
  }, [state, lastPart, finish, nextPart]);

  // Flag applies to every question on the current screen, matching the
  // legacy behaviour where the flag is per-screen not per-question.
  const anyFlagged = screen.some((id) => state.flags[id]);
  const toggleFlag = useCallback(() => {
    for (const id of screen) dispatch({ type: 'TOGGLE_FLAG', questionId: id });
  }, [screen]);

  // --- finished --------------------------------------------------------
  if (state.phase === 'finished') {
    return (
      <ResultsDashboard
        state={state}
        serverScore={serverScore}
        saveStatus={persist ? (attemptId ? SYNC_LABEL[sync.status] : '⚠ لم يُحفظ') : undefined}
      />
    );
  }

  if (!part || !rule) return null;

  // --- part intro ------------------------------------------------------
  if (state.phase === 'intro') {
    return (
      <ExamShell
        secondsRemaining={0}
        deadlineAt={null}
        onTimeExpired={expire}
        questionLabel=""
        footer={
          <div className="flex w-full flex-wrap items-stretch">
            <button type="button" className="x-btn x-btn--go" onClick={start}>Start &gt;</button>
            <span className="flex-1" />
            <button type="button" className="x-btn x-btn--dim">Help | ？</button>
          </div>
        }
      >
        <div className="x-intro">
          <h1>{part.labelEn} - Part {part.partNo}</h1>
          <h3>Directions</h3>
          <p>{SECTION_INSTRUCTIONS[part.section]}</p>
          <p>Questions: <b>{part.questionIds.length}</b></p>
          <p>Time: <b>{Math.round(part.durationSeconds / 60)}.00 Minutes</b></p>
          {!rule.allowsBack && (
            <p><b>Note:</b> in this section you cannot return to a previous question.</p>
          )}
          <p className="text-[#5a6b7a]">
            ⏱ The timer starts when you press Start. You cannot return to a part after leaving it.
          </p>
        </div>
      </ExamShell>
    );
  }

  // --- review grid -----------------------------------------------------
  if (state.phase === 'review') {
    return (
      <ExamShell
        secondsRemaining={0}
        deadlineAt={state.deadlineAt}
        onTimeExpired={expire}
        questionLabel={questionCountLabel(state)}
        footer={<div className="flex w-full" />}
        footerOverride={
          <ReviewFooter
            isLastPart={lastPart}
            hasFlagged={part.questionIds.some((id) => state.flags[id])}
            hasIncomplete={part.questionIds.some((id) => !state.answers[id])}
            onAdvance={advanceFromReview}
            onReviewAll={() => jump(0)}
            onReviewIncomplete={() => {
              const i = part.screens.findIndex((sc) => sc.some((id) => !state.answers[id]));
              if (i >= 0) jump(i);
            }}
            onReviewFlagged={() => {
              const i = part.screens.findIndex((sc) => sc.some((id) => state.flags[id]));
              if (i >= 0) jump(i);
            }}
          />
        }
      >
        <ReviewGrid state={state} part={part} isLastPart={lastPart} onJumpToScreen={jump} />
      </ExamShell>
    );
  }

  // --- question --------------------------------------------------------
  const nextLabel = lastScreen
    ? rule.allowsReview ? 'Review >' : lastPart ? 'Finish ✓' : 'Next Part >'
    : 'Next >';

  return (
    <ExamShell
      secondsRemaining={0}
      deadlineAt={state.deadlineAt}
      onTimeExpired={expire}
      title=""
      questionLabel={questionCountLabel(state)}
      showFlag
      flagged={anyFlagged}
      onToggleFlag={toggleFlag}
      stimulus={
        <ExamStimulus
          // Keyed by stimulus identity, NOT by screen index: moving
          // between questions on one audio clip must not remount the
          // player and replay the recording.
          key={screenQuestions[0]?.audioId ?? screenQuestions[0]?.passageId ?? `s${state.partIndex}-${state.screenIndex}`}
          question={screenQuestions[0]}
          instructions={SECTION_INSTRUCTIONS[part.section]}
        />
      }
      footer={
        <div className="flex w-full flex-wrap items-stretch">
          <button type="button" className="x-btn x-btn--go" onClick={next}>{nextLabel}</button>
          {rule.allowsBack && (
            <button type="button" className="x-btn" onClick={back} disabled={!canGoBack(state)}>
              &lt; Back
            </button>
          )}
          <span className="flex-1" />
          <button type="button" className="x-btn x-btn--dim">Help | ？</button>
        </div>
      }
    >
      {screenQuestions.map((q) => (
        <QuestionBlock
          key={q.id}
          number={state.numberInSection[q.id]}
          questionText={q.questionText}
          options={q.options}
          selected={state.answers[q.id]}
          disabled={locked}
          onSelect={(opt) => answer(q.id, opt)}
        />
      ))}
    </ExamShell>
  );
}

function FinishedView({
  score,
  onSubmit,
}: {
  score: ReturnType<typeof scoreExam>;
  onSubmit: () => void;
}) {
  return (
    <div className="x-shell">
      <div className="x-header"><span className="flex-1 text-center font-bold">Exam Complete</span></div>
      <div className="x-intro">
        <h1>Result</h1>
        <p>Weighted score: <b>{score.weightedPct.toFixed(1)}%</b></p>
        <p>Raw: {score.correct} / {score.total} ({score.rawPct.toFixed(1)}%)</p>
        <ul className="mt-4 space-y-1">
          {Object.entries(score.bySection).map(([sec, v]) => (
            <li key={sec}>
              {sec} — {v.correct}/{v.total} ({v.pct.toFixed(0)}%) · weight {v.weightPct}%
            </li>
          ))}
        </ul>
      </div>
      <div className="x-footer">
        <button type="button" className="x-btn x-btn--go" onClick={onSubmit}>Save Result ✓</button>
      </div>
    </div>
  );
}
