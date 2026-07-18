/**
 * Stage 3 — segmentation.
 *
 * The anti-goal is the "20 questions in one array element" bug. The
 * defence is structural rather than heuristic: a question object is only
 * emitted when its boundaries are *proven* by markers on both sides, and
 * every emitted object is re-validated afterwards. Anything that fails
 * validation goes to `rejected` with a reason -- it is never silently
 * merged into a neighbour, and never silently dropped.
 *
 * Four strategies, auto-selected by scoring the document:
 *
 *   lettered      1. Question text?           <- classic PDF تجميعات
 *                 A) opt  B) opt  C) opt  D) opt
 *
 *   quiz-export   1 / 150                     <- gramer_bank.txt
 *                 Question text?
 *                 opt / opt / opt / opt       (bare, unlabelled)
 *
 *   numbered-bare 1. Question text?           <- numbering, bare options
 *                 opt / opt / opt / opt
 *
 *   passage       Title + numbered paragraphs <- reading_bank.txt
 *                 followed by questions
 */

import type {
  ParsedPassage,
  ParsedQuestion,
  RejectedBlock,
  SegmentResult,
  SegmentStrategy,
  OptionKey,
} from './types';
import { hashQuestion, hashText } from './dedupe';

const OPTION_KEYS: OptionKey[] = ['A', 'B', 'C', 'D'];

// ---------------------------------------------------------------------
// Boundary patterns
// ---------------------------------------------------------------------

/** `1 / 150` — quiz-export question boundary. */
export const QUIZ_MARKER = /^(\d{1,4})\s*\/\s*(\d{1,4})$/;

/** `1.` `1-` `1/` `1)` `Q1.` `س1` `سؤال 3` — question-number prefix. */
const NUMBER_PREFIX =
  /^(?:(?:q|Q|س|سؤال)\s*)?(\d{1,3})\s*[.)\/\-:]\s*(.*)$/;

/** `A)` `a.` `[A]` `A-` `أ-` `(B)` — labelled option. */
const OPTION_PREFIX =
  /^(?:\(([A-Da-d])\)|\[([A-Da-d])\]|([A-Da-d])\s*[).\-:]|([أ-د])\s*[).\-:])\s*(.*)$/;

/** `1)` at line start where the remainder is long prose — a passage paragraph. */
const PARAGRAPH_PREFIX = /^(\d{1,2})\)\s+(.{80,})$/;

/** Lines that signal a listening item. */
const LISTENING_HINT =
  /\b(?:listen to|you will hear|transcript|audio|conversation between|lecture)\b|استمع|المحادثة|التسجيل/i;

// ---------------------------------------------------------------------
// Strategy detection
// ---------------------------------------------------------------------

export function detectStrategy(text: string): { strategy: SegmentStrategy; confidence: number } {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const total = Math.max(lines.length, 1);

  let quizMarkers = 0;
  let numberPrefixes = 0;
  let optionPrefixes = 0;
  let paragraphs = 0;

  for (const line of lines) {
    if (QUIZ_MARKER.test(line)) quizMarkers++;
    else if (OPTION_PREFIX.test(line)) optionPrefixes++;
    else if (PARAGRAPH_PREFIX.test(line)) paragraphs++;
    else if (NUMBER_PREFIX.test(line)) numberPrefixes++;
  }

  // Lettered options are the strongest signal: they are unambiguous and
  // rare by accident. Require a meaningful density, not just a stray "A)".
  const optionDensity = optionPrefixes / total;
  const quizDensity = quizMarkers / total;
  const paragraphDensity = paragraphs / total;

  if (optionDensity > 0.15) {
    return { strategy: 'lettered', confidence: Math.min(1, optionDensity * 3) };
  }
  // Threshold of 2, not 3: a listening clip legitimately carries only
  // 1-3 questions, and requiring 3 markers made every short batch fall
  // through to numbered-bare — where the boundary lines were then eaten
  // as pagination and the whole clip parsed to nothing.
  if (quizMarkers >= 2 && quizDensity > 0.02) {
    return { strategy: 'quiz-export', confidence: Math.min(1, quizDensity * 8) };
  }
  if (paragraphDensity > 0.08 && paragraphs >= 3) {
    return { strategy: 'passage', confidence: Math.min(1, paragraphDensity * 5) };
  }
  if (numberPrefixes >= 3) {
    return { strategy: 'numbered-bare', confidence: Math.min(1, (numberPrefixes / total) * 4) };
  }
  return { strategy: 'numbered-bare', confidence: 0.2 };
}

