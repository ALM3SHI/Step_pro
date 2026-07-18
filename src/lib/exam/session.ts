/**
 * Exam session state.
 *
 * Rebuilt on top of BuiltExam so the blueprint — not the shape of the
 * question bank — decides the exam. Still a pure reducer with no React:
 * these are exam-integrity rules (one-way part locking, forward-only
 * listening, timer expiry) and they are worth testing without a DOM.
 *
 * Illegal transitions return the SAME state object, so React bails out
 * of re-rendering and the sync layer sees no change.
 */

import type { BuiltExam, ExamPart } from './buildExam';
import type { OptionKey, Question } from '../content/schema';

export type SessionPhase = 'briefing' | 'part-intro' | 'question' | 'review' | 'finished';

export interface PartTiming {
  partIndex: number;
  startedAt: number;
  endedAt: number | null;
  allocatedSeconds: number;
  expired: boolean;
}

export interface SessionState {
  exam: BuiltExam;
  phase: SessionPhase;
  partIndex: number;
  screenIndex: number;

  /**
   * Epoch ms when the current part expires. A DEADLINE, not a counter:
   * storing seconds-remaining would rewrite state every second and
   * re-render the whole exam at 1Hz.
   */
  deadlineAt: number | null;

  answers: Record<string, OptionKey>;
  flags: Record<string, true>;
  /** Practice mode: questions whose feedback has been revealed. */
  revealed: Record<string, true>;

  /** Highest part entered — the one-way lock. */
  maxPartIndex: number;
  /** Listening screens already passed; permanently immutable. */
  lockedScreens: Record<string, true>;

  partTimings: Record<number, PartTiming>;
  /** Bumped per accepted change, for ordered background sync. */
  revision: number;
  startedAt: number | null;
  finishedAt: number | null;
}

export type SessionAction =
  | { type: 'BEGIN'; now: number }
  | { type: 'START_PART'; now: number }
  | { type: 'ANSWER'; questionId: string; option: OptionKey }
  | { type: 'REVEAL'; questionId: string }
  | { type: 'TOGGLE_FLAG'; questionId: string }
  | { type: 'NEXT'; now: number }
  | { type: 'BACK' }
  | { type: 'GOTO_SCREEN'; screenIndex: number }
  | { type: 'NEXT_PART'; now: number }
  | { type: 'TIME_EXPIRED'; now: number }
  | { type: 'FINISH'; now: number };

export function createSession(exam: BuiltExam): SessionState {
  return {
    exam,
    phase: 'briefing',
    partIndex: 0,
    screenIndex: 0,
    deadlineAt: null,
    answers: {},
    flags: {},
    revealed: {},
    maxPartIndex: 0,
    lockedScreens: {},
    partTimings: {},
    revision: 0,
    startedAt: null,
    finishedAt: null,
  };
}

// --- selectors ---------------------------------------------------------

export const currentPart = (s: SessionState): ExamPart | undefined => s.exam.parts[s.partIndex];
export const currentScreen = (s: SessionState) => currentPart(s)?.screens[s.screenIndex];
export const currentQuestions = (s: SessionState): Question[] =>
  (currentScreen(s)?.questionIds ?? []).map((id) => s.exam.questions[id]).filter(Boolean);

export const isLastScreen = (s: SessionState) => {
  const p = currentPart(s);
  return !p || s.screenIndex >= p.screens.length - 1;
};
export const isLastPart = (s: SessionState) => s.partIndex >= s.exam.parts.length - 1;

export const screenKey = (partIndex: number, screenIndex: number) => `${partIndex}:${screenIndex}`;
export const isScreenLocked = (s: SessionState, part = s.partIndex, screen = s.screenIndex) =>
  Boolean(s.lockedScreens[screenKey(part, screen)]);

export const canGoBack = (s: SessionState) =>
  s.phase === 'question' && Boolean(currentPart(s)?.allowsBack) && s.screenIndex > 0;

/** Header label, e.g. "Questions 5-7 of 40". */
export function questionCountLabel(s: SessionState): string {
  const part = currentPart(s);
  const screen = currentScreen(s);
  if (!part || !screen?.questionIds.length) return '';

  const totalInSection = s.exam.parts
    .filter((p) => p.section === part.section)
    .reduce((n, p) => n + p.questionIds.length, 0);

  const nums = screen.questionIds.map((id) => s.exam.numberInSection[id]).filter(Boolean);
  if (!nums.length) return '';
  const lo = Math.min(...nums);
  const hi = Math.max(...nums);
  return lo === hi
    ? `Question ${lo} of ${totalInSection}`
    : `Questions ${lo}-${hi} of ${totalInSection}`;
}

export const incompleteIn = (s: SessionState, part: ExamPart) =>
  part.questionIds.filter((id) => !s.answers[id]);

export const flaggedIn = (s: SessionState, part: ExamPart) =>
  part.questionIds.filter((id) => s.flags[id]);

/** Every question id in the exam, in presentation order. */
export const allQuestionIds = (s: SessionState) =>
  s.exam.parts.flatMap((p) => p.questionIds);

// --- reducer -----------------------------------------------------------

