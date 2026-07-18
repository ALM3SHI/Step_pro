/**
 * Canonical content model.
 *
 * One shape for a question, shared by the seed files, the database, the
 * exam engine, the admin editor, and the future AI services. Anything
 * that needs a different shape derives it from this rather than defining
 * a parallel one — parallel models are how a `correctOption` ends up
 * meaning two different things in two files.
 */

import type { Difficulty, SectionId } from './taxonomy';

export const OPTION_KEYS = ['A', 'B', 'C', 'D'] as const;
export type OptionKey = (typeof OPTION_KEYS)[number];

export type ContentStatus = 'draft' | 'review' | 'published' | 'retired';

/**
 * A reading passage or other shared stimulus.
 *
 * Separate from the question because several questions share one, and
 * inlining it would duplicate ~2KB per row and let copies drift apart
 * after an edit.
 */
export interface Passage {
  id: string;
  titleAr?: string;
  titleEn?: string;
  /**
   * Plain text. Paragraphs are separated by "\n\n" and rendered with
   * `white-space: pre-line` — NOT HTML. Ingested content must never be
   * rendered as markup, and authors need line breaks to survive
   * round-tripping through the editor.
   */
  body: string;
  imageUrl?: string;
  imageAlt?: string;
  contentHash: string;
  sourceRef?: string;
}

/** An audio stimulus. Several questions can share one clip. */
export interface AudioClip {
  id: string;
  /** Stable key from the filename, e.g. "1742938770". */
  audioKey: string;
  storagePath: string;
  transcript?: string;
  durationMs?: number;
  sourceRef?: string;
}

export interface Question {
  id: string;
  section: SectionId;
  /** Skill id from SKILL_DEFS. Drives all per-skill analytics. */
  skillId: string;
  difficulty: Difficulty;

  /**
   * Question text. Plain text with meaningful newlines preserved —
   * sentence-ordering and error-detection items depend on line structure,
   * so `\n` is content, not formatting noise.
   */
  text: string;
  options: Record<OptionKey, string>;
  correctOption: OptionKey;

  /** Step-by-step reasoning in Arabic, shown after answering. */
  explanationAr?: string;

  passageId?: string;
  audioClipId?: string;
  /** Position within a shared stimulus (Q1/Q2/Q3 of one clip). */
  ordinal?: number;

  imageUrl?: string;
  imageAlt?: string;

  /** Free-form labels for filtering and future retrieval. */
  tags: string[];

  contentHash: string;
  status: ContentStatus;

  /** Where this came from — a batch id, or "legacy" for the migration. */
  sourceRef?: string;

  /** Live difficulty signal, populated once attempts accumulate. */
  stats?: QuestionStats;
}

export interface QuestionStats {
  timesServed: number;
  timesCorrect: number;
  /** Share answering correctly. The empirical difficulty. */
  pValue: number;
  avgSecondsSpent: number;
  /** Per-option counts, to spot a distractor that outperforms the key. */
  optionCounts?: Partial<Record<OptionKey, number>>;
}

/** The versioned artifact the seeder consumes. */
export interface ContentBundle {
  version: number;
  generatedAt: string;
  questions: Question[];
  passages: Passage[];
  audioClips: AudioClip[];
  counts: {
    total: number;
    bySection: Record<string, number>;
    bySkill: Record<string, number>;
  };
}

// ---------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------

export interface ValidationIssue {
  questionId: string;
  severity: 'error' | 'warning';
  message: string;
}

/**
 * Structural validation.
 *
 * Runs at build time, before anything reaches the database, because a
 * malformed question is far cheaper to catch here than in front of a
 * candidate mid-exam.
 */
export function validateQuestion(
  q: Question,
  ctx: { passageIds: Set<string>; audioIds: Set<string>; skillIds: Set<string> },
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const err = (message: string) => issues.push({ questionId: q.id, severity: 'error', message });
  const warn = (message: string) => issues.push({ questionId: q.id, severity: 'warning', message });

  if (!q.text?.trim()) err('empty question text');
  if (!q.skillId) err('missing skillId');
  else if (!ctx.skillIds.has(q.skillId)) err(`unknown skillId "${q.skillId}"`);

  const present = OPTION_KEYS.filter((k) => q.options[k]?.trim());
  if (present.length < 2) err(`only ${present.length} option(s)`);
  if (!q.options[q.correctOption]?.trim()) {
    err(`correctOption "${q.correctOption}" is not a populated option`);
  }

  // Case- and punctuation-sensitive: whole question families
  // (CAPITALIZATION, PUNCTUATION) differ only by case or commas, and
  // normalising before this check deletes valid questions.
  const distinct = new Set(present.map((k) => q.options[k].trim()));
  if (distinct.size !== present.length) err('duplicate option text');

  // A listening question with no clip is unanswerable.
  if (q.section === 'listening' && !q.audioClipId) err('listening question has no audioClipId');
  if (q.audioClipId && !ctx.audioIds.has(q.audioClipId)) err(`unknown audioClipId "${q.audioClipId}"`);
  if (q.passageId && !ctx.passageIds.has(q.passageId)) err(`unknown passageId "${q.passageId}"`);

  if (q.imageUrl && !q.imageAlt?.trim()) err('imageUrl without imageAlt (inaccessible)');

  if (!q.explanationAr?.trim()) warn('no Arabic explanation');
  // A merged block reliably blows past this; reading prompts are short
  // because the length lives in the passage.
  if (q.section !== 'reading' && q.text.split(/\s+/).length > 120) {
    warn('question text over 120 words — possible merged block');
  }

  return issues;
}

export function validateBundle(bundle: ContentBundle, skillIds: Set<string>) {
  const ctx = {
    passageIds: new Set(bundle.passages.map((p) => p.id)),
    audioIds: new Set(bundle.audioClips.map((a) => a.id)),
    skillIds,
  };

  const issues = bundle.questions.flatMap((q) => validateQuestion(q, ctx));

  // Duplicate ids would make the whole bundle non-deterministic on import.
  const seenIds = new Set<string>();
  for (const q of bundle.questions) {
    if (seenIds.has(q.id)) {
      issues.push({ questionId: q.id, severity: 'error', message: 'duplicate question id' });
    }
    seenIds.add(q.id);
  }

  const seenHash = new Map<string, string>();
  for (const q of bundle.questions) {
    const prior = seenHash.get(q.contentHash);
    if (prior) {
      issues.push({
        questionId: q.id,
        severity: 'warning',
        message: `duplicate contentHash (same as ${prior})`,
      });
    } else seenHash.set(q.contentHash, q.id);
  }

  return {
    issues,
    errors: issues.filter((i) => i.severity === 'error'),
    warnings: issues.filter((i) => i.severity === 'warning'),
  };
}