/**
 * Boundary markers the noise stripper must not eat.
 *
 * QUIZ_MARKER is protected for EVERY strategy, not just quiz-export.
 * Detection is a heuristic and can pick the wrong strategy on a short
 * batch; when it does, an unprotected `N / M` line is deleted as
 * pagination and the questions vanish silently. Keeping a genuine page
 * number costs one rejected block — losing every boundary costs the
 * whole batch.
 */
export function protectedMarkersFor(_strategy: SegmentStrategy): RegExp[] {
  return [QUIZ_MARKER];
}

// ---------------------------------------------------------------------
// Validation — the merge-bug backstop
// ---------------------------------------------------------------------

const MAX_QUESTION_WORDS = 120;
const MAX_OPTION_WORDS = 60;

function wordCount(s: string): number {
  return s.split(/\s+/).filter(Boolean).length;
}

/**
 * Validate one candidate. Returns null if acceptable, else a reason.
 *
 * The word-count ceilings are the specific guard against merged blocks:
 * two concatenated questions reliably blow past MAX_QUESTION_WORDS, and
 * an option that swallowed the next question blows past MAX_OPTION_WORDS.
 */
function validate(q: ParsedQuestion, isReading: boolean): string | null {
  const opts = Object.entries(q.options).filter(([, v]) => v && v.trim());

  if (!q.questionText.trim()) return 'empty question text';
  if (opts.length < 2) return `only ${opts.length} option(s) — need 2-4`;
  if (opts.length > 4) return `${opts.length} options — exceeds 4`;

  // Case- and punctuation-SENSITIVE comparison. STEP has whole question
  // families ("In which sentence is all CAPITALIZATION correct?",
  // "...all PUNCTUATION correct?") whose four options differ only by case
  // or by commas. Normalising before this check deletes valid questions.
  const seen = new Set(opts.map(([, v]) => v!.trim()));
  if (seen.size !== opts.length) return 'duplicate option text';

  if (!isReading && wordCount(q.questionText) > MAX_QUESTION_WORDS) {
    return `question is ${wordCount(q.questionText)} words — likely merged block`;
  }
  for (const [k, v] of opts) {
    if (wordCount(v!) > MAX_OPTION_WORDS) {
      return `option ${k} is ${wordCount(v!)} words — likely swallowed the next question`;
    }
  }

  // An option containing its own option marker means a boundary was missed.
  for (const [k, v] of opts) {
    if (OPTION_PREFIX.test(v!.trim())) return `option ${k} contains a nested option marker`;
    if (QUIZ_MARKER.test(v!.trim())) return `option ${k} contains a question boundary marker`;
  }
  return null;
}

/**
 * Last-resort splitter for an over-long block: re-scan it for numbering
 * boundaries the primary pass missed, mid-line as well as at line start.
 * Returns the sub-blocks, or [block] if no split point is found.
 */
