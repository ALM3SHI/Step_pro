/**
 * The exam state machine.
 *
 * A pure reducer, deliberately free of React: the Qiyas rules (one-way
 * part locking, asymmetric listening navigation, timer expiry) are exam
 * integrity constraints, and they are testable here without rendering
 * anything. Every illegal transition is a no-op that returns the SAME
 * state object, so React bails out of re-rendering for free.
 */

import { SECTION_RULES, type ExamAction, type ExamPart, type ExamQuestion, type ExamState, type OptionKey } from './types';
import { buildParts, type BuildOptions } from './buildParts';

export function createExamState(questions: ExamQuestion[], opts: BuildOptions): ExamState {
  const { parts, byId, numberInSection } = buildParts(questions, opts);

  return {
    parts,
    questions: byId,
    numberInSection,
    partIndex: 0,
    screenIndex: 0,
    phase: 'intro',
    deadlineAt: null,
    answers: {},
    flags: {},
    maxPartIndex: 0,
    lockedScreens: {},
    partTimings: {},
    revision: 0,
    startedAt: null,
    finishedAt: null,
  };
}

// --- selectors ---------------------------------------------------------

export const currentPart = (s: ExamState): ExamPart | undefined => s.parts[s.partIndex];
export const currentRule = (s: ExamState) => {
  const p = currentPart(s);
  return p ? SECTION_RULES[p.section] : null;
};
export const currentScreen = (s: ExamState): string[] => currentPart(s)?.screens[s.screenIndex] ?? [];

export const isLastScreen = (s: ExamState): boolean => {
  const p = currentPart(s);
  return !p || s.screenIndex >= p.screens.length - 1;
};
export const isLastPart = (s: ExamState): boolean => s.partIndex >= s.parts.length - 1;

/** Back is available only in bidirectional sections, and not on screen 0. */
export const canGoBack = (s: ExamState): boolean => {
  const rule = currentRule(s);
  if (!rule || !rule.allowsBack) return false;
  if (s.phase !== 'question') return false;
  return s.screenIndex > 0;
};

export const screenKey = (partIndex: number, screenIndex: number) => `${partIndex}:${screenIndex}`;

export const isScreenLocked = (s: ExamState, partIndex: number, screenIndex: number): boolean =>
  Boolean(s.lockedScreens[screenKey(partIndex, screenIndex)]);

export const incompleteIn = (s: ExamState, part: ExamPart): string[] =>
  part.questionIds.filter((id) => !s.answers[id]);

export const flaggedIn = (s: ExamState, part: ExamPart): string[] =>
  part.questionIds.filter((id) => s.flags[id]);

/** Header label, e.g. "Questions 5-7 of 40". */
export function questionCountLabel(s: ExamState): string {
  const part = currentPart(s);
  if (!part) return '';
  const screen = currentScreen(s);
  if (!screen.length) return '';

  const totalInSection = s.parts
    .filter((p) => p.section === part.section)
    .reduce((n, p) => n + p.questionIds.length, 0);

  const nums = screen.map((id) => s.numberInSection[id]).filter(Boolean);
  if (!nums.length) return '';
  const lo = Math.min(...nums);
  const hi = Math.max(...nums);
  return lo === hi
    ? `Question ${lo} of ${totalInSection}`
    : `Questions ${lo}-${hi} of ${totalInSection}`;
}

// --- reducer -----------------------------------------------------------

