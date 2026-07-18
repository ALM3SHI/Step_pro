export type OptionKey = 'A' | 'B' | 'C' | 'D';
export type SectionKey = 'reading' | 'grammar' | 'listening' | 'writing';

/** Official STEP weighting and per-section operational rules. */
export interface SectionRule {
  key: SectionKey;
  nameAr: string;
  nameEn: string;
  weightPct: number;
  /** Listening is forward-only: no Back, no review grid, items lock behind you. */
  allowsBack: boolean;
  allowsReview: boolean;
  order: number;
}

export const SECTION_RULES: Record<SectionKey, SectionRule> = {
  reading:   { key: 'reading',   nameAr: 'فهم المقروء',      nameEn: 'Reading Comprehension', weightPct: 40, allowsBack: true,  allowsReview: true,  order: 1 },
  grammar:   { key: 'grammar',   nameAr: 'القواعد والتراكيب', nameEn: 'Grammar & Structure',   weightPct: 30, allowsBack: true,  allowsReview: true,  order: 2 },
  listening: { key: 'listening', nameAr: 'فهم المسموع',      nameEn: 'Listening',             weightPct: 20, allowsBack: false, allowsReview: false, order: 3 },
  writing:   { key: 'writing',   nameAr: 'التحليل الكتابي',   nameEn: 'Writing Analysis',      weightPct: 10, allowsBack: true,  allowsReview: true,  order: 4 },
};

export interface ExamQuestion {
  id: string;
  section: SectionKey;
  questionText: string;
  options: Partial<Record<OptionKey, string>>;
  correctOption?: OptionKey;
  explanationAr?: string;
  /** Groups reading questions onto one screen. */
  passageId?: string;
  passageText?: string;
  /** Groups listening questions onto one screen. */
  audioId?: string;
  audioUrl?: string;
  imageUrl?: string;
  imageAlt?: string;
}

/**
 * A screen is the unit of navigation: one stimulus plus every question
 * attached to it. Reading and listening group by passage/audio; grammar
 * and writing are one question per screen.
 */
export type Screen = string[];

export interface ExamPart {
  index: number;
  section: SectionKey;
  labelEn: string;
  partNo: number;
  screens: Screen[];
  questionIds: string[];
  durationSeconds: number;
}

export type ExamPhase = 'intro' | 'question' | 'review' | 'finished';

export interface ExamState {
  parts: ExamPart[];
  questions: Record<string, ExamQuestion>;
  /** 1-based question number within its section, matching the legacy display. */
  numberInSection: Record<string, number>;

  partIndex: number;
  screenIndex: number;
  phase: ExamPhase;

  /**
   * Epoch ms when the current part expires, or null before it starts.
   *
   * Deliberately a DEADLINE, not a countdown: storing seconds-remaining
   * would force a state write every second and re-render the whole tree
   * at 1Hz. The timer component derives the display from this and owns
   * its own interval, so ticks cost one small component, not the exam.
   */
  deadlineAt: number | null;

  answers: Record<string, OptionKey>;
  flags: Record<string, true>;

  /** Highest part entered. One-way locking is enforced against this. */
  maxPartIndex: number;
  /** Listening screens already passed — permanently locked. */
  lockedScreens: Record<string, true>;

  /**
   * Wall-clock spent in each part, for the time-vs-allocation analysis.
   * Recorded as start/end stamps rather than a running total so a
   * refresh mid-part cannot double-count.
   */
  partTimings: Record<number, PartTiming>;

  /**
   * Bumped on every state-changing action. The sync layer sends it with
   * each write so the server can discard out-of-order payloads — without
   * it, a slow request carrying an older part index lands after a newer
   * one and trips the one-way-lock trigger.
   */
  revision: number;

  startedAt: number | null;
  finishedAt: number | null;
}

export interface PartTiming {
  partIndex: number;
  startedAt: number;
  endedAt: number | null;
  allocatedSeconds: number;
  /** True when the part ended because the clock ran out. */
  expired: boolean;
}

export type ExamAction =
  | { type: 'START_PART'; now: number }
  | { type: 'ANSWER'; questionId: string; option: OptionKey }
  | { type: 'TOGGLE_FLAG'; questionId: string }
  | { type: 'NEXT'; now: number }
  | { type: 'BACK' }
  | { type: 'GOTO_SCREEN'; screenIndex: number }
  | { type: 'NEXT_PART'; now: number }
  | { type: 'TIME_EXPIRED'; now: number }
  | { type: 'FINISH'; now: number };