export function resplitLongBlock(block: string[]): string[][] {
  const joined = block.join('\n');
  if (wordCount(joined) <= MAX_QUESTION_WORDS * 2) return [block];

  const out: string[][] = [];
  let current: string[] = [];
  for (const line of block) {
    // A mid-line "  12. " that begins a new sentence is a missed boundary.
    const midline = line.match(/^(.*?[.?!])\s+(\d{1,3}\s*[.)\/-]\s+.*)$/);
    if (midline && current.length) {
      current.push(midline[1]);
      out.push(current);
      current = [midline[2]];
      continue;
    }
    if (NUMBER_PREFIX.test(line) && current.length) {
      out.push(current);
      current = [line];
      continue;
    }
    current.push(line);
  }
  if (current.length) out.push(current);
  return out.length ? out : [block];
}

// ---------------------------------------------------------------------
// Strategy: quiz-export  ("N / M" markers, bare option lines)
// ---------------------------------------------------------------------

/** `Passage 1 : Travel and Tourism` — passage header inside a block. */
const PASSAGE_HEADER = /^(?:passage|القطعة|النص)\s*\d*\s*[:\-]?\s*(.*)$/i;

/**
 * Split a quiz-export block into its (optional) reading passage and the
 * actual question region.
 *
 * The reading corpus repeats the ENTIRE passage inside every question
 * block. Without this split, each block is ~240 words and the merged-block
 * validator rejects all of them — which is what the first run did.
 */
function splitPassageFromBlock(block: string[]): {
  passageTitle?: string;
  passageBody: string[];
  question: string[];
} {
  const passageBody: string[] = [];
  let passageTitle: string | undefined;
  let cursor = 0;

  const header = block[0]?.match(PASSAGE_HEADER);
  if (header) {
    passageTitle = header[1].trim() || undefined;
    cursor = 1;
  }

  // Consume numbered paragraphs (`1)` + 80 chars of prose) and any long
  // un-numbered prose lines that follow them.
  let sawParagraph = false;
  while (cursor < block.length) {
    const line = block[cursor];
    const para = line.match(PARAGRAPH_PREFIX);
    if (para) {
      passageBody.push(para[2].trim());
      sawParagraph = true;
      cursor++;
      continue;
    }
    // A long line right after paragraphs is passage continuation, not a
    // question prompt (prompts in this corpus are short).
    if (sawParagraph && wordCount(line) > 25) {
      passageBody.push(line);
      cursor++;
      continue;
    }
    break;
  }

  // Fallback: an explicit `Passage N :` header with NO numbered
  // paragraphs (the corpus has these too — e.g. "Passage 7 : Air
  // pollution" is plain prose). Consume long prose lines directly after
  // the header; stop at the first short line, which is the prompt.
  if (!sawParagraph && header) {
    while (cursor < block.length && wordCount(block[cursor]) > 25) {
      passageBody.push(block[cursor]);
      cursor++;
    }

    // Prose-length alone is not enough: some passages are built from
    // SHORT lines (the e-mail items are literally "From:", "To:",
    // "Date: ..."). When an explicit header is present, fall back to
    // structure — the tail of the block is prompt + up to 4 options, and
    // everything before it belongs to the passage.
    const TAIL = 5;
    if (block.length - cursor > TAIL) {
      while (cursor < block.length - TAIL) {
        passageBody.push(block[cursor]);
        cursor++;
      }
    }

    if (passageBody.length) {
      return { passageTitle, passageBody, question: block.slice(cursor) };
    }
  }

  // No header and no paragraphs — not a passage, hand the block back.
  if (!sawParagraph) {
    return { passageBody: [], question: block };
  }
  return { passageTitle, passageBody, question: block.slice(cursor) };
}

