/**
 * Stage 2 — split text into candidate question blocks.
 *
 * Shared by every section parser. The parsers differ in what they do
 * with a block (a reading item belongs to a passage, a listening item to
 * a clip); finding the boundaries is the same problem everywhere.
 *
 * THE FAILURE THIS EXISTS TO FIX: the previous engine recognised exactly
 * three boundary signals — `N / M`, `A)`, and `1.`. A real listening
 * paste had none of them, only blanks (`......`) and bare option lines.
 * It therefore found zero blocks, rejected zero blocks, and reported
 * success having understood nothing. Silence is the worst possible
 * outcome, so this module treats "no boundary found" as an error and
 * every unparseable span as a retained failure.
 */

export type OptionLetter = 'A' | 'B' | 'C' | 'D';
export const OPTION_LETTERS: OptionLetter[] = ['A', 'B', 'C', 'D'];

export interface RawBlock {
  /** Number printed in the source, when there was one. */
  sourceNumber?: number;
  stem: string;
  options: Partial<Record<OptionLetter, string>>;
  /** 1-based line in the text handed to the splitter. */
  sourceLine: number;
  /** Which signal delimited this block, for the report. */
  boundary: BoundaryKind;
  warnings: string[];
}

export interface FailedBlock {
  reason: string;
  sourceLine: number;
  /** The text itself, kept so it can be reviewed and fixed by hand. */
  text: string;
}

export type BoundaryKind = 'numbered' | 'lettered' | 'quiz-marker' | 'blank-marker' | 'option-run';

export interface SplitResult {
  blocks: RawBlock[];
  failed: FailedBlock[];
  /** Which signals were present, and how often. */
  signals: Record<BoundaryKind, number>;
}

// ---------------------------------------------------------------------
// Line classification
// ---------------------------------------------------------------------

/** `1.` `1)` `1-` `Q1.` `س1` — a numbered question start. */
const NUMBERED = /^(?:(?:q|Q|س|سؤال)\s*)?(\d{1,4})\s*[.)\/\-:]\s+(.+)$/;

/** `N / M` — the quiz-export boundary. */
const QUIZ_MARKER = /^(\d{1,4})\s*\/\s*(\d{1,4})$/;

/** `A)` `(B)` `[c]` `أ-` — a labelled option. */
const LETTERED_OPTION =
  /^(?:\(([A-Da-d])\)|\[([A-Da-d])\]|([A-Da-d])\s*[).\-:]|([أ-د])\s*[).\-:])\s+?(.*)$/;

/**
 * A gap to fill: `......` `___` `-----` `….`
 *
 * This is the signal the old engine was blind to, and on STEP material
 * it is the single most reliable marker of a question stem — grammar and
 * listening items are overwhelmingly fill-in-the-blank.
 */
const BLANK_MARKER = /[.·]{3,}|_{2,}|-{4,}|…/;

const ARABIC_OPTION_LETTER: Record<string, OptionLetter> = {
  'أ': 'A', 'ب': 'B', 'ج': 'C', 'د': 'D',
};

function letteredOption(line: string): { letter: OptionLetter; text: string } | null {
  const m = line.match(LETTERED_OPTION);
  if (!m) return null;
  const rawLetter = m[1] ?? m[2] ?? m[3] ?? m[4];
  const letter = ARABIC_OPTION_LETTER[rawLetter] ?? (rawLetter.toUpperCase() as OptionLetter);
  if (!OPTION_LETTERS.includes(letter)) return null;
  return { letter, text: (m[5] ?? '').trim() };
}

/**
 * Could this line be a bare option?
 *
 * Bare options are short and lack terminal punctuation. The ceiling is
 * generous because reading options run long, and the cost of being wrong
 * here is a rejected block the maintainer can see — not a silent merge.
 */
const MAX_BARE_OPTION_WORDS = 25;

function couldBeBareOption(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  if (BLANK_MARKER.test(t)) return false;      // a blank means it is a stem
  if (NUMBERED.test(t)) return false;
  if (QUIZ_MARKER.test(t)) return false;
  if (/[?؟]$/.test(t)) return false;           // a question mark means a stem
  return t.split(/\s+/).length <= MAX_BARE_OPTION_WORDS;
}

/**
 * `1)` / `(2)` opening a line of prose — a passage paragraph marker.
 *
 * Distinct from NUMBERED, which is a question number. A short numbered
 * paragraph ending in a question mark ("(2) So, who can receive and who
 * can donate in ABO system?") is passage text, and reading it as a stem
 * splits the passage and strands its real questions.
 */
const PARAGRAPH_MARKER = /^\s*\(\d{1,2}\)\s+/;

function isStemLine(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  if (PARAGRAPH_MARKER.test(t)) return false;
  return BLANK_MARKER.test(t) || /[?؟]\s*$/.test(t) || NUMBERED.test(t);
}

// ---------------------------------------------------------------------
// Splitting
// ---------------------------------------------------------------------