function openPart(state: SessionState, partIndex: number, now: number): SessionState {
  const part = state.exam.parts[partIndex];
  if (!part) return state;

  return {
    ...state,
    partIndex,
    screenIndex: 0,
    phase: 'question',
    deadlineAt: now + part.durationSeconds * 1000,
    maxPartIndex: Math.max(state.maxPartIndex, partIndex),
    partTimings: {
      ...state.partTimings,
      // Re-entering keeps the original start, so a resumed attempt
      // cannot reset its own clock.
      [partIndex]: state.partTimings[partIndex] ?? {
        partIndex,
        startedAt: now,
        endedAt: null,
        allocatedSeconds: part.durationSeconds,
        expired: false,
      },
    },
    startedAt: state.startedAt ?? now,
  };
}

function closeTiming(state: SessionState, now: number, expired: boolean) {
  const t = state.partTimings[state.partIndex];
  if (!t || t.endedAt !== null) return state.partTimings;
  return { ...state.partTimings, [state.partIndex]: { ...t, endedAt: now, expired } };
}

function advance(state: SessionState, now: number, expired = false): SessionState {
  const partTimings = closeTiming(state, now, expired);
  const closed = { ...state, partTimings };

  if (isLastPart(state)) {
    return { ...closed, phase: 'finished', deadlineAt: null, finishedAt: now };
  }
  // A part boundary gets its own intro screen, matching the real exam
  // where each part is announced before its clock starts.
  return {
    ...closed,
    partIndex: state.partIndex + 1,
    screenIndex: 0,
    phase: 'part-intro',
    deadlineAt: null,
    maxPartIndex: Math.max(state.maxPartIndex, state.partIndex + 1),
  };
}

export function sessionReducer(state: SessionState, action: SessionAction): SessionState {
  switch (action.type) {
    case 'BEGIN':
      if (state.phase !== 'briefing') return state;
      return { ...state, phase: 'part-intro' };

    case 'START_PART':
      if (state.phase !== 'part-intro') return state;
      return openPart(state, state.partIndex, action.now);

    case 'ANSWER': {
      if (state.phase !== 'question') return state;
      const part = currentPart(state);
      if (!part?.questionIds.includes(action.questionId)) return state;
      // A passed listening screen is immutable, even if re-rendered.
      if (isScreenLocked(state)) return state;
      // Practice: once feedback is shown, the answer is committed.
      if (state.exam.instantFeedback && state.revealed[action.questionId]) return state;

      const q = state.exam.questions[action.questionId];
      if (!q?.options[action.option]?.trim()) return state;
      if (state.answers[action.questionId] === action.option) return state;

      return { ...state, answers: { ...state.answers, [action.questionId]: action.option } };
    }

    case 'REVEAL': {
      if (!state.exam.instantFeedback) return state;
      if (!state.answers[action.questionId]) return state;
      if (state.revealed[action.questionId]) return state;
      return { ...state, revealed: { ...state.revealed, [action.questionId]: true as const } };
    }

    case 'TOGGLE_FLAG': {
      const part = currentPart(state);
      if (!part?.questionIds.includes(action.questionId)) return state;
      const flags = { ...state.flags };
      if (flags[action.questionId]) delete flags[action.questionId];
      else flags[action.questionId] = true as const;
      return { ...state, flags };
    }

    case 'NEXT': {
      if (state.phase !== 'question') return state;
      const part = currentPart(state);
      if (!part) return state;

      // Listening: passing a screen locks it permanently.
      const lockedScreens: Record<string, true> = part.allowsBack
        ? state.lockedScreens
        : { ...state.lockedScreens, [screenKey(state.partIndex, state.screenIndex)]: true as const };

      if (!isLastScreen(state)) {
        return { ...state, screenIndex: state.screenIndex + 1, lockedScreens };
      }
      if (part.allowsReview) return { ...state, phase: 'review', lockedScreens };
      return advance({ ...state, lockedScreens }, action.now);
    }

    case 'BACK':
      if (!canGoBack(state)) return state;
      return { ...state, screenIndex: state.screenIndex - 1 };

    case 'GOTO_SCREEN': {
      const part = currentPart(state);
      // Jumping is a review-grid affordance; sections without a review
      // grid must not expose it.
      if (!part?.allowsReview) return state;
      if (action.screenIndex < 0 || action.screenIndex >= part.screens.length) return state;
      return { ...state, phase: 'question', screenIndex: action.screenIndex };
    }

    case 'NEXT_PART':
      if (state.phase !== 'review') return state;
      return advance(state, action.now);

    case 'TIME_EXPIRED':
      if (state.phase === 'finished' || state.phase === 'briefing' || state.phase === 'part-intro') return state;
      // Expiry skips the review grid entirely — the part is over.
      return advance(state, action.now, true);

    case 'FINISH':
      if (state.phase === 'finished') return state;
      return {
        ...state,
        partTimings: closeTiming(state, action.now, false),
        phase: 'finished',
        deadlineAt: null,
        finishedAt: action.now,
      };

    default:
      return state;
  }
}

/** Public reducer: bumps `revision` exactly once per ACCEPTED change. */
export function sessionReducerWithRevision(state: SessionState, action: SessionAction): SessionState {
  const next = sessionReducer(state, action);
  if (next === state) return state;
  return { ...next, revision: state.revision + 1 };
}