function segmentQuizExport(text: string): Omit<SegmentResult, 'strategy' | 'strategyConfidence'> {
  const lines = text.split('\n');
  const questions: ParsedQuestion[] = [];
  const rejected: RejectedBlock[] = [];
  const passages: ParsedPassage[] = [];
  const passageIndexByHash = new Map<string, number>();

  // Collect (lineIndex, declaredNumber) for every boundary marker.
  const boundaries: Array<{ idx: number; num: number }> = [];
  lines.forEach((line, idx) => {
    const m = line.trim().match(QUIZ_MARKER);
    if (m) boundaries.push({ idx, num: Number(m[1]) });
  });

  for (let b = 0; b < boundaries.length; b++) {
    const start = boundaries[b].idx + 1;
    const end = b + 1 < boundaries.length ? boundaries[b + 1].idx : lines.length;
    const rawBlock = lines.slice(start, end).map((l) => l.trim()).filter(Boolean);
    const sourceLine = start + 1;

    // Peel off a repeated reading passage, if present.
    const split = splitPassageFromBlock(rawBlock);
    const block = split.question;

    let passageRef: number | undefined;
    if (split.passageBody.length) {
      const body = split.passageBody.join('\n\n');
      const h = hashText(body);
      let idx = passageIndexByHash.get(h);
      if (idx === undefined) {
        idx = passages.length;
        passages.push({ title: split.passageTitle, body, contentHash: h });
        passageIndexByHash.set(h, idx);
      }
      passageRef = idx;
    }

    if (block.length < 3) {
      rejected.push({
        reason: `block has ${block.length} line(s) — need a prompt plus 2+ options`,
        sourceLine,
        excerpt: rawBlock.join(' / ').slice(0, 160),
      });
      continue;
    }

    // The prompt is line 1; every remaining line is an option candidate.
    // Trailing options are the last 2-4 lines -- taking them from the END
    // is what makes multi-line prompts work without merging.
    const optionLines = block.slice(1);
    const take = Math.min(4, optionLines.length);
    const chosen = optionLines.slice(optionLines.length - take);
    const promptLines = [block[0], ...optionLines.slice(0, optionLines.length - take)];

    const options: Partial<Record<OptionKey, string>> = {};
    chosen.forEach((opt, i) => { options[OPTION_KEYS[i]] = opt; });

    const questionText = promptLines.join(' ').trim();
    const candidate: ParsedQuestion = {
      questionText,
      options,
      contentHash: hashQuestion(questionText, options),
      passageRef,
      sourceLine,
      strategy: 'quiz-export',
      warnings: [],
    };

    // Warn only on NON-MONOTONIC numbering, which signals a genuinely
    // missed or duplicated boundary. Comparing against absolute position
    // instead flags every question after the first gap -- on the reading
    // corpus that fired on 148 of 148 items and made the warning useless
    // as a review signal.
    const prevNum = b > 0 ? boundaries[b - 1].num : 0;
    if (boundaries[b].num <= prevNum) {
      candidate.warnings.push(
        `question number ${boundaries[b].num} does not follow ${prevNum} — possible missed boundary`,
      );
    }
    if (LISTENING_HINT.test(questionText)) candidate.warnings.push('listening hint present');

    const problem = validate(candidate, passageRef !== undefined);
    if (problem) {
      rejected.push({ reason: problem, sourceLine, excerpt: block.join(' / ').slice(0, 160) });
      continue;
    }
    questions.push(candidate);
  }

  return { questions, passages, rejected };
}

// ---------------------------------------------------------------------
// Strategy: lettered  (A) B) C) D) markers)
// ---------------------------------------------------------------------

/** Arabic option letters map onto A-D positionally. */
const ARABIC_OPTION_ORDER: Record<string, OptionKey> = {
  'أ': 'A', 'ب': 'B', 'ج': 'C', 'د': 'D',
};

function letterOf(m: RegExpMatchArray): OptionKey | null {
  const raw = m[1] ?? m[2] ?? m[3] ?? m[4];
  if (!raw) return null;
  if (ARABIC_OPTION_ORDER[raw]) return ARABIC_OPTION_ORDER[raw];
  const up = raw.toUpperCase();
  return (OPTION_KEYS as string[]).includes(up) ? (up as OptionKey) : null;
}