export interface SplitOptions {
  /** Expected options per question. Used to group bare option runs. */
  optionsPerQuestion?: number;
  /** Minimum options for a block to be accepted. */
  minOptions?: number;
}

/**
 * Split into blocks using whichever signal the document actually carries.
 *
 * Order matters: lettered options are unambiguous and win; numbering is
 * next; the blank/bare-run reading is the fallback that rescues formats
 * with no explicit markers at all.
 */
export function splitBlocks(text: string, opts: SplitOptions = {}): SplitResult {
  const minOptions = opts.minOptions ?? 2;
  const expected = opts.optionsPerQuestion ?? 4;

  const rawLines = text.split('\n');
  const lines = rawLines.map((l, i) => ({ text: l.trim(), line: i + 1 }))
    .filter((l) => l.text.length > 0);

  const signals: Record<BoundaryKind, number> = {
    numbered: 0, lettered: 0, 'quiz-marker': 0,
    'blank-marker': 0, 'option-run': 0,
  };
  for (const { text: t } of lines) {
    if (letteredOption(t)) signals.lettered++;
    else if (QUIZ_MARKER.test(t)) signals['quiz-marker']++;
    else if (NUMBERED.test(t)) signals.numbered++;
    else if (BLANK_MARKER.test(t)) signals['blank-marker']++;
  }

  const hasLettered = signals.lettered >= minOptions;

  return hasLettered
    ? splitByLetteredOptions(lines, minOptions, signals)
    : splitByBareRuns(lines, expected, minOptions, signals);
}

type Line = { text: string; line: number };

/**
 * Lettered options present: a block runs from a stem to the end of its
 * option letters. This is the reliable path.
 */
function splitByLetteredOptions(
  lines: Line[],
  minOptions: number,
  signals: Record<BoundaryKind, number>,
): SplitResult {
  const blocks: RawBlock[] = [];
  const failed: FailedBlock[] = [];

  let stem: string[] = [];
  let stemLine = 0;
  let sourceNumber: number | undefined;
  let options: Partial<Record<OptionLetter, string>> = {};
  let lastLetter: OptionLetter | null = null;

  const flush = () => {
    const stemText = stem.join(' ').trim();
    const count = Object.values(options).filter((v) => v?.trim()).length;

    if (!stemText && count === 0) { reset(); return; }

    if (count < minOptions) {
      failed.push({
        reason: `خيارات غير كافية (${count} من ${minOptions} مطلوبة)`,
        sourceLine: stemLine,
        text: [stemText, ...Object.entries(options).map(([k, v]) => `${k}) ${v}`)].join('\n'),
      });
      reset(); return;
    }
    if (!stemText) {
      failed.push({
        reason: 'خيارات بلا نص سؤال',
        sourceLine: stemLine,
        text: Object.entries(options).map(([k, v]) => `${k}) ${v}`).join('\n'),
      });
      reset(); return;
    }

    blocks.push({
      sourceNumber, stem: stemText, options,
      sourceLine: stemLine, boundary: 'lettered', warnings: [],
    });
    reset();
  };

  function reset() {
    stem = []; options = {}; lastLetter = null; sourceNumber = undefined;
  }

  for (const { text: t, line } of lines) {
    const opt = letteredOption(t);

    if (opt) {
      // An option letter that goes backwards starts a new question.
      if (lastLetter && OPTION_LETTERS.indexOf(opt.letter) <= OPTION_LETTERS.indexOf(lastLetter)) {
        flush();
      }
      options[opt.letter] = opt.text;
      lastLetter = opt.letter;
      continue;
    }

    // Non-option line after options closes the previous block.
    if (lastLetter) flush();

    if (QUIZ_MARKER.test(t)) continue;  // pure boundary, carries no content

    const num = t.match(NUMBERED);
    if (num) {
      if (stem.length) flush();
      sourceNumber = Number(num[1]);
      stem = [num[2]];
      stemLine = line;
      continue;
    }

    if (!stem.length) stemLine = line;
    stem.push(t);
  }
  flush();

  return { blocks, failed, signals };
}

/**
 * No lettered options — the case that used to yield nothing at all.
 *
 * A stem is a line carrying a blank or a question mark (or a number);
 * the lines after it, up to the next stem, are its options. This is what
 * lets a paste of four fill-in-the-blank items with bare choices parse
 * instead of silently producing zero.
 */