function startPart(state: ExamState, partIndex: number, now: number): ExamState {
  const part = state.parts[partIndex];
  if (!part) return state;

  return {
    ...state,
    partIndex,
    screenIndex: 0,
    phase: 'question',
    deadlineAt: now + part.durationSeconds * 1000,
    // maxPartIndex only ever moves forward — it is the lock.
    maxPartIndex: Math.max(state.maxPartIndex, partIndex),
    partTimings: {
      ...state.partTimings,
      // Re-entering an already-timed part keeps the original start, so a
      // resumed attempt cannot reset its own clock.
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

/** Stamp the current part as finished. */
function closeTiming(state: ExamState, now: number, expired: boolean): ExamState['partTimings'] {
  const existing = state.partTimings[state.partIndex];
  if (!existing || existing.endedAt !== null) return state.partTimings;
  return {
    ...state.partTimings,
    [state.partIndex]: { ...existing, endedAt: now, expired },
  };
}

/**
 * Advance out of the current part.
 *
 * Used by both the explicit "Next Part" action and by timer expiry, so
 * the two paths cannot drift apart.
 */
function advancePart(state: ExamState, now: number, expired = false): ExamState {
  const partTimings = closeTiming(state, now, expired);
  const closed = { ...state, partTimings };

  if (isLastPart(state)) {
    return { ...closed, phase: 'finished', deadlineAt: null, finishedAt: now };
  }
  return startPart(closed, state.partIndex + 1, now);
}

/** Lock every screen in the current part (listening only). */
function lockCurrentScreen(state: ExamState): Record<string, true> {
  return { ...state.lockedScreens, [screenKey(state.partIndex, state.screenIndex)]: true };
}

export function examReducer(state: ExamState, action: ExamAction): ExamState {
  switch (action.type) {
    case 'START_PART': {
      if (state.phase !== 'intro') return state;
      return startPart(state, state.partIndex, action.now);
    }

    case 'ANSWER': {
      if (state.phase !== 'question') return state;
      const part = currentPart(state);
      if (!part || !part.questionIds.includes(action.questionId)) return state;

      // A locked listening screen cannot be edited, even if the client
      // somehow renders it. This is the integrity rule, not a UI detail.
      if (isScreenLocked(state, state.partIndex, state.screenIndex)) return state;

      const q = state.questions[action.questionId];
      if (!q || !q.options[action.option]?.trim()) return state;
      if (state.answers[action.questionId] === action.option) return state;

      return { ...state, answers: { ...state.answers, [action.questionId]: action.option } };
    }

    case 'TOGGLE_FLAG': {
      const part = currentPart(state);
      if (!part || !part.questionIds.includes(action.questionId)) return state;

      const flags = { ...state.flags };
      if (flags[action.questionId]) delete flags[action.questionId];
      else flags[action.questionId] = true;
      return { ...state, flags };
    }

    case 'NEXT': {
      if (state.phase !== 'question') return state;
      const rule = currentRule(state);
      if (!rule) return state;

      // Listening: passing a screen locks it permanently.
      const lockedScreens = rule.allowsBack ? state.lockedScreens : lockCurrentScreen(state);

      if (!isLastScreen(state)) {
        return { ...state, screenIndex: state.screenIndex + 1, lockedScreens };
      }

      // End of part. Bidirectional sections stop at the review grid;
      // listening has no review screen and advances straight on.
      if (rule.allowsReview) {
        return { ...state, phase: 'review', lockedScreens };
      }
      return advancePart({ ...state, lockedScreens }, action.now);
    }

    case 'BACK': {
      if (!canGoBack(state)) return state;
      return { ...state, screenIndex: state.screenIndex - 1 };
    }

    case 'GOTO_SCREEN': {
      const part = currentPart(state);
      const rule = currentRule(state);
      if (!part || !rule) return state;
      // Jumping is a review-grid affordance; sections without a review
      // grid must not expose it.
      if (!rule.allowsReview) return state;
      if (action.screenIndex < 0 || action.screenIndex >= part.screens.length) return state;
      return { ...state, phase: 'question', screenIndex: action.screenIndex };
    }

    case 'NEXT_PART': {
      // Reachable only from the review grid, or from a listening part
      // that has just run past its last screen.
      if (state.phase !== 'review') return state;
      return advancePart(state, action.now);
    }

    case 'TIME_EXPIRED': {
      if (state.phase === 'finished' || state.phase === 'intro') return state;
      // Expiry skips the review grid entirely — the part is over.
      return advancePart(state, action.now, true);
    }

    case 'FINISH': {
      if (state.phase === 'finished') return state;
      return {
        ...state,
        partTimings: closeTiming(state, action.now, false),
        phase: 'finished',
        deadlineAt: null,
        finishedAt: action.now,
      };
    }

    default:
      return state;
  }
}

/**
 * Public reducer.
 *
 * Wraps the transition table so `revision` bumps exactly once per
 * ACCEPTED change. Illegal actions still return the identical object, so
 * React's bail-out and the sync layer's dirty check both keep working.
 */
export function examReducerWithRevision(state: ExamState, action: ExamAction): ExamState {
  const next = examReducer(state, action);
  if (next === state) return state;
  return { ...next, revision: state.revision + 1 };
}

// --- scoring -----------------------------------------------------------

export interface ExamScore {
  correct: number;
  total: number;
  answered: number;
  rawPct: number;
  /** Weighted by official STEP section percentages. */
  weightedPct: number;
  bySection: Record<string, { correct: number; total: number; pct: number; weightPct: number }>;
}

export function scoreExam(state: ExamState): ExamScore {
  const bySection: ExamScore['bySection'] = {};
  let correct = 0;
  let total = 0;
  let answered = 0;

  for (const part of state.parts) {
    const rule = SECTION_RULES[part.section];
    bySection[part.section] ??= { correct: 0, total: 0, pct: 0, weightPct: rule.weightPct };

    for (const id of part.questionIds) {
      const q = state.questions[id];
      const given = state.answers[id];
      total++;
      bySection[part.section].total++;
      if (given) answered++;
      // An unanswered question is wrong, never "skipped" — STEP has no
      // partial credit and no penalty-free omission.
      if (given && q?.correctOption && given === q.correctOption) {
        correct++;
        bySection[part.section].correct++;
      }
    }
  }

  let weightedSum = 0;
  let weightTotal = 0;
  for (const [, v] of Object.entries(bySection)) {
    v.pct = v.total ? (v.correct / v.total) * 100 : 0;
    weightedSum += v.pct * v.weightPct;
    weightTotal += v.weightPct;
  }

  return {
    correct,
    total,
    answered,
    rawPct: total ? (correct / total) * 100 : 0,
    weightedPct: weightTotal ? weightedSum / weightTotal : 0,
    bySection,
  };
}

export interface PartTimeAnalysis {
  partIndex: number;
  section: string;
  labelEn: string;
  partNo: number;
  allocatedSeconds: number;
  usedSeconds: number;
  /** >100 means the clock ran out before the candidate finished. */
  usagePct: number;
  expired: boolean;
  questionCount: number;
  secondsPerQuestion: number;
}

export function analyzeTime(state: ExamState): {
  parts: PartTimeAnalysis[];
  totalAllocated: number;
  totalUsed: number;
} {
  const parts: PartTimeAnalysis[] = [];

  for (const part of state.parts) {
    const t = state.partTimings[part.index];
    if (!t) continue;

    // An unclosed part (still in progress) is measured to now.
    const end = t.endedAt ?? Date.now();
    // Clamp to the allocation: a backgrounded tab can report wall-clock
    // beyond the deadline, which would render as >100% for everyone.
    const used = Math.min(Math.max(0, Math.round((end - t.startedAt) / 1000)), t.allocatedSeconds);

    parts.push({
      partIndex: part.index,
      section: part.section,
      labelEn: part.labelEn,
      partNo: part.partNo,
      allocatedSeconds: t.allocatedSeconds,
      usedSeconds: used,
      usagePct: t.allocatedSeconds ? (used / t.allocatedSeconds) * 100 : 0,
      expired: t.expired,
      questionCount: part.questionIds.length,
      secondsPerQuestion: part.questionIds.length ? used / part.questionIds.length : 0,
    });
  }

  return {
    parts,
    totalAllocated: parts.reduce((n, p) => n + p.allocatedSeconds, 0),
    totalUsed: parts.reduce((n, p) => n + p.usedSeconds, 0),
  };
}

/** Per-question review rows for the results screen. */
export interface ReviewRow {
  id: string;
  number: number;
  section: string;
  questionText: string;
  options: Record<string, string>;
  chosen?: OptionKey;
  correct?: OptionKey;
  isCorrect: boolean;
  answered: boolean;
  flagged: boolean;
  explanationAr?: string;
  passageText?: string;
  imageUrl?: string;
  imageAlt?: string;
}

export function buildReviewRows(state: ExamState): ReviewRow[] {
  const rows: ReviewRow[] = [];
  for (const part of state.parts) {
    for (const id of part.questionIds) {
      const q = state.questions[id];
      if (!q) continue;
      const chosen = state.answers[id];
      rows.push({
        id,
        number: state.numberInSection[id],
        section: part.section,
        questionText: q.questionText,
        options: q.options as Record<string, string>,
        chosen,
        correct: q.correctOption,
        isCorrect: Boolean(chosen && q.correctOption && chosen === q.correctOption),
        answered: Boolean(chosen),
        flagged: Boolean(state.flags[id]),
        explanationAr: q.explanationAr,
        passageText: q.passageText,
        imageUrl: q.imageUrl,
        imageAlt: q.imageAlt,
      });
    }
  }
  return rows;
}