function segmentLettered(text: string): Omit<SegmentResult, 'strategy' | 'strategyConfidence'> {
  const lines = text.split('\n').map((l) => l.trim());
  const questions: ParsedQuestion[] = [];
  const rejected: RejectedBlock[] = [];

  let promptParts: string[] = [];
  let options: Partial<Record<OptionKey, string>> = {};
  let lastKey: OptionKey | null = null;
  let blockStart = 1;

  const flush = (atLine: number) => {
    if (!promptParts.length && !Object.keys(options).length) return;

    const questionText = promptParts.join(' ').replace(/\s+/g, ' ').trim();
    const candidate: ParsedQuestion = {
      questionText,
      options: { ...options },
      contentHash: hashQuestion(questionText, options),
      sourceLine: blockStart,
      strategy: 'lettered',
      warnings: [],
    };
    if (LISTENING_HINT.test(questionText)) candidate.warnings.push('listening hint present');

    const problem = validate(candidate, false);
    if (problem) {
      rejected.push({
        reason: problem,
        sourceLine: blockStart,
        excerpt: `${questionText} | ${Object.values(options).join(' / ')}`.slice(0, 160),
      });
    } else {
      questions.push(candidate);
    }

    promptParts = [];
    options = {};
    lastKey = null;
    blockStart = atLine;
  };

  lines.forEach((line, idx) => {
    if (!line) return;

    const optMatch = line.match(OPTION_PREFIX);
    if (optMatch) {
      const key = letterOf(optMatch);
      const body = (optMatch[5] ?? '').trim();
      if (key) {
        // Seeing 'A' again means the previous question ended, even if no
        // number marker separated them. This is the primary merge guard.
        if (key === 'A' && Object.keys(options).length > 0) flush(idx + 1);
        options[key] = body;
        lastKey = key;
        return;
      }
    }

    const numMatch = line.match(NUMBER_PREFIX);
    if (numMatch) {
      // A new question number always closes the previous block.
      if (Object.keys(options).length > 0 || promptParts.length > 0) flush(idx + 1);
      promptParts.push(numMatch[2].trim());
      return;
    }

    // Continuation: belongs to the last option if we are inside the option
    // list, otherwise to the prompt.
    if (lastKey && options[lastKey] !== undefined) {
      options[lastKey] = `${options[lastKey]} ${line}`.trim();
    } else {
      promptParts.push(line);
    }
  });

  flush(lines.length);
  return { questions, passages: [], rejected };
}

// ---------------------------------------------------------------------
// Strategy: numbered-bare  (numbering, unlabelled options)
// ---------------------------------------------------------------------

function segmentNumberedBare(text: string): Omit<SegmentResult, 'strategy' | 'strategyConfidence'> {
  const lines = text.split('\n').map((l) => l.trim());
  const questions: ParsedQuestion[] = [];
  const rejected: RejectedBlock[] = [];

  const starts: number[] = [];
  lines.forEach((line, idx) => { if (line && NUMBER_PREFIX.test(line)) starts.push(idx); });

  for (let s = 0; s < starts.length; s++) {
    const from = starts[s];
    const to = s + 1 < starts.length ? starts[s + 1] : lines.length;
    let block = lines.slice(from, to).filter(Boolean);
    const sourceLine = from + 1;

    // Over-long block -> re-scan for missed boundaries before giving up.
    const pieces = resplitLongBlock(block);
    for (const piece of pieces) {
      if (piece.length < 3) {
        rejected.push({
          reason: `block has ${piece.length} line(s) — need a prompt plus 2+ options`,
          sourceLine,
          excerpt: piece.join(' / ').slice(0, 160),
        });
        continue;
      }
      const head = piece[0].match(NUMBER_PREFIX);
      const first = head ? head[2].trim() : piece[0];
      const rest = piece.slice(1);
      const take = Math.min(4, rest.length);
      const chosen = rest.slice(rest.length - take);
      const promptExtra = rest.slice(0, rest.length - take);

      const options: Partial<Record<OptionKey, string>> = {};
      chosen.forEach((opt, i) => { options[OPTION_KEYS[i]] = opt; });

      const questionText = [first, ...promptExtra].join(' ').replace(/\s+/g, ' ').trim();
      const candidate: ParsedQuestion = {
        questionText,
        options,
        contentHash: hashQuestion(questionText, options),
        sourceLine,
        strategy: 'numbered-bare',
        warnings: [],
      };
      if (LISTENING_HINT.test(questionText)) candidate.warnings.push('listening hint present');

      const problem = validate(candidate, false);
      if (problem) {
        rejected.push({ reason: problem, sourceLine, excerpt: piece.join(' / ').slice(0, 160) });
        continue;
      }
      questions.push(candidate);
    }
  }

  return { questions, passages: [], rejected };
}