function splitByBareRuns(
  lines: Line[],
  expected: number,
  minOptions: number,
  signals: Record<BoundaryKind, number>,
): SplitResult {
  const blocks: RawBlock[] = [];
  const failed: FailedBlock[] = [];

  // Locate the stems first; everything between two stems belongs to the
  // first of them.
  const stemIdx: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (QUIZ_MARKER.test(lines[i].text)) continue;
    if (isStemLine(lines[i].text)) stemIdx.push(i);
  }

  /**
   * Punctuation found nothing — fall back to SHAPE.
   *
   * Plenty of real stems carry neither a blank nor a question mark:
   * "The word compatible in paragraph 1) is closest in meaning to",
   * "The passage suggests we should NOT use in our homes". What they do
   * have is option-shaped lines directly beneath them, which is the
   * document's own structure rather than a guess about wording.
   *
   * Only used when the punctuation pass came back empty, so it can never
   * override a stem that was positively identified.
   */
  if (!stemIdx.length) {
    for (let i = 0; i < lines.length; i++) {
      const following = lines.slice(i + 1).findIndex((l) => !couldBeBareOption(l.text));
      const runLength = following === -1 ? lines.length - i - 1 : following;
      if (runLength >= minOptions) { stemIdx.push(i); i += runLength; }
    }
  }

  /**
   * Options that are themselves questions.
   *
   * "What did Steve ask in his message to Tom?" is answered by four
   * candidate questions, so every line in the item ends in `?` and each
   * one looks like a stem. Read naively that is five questions with no
   * options; read structurally it is one question with four.
   *
   * The discriminator is contiguity: a real question is followed by its
   * options, never immediately by another stem with nothing between
   * them. So a run of adjacent stem lines collapses to the first as stem
   * and the rest as its options. Runs longer than five are left alone —
   * that is a parse failure, not an item.
   */
  const consumedAsOption = new Set<number>();
  for (let s = 0; s < stemIdx.length; s++) {
    const start = stemIdx[s];
    if (consumedAsOption.has(start)) continue;

    const run: number[] = [start];
    while (
      s + run.length < stemIdx.length &&
      stemIdx[s + run.length] === start + run.length
    ) {
      run.push(stemIdx[s + run.length]);
    }

    if (run.length >= minOptions + 1 && run.length <= OPTION_LETTERS.length + 1) {
      for (const idx of run.slice(1)) consumedAsOption.add(idx);
    }
  }

  if (!stemIdx.length) {
    // Nothing recognisable. Report the whole span rather than returning
    // an empty success — this is exactly the 0/0 silence being fixed.
    if (lines.length) {
      failed.push({
        reason:
          'لم يُعثر على أي بداية سؤال. لا ترقيم، ولا خيارات بحروف، ولا فراغ (......)، ' +
          'ولا علامة استفهام. راجع تنسيق النص.',
        sourceLine: lines[0].line,
        text: lines.slice(0, 20).map((l) => l.text).join('\n'),
      });
    }
    return { blocks, failed, signals };
  }

  for (let s = 0; s < stemIdx.length; s++) {
    const start = stemIdx[s];
    // Absorbed as an option by the stem above it.
    if (consumedAsOption.has(start)) continue;

    // The next stem that was NOT absorbed bounds this item.
    let end = lines.length;
    for (let k = s + 1; k < stemIdx.length; k++) {
      if (!consumedAsOption.has(stemIdx[k])) { end = stemIdx[k]; break; }
    }

    const stemRaw = lines[start].text;
    const num = stemRaw.match(NUMBERED);
    const sourceNumber = num ? Number(num[1]) : undefined;
    const stem = (num ? num[2] : stemRaw).trim();

    // Absorbed stem lines are options despite ending in `?`, so they
    // bypass couldBeBareOption — which exists to keep stems out of
    // options, exactly the judgement already made above.
    const candidates = lines
      .slice(start + 1, end)
      .filter((l, offset) =>
        consumedAsOption.has(start + 1 + offset) || couldBeBareOption(l.text));

    if (candidates.length < minOptions) {
      failed.push({
        reason: `السؤال وُجد لكن خياراته ${candidates.length} فقط (المطلوب ${minOptions})`,
        sourceLine: lines[start].line,
        text: lines.slice(start, end).map((l) => l.text).join('\n'),
      });
      continue;
    }

    // More candidates than a question can hold means the boundary is
    // wrong; keep it for review instead of inventing a grouping.
    if (candidates.length > expected + 2) {
      failed.push({
        reason: `عدد الخيارات ${candidates.length} يتجاوز المتوقع (${expected}) — حدّ السؤال غير واضح`,
        sourceLine: lines[start].line,
        text: lines.slice(start, end).map((l) => l.text).join('\n'),
      });
      continue;
    }

    const options: Partial<Record<OptionLetter, string>> = {};
    candidates.slice(0, OPTION_LETTERS.length).forEach((c, i) => {
      options[OPTION_LETTERS[i]] = c.text;
    });

    const warnings: string[] = [];
    if (candidates.length !== expected) {
      warnings.push(`عدد الخيارات ${candidates.length} بدل ${expected}`);
    }

    blocks.push({
      sourceNumber, stem, options,
      sourceLine: lines[start].line,
      boundary: BLANK_MARKER.test(stemRaw) ? 'blank-marker' : 'option-run',
      warnings,
    });
  }

  return { blocks, failed, signals };
}