// ---------------------------------------------------------------------
// Strategy: passage  (reading comprehension)
// ---------------------------------------------------------------------

/**
 * Reading sources interleave passages and their questions. Numbered
 * *paragraphs* (`1)` followed by 80+ chars of prose) look exactly like
 * numbered *questions* to a naive parser -- distinguishing them by body
 * length and by the absence of a following option list is the whole job.
 */
function segmentPassages(text: string): Omit<SegmentResult, 'strategy' | 'strategyConfidence'> {
  const lines = text.split('\n').map((l) => l.trim());
  const passages: ParsedPassage[] = [];
  const rejected: RejectedBlock[] = [];

  let title: string | undefined;
  let body: string[] = [];
  const questionRegions: Array<{ from: number; to: number; passageRef: number }> = [];
  let regionStart: number | null = null;

  const flushPassage = () => {
    if (!body.length) return;
    const text = body.join('\n\n');
    passages.push({ title, body: text, contentHash: hashText(text) });
    body = [];
    title = undefined;
  };

  lines.forEach((line, idx) => {
    if (!line) return;
    const para = line.match(PARAGRAPH_PREFIX);
    if (para) {
      if (regionStart !== null) {
        questionRegions.push({ from: regionStart, to: idx, passageRef: passages.length });
        regionStart = null;
      }
      body.push(para[2].trim());
      return;
    }

    // A short un-numbered line directly after paragraphs starts the
    // question region for the passage just accumulated.
    if (body.length && regionStart === null) {
      flushPassage();
      regionStart = idx;
      return;
    }
    if (regionStart === null && !body.length && line.length < 90) {
      title = line;  // heading above the next passage
    }
  });

  if (regionStart !== null) {
    questionRegions.push({ from: regionStart, to: lines.length, passageRef: Math.max(0, passages.length - 1) });
  }
  flushPassage();

  // Parse each question region with the general-purpose segmenters and
  // attach the passage reference.
  const questions: ParsedQuestion[] = [];
  for (const region of questionRegions) {
    const slice = lines.slice(region.from, region.to).join('\n');
    if (!slice.trim()) continue;
    const sub = detectStrategy(slice).strategy === 'lettered'
      ? segmentLettered(slice)
      : segmentNumberedBare(slice);
    for (const q of sub.questions) {
      q.passageRef = region.passageRef;
      q.sourceLine += region.from;
      questions.push(q);
    }
    rejected.push(...sub.rejected.map((r) => ({ ...r, sourceLine: r.sourceLine + region.from })));
  }

  return { questions, passages, rejected };
}

// ---------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------

export function segment(text: string, forced?: SegmentStrategy): SegmentResult {
  const detected = detectStrategy(text);
  const strategy = forced ?? detected.strategy;

  const run =
    strategy === 'quiz-export' ? segmentQuizExport
    : strategy === 'lettered' ? segmentLettered
    : strategy === 'passage' ? segmentPassages
    : segmentNumberedBare;

  const result = run(text);
  return {
    ...result,
    strategy,
    strategyConfidence: forced ? 1 : detected.confidence,
  };
}
