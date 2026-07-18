/**
 * Stage 2 — noise stripping.
 *
 * Two tiers:
 *   INLINE  — patterns removed from within a line (URLs, phone numbers).
 *   LINE    — patterns that condemn the whole line (watermarks, page
 *             numbers, quiz-engine chrome).
 *
 * Every pattern carries a `label` so the pipeline can report *what* it
 * dropped. Silent stripping is how a cleaner quietly eats real questions.
 */

export interface NoisePattern {
  label: string;
  re: RegExp;
}

/** Removed from inside an otherwise-valid line. */
export const INLINE_NOISE: NoisePattern[] = [
  { label: 'url',            re: /\b(?:https?:\/\/|www\.)[^\s<>"']+/gi },
  { label: 'telegram-link',  re: /\b(?:t\.me|telegram\.me)\/[^\s]+/gi },
  { label: 'telegram-handle',re: /(?<![\w@])@[A-Za-z0-9_]{4,32}\b/g },
  { label: 'email',          re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  // Saudi mobile / landline in the many shapes PDFs contain.
  { label: 'phone',          re: /(?:\+?966|00966)[\s-]?5\d[\s-]?\d{3}[\s-]?\d{4}\b/g },
  { label: 'phone-local',    re: /\b0?5\d{8}\b/g },
  { label: 'phone-generic',  re: /\b\d{3}[\s-]\d{3}[\s-]\d{4}\b/g },
  { label: 'hashtag',        re: /(?<![\w#])#[\p{L}\p{N}_]{3,40}\b/gu },
  { label: 'emoji',          re: /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2B00}-\u{2BFF}]/gu },
];

/**
 * Kill the entire line on match.
 *
 * Ordering note: these run *after* inline stripping, so a line that was
 * nothing but a URL is already empty and gets dropped as blank.
 */
export const LINE_NOISE: NoisePattern[] = [
  // --- Quiz-engine chrome (matches the real gramer_bank.txt export) ---
  { label: 'quiz-unanswered', re: /^you have not answered this question\.?$/i },
  { label: 'quiz-answered',   re: /^(?:your answer is|correct answer is|you answered)\b.*$/i },
  { label: 'quiz-flag',       re: /^(?:flag question|mark for review|not yet answered|question \d+ of \d+)$/i },
  { label: 'quiz-marks',      re: /^(?:marked out of|points?:)\s*[\d.]+$/i },

  // --- Arabic promotional / watermark lines ---
  { label: 'ar-collections',  re: /^.{0,40}(?:أحدث\s+التجميعات|تجميعات\s+محدثة|التجميعات\s+الأخيرة).{0,40}$/ },
  { label: 'ar-academy',      re: /^.{0,60}(?:أكاديمي[ةه]|معهد|مركز|منصة|دورات|كورس)\s.{0,60}$/ },
  { label: 'ar-promo',        re: /(?:للاشتراك|للتواصل|واتساب|واتس\s?اب|انضم|اشترك|تابعنا|حسابنا|قناتنا|رابط\s+القناة|جميع\s+الحقوق)/ },
  { label: 'ar-freebie',      re: /^.{0,60}(?:مجان[اًي]?|بدون\s+مقابل|نسخة\s+مجانية).{0,60}$/ },
  { label: 'ar-goodluck',     re: /^(?:بالتوفيق|وفقكم\s+الله|دعواتكم|تم\s+بحمد\s+الله)\b.{0,40}$/ },

  // --- English promotional ---
  { label: 'en-promo',        re: /^.{0,80}\b(?:subscribe|join our|follow us|all rights reserved|copyright|prepared by|compiled by)\b.{0,80}$/i },

  // --- Pagination / structural chrome ---
  { label: 'page-number',     re: /^-?\s*(?:page|صفحة|ص)?\s*\d{1,4}\s*(?:\/|of|من)?\s*\d{0,4}\s*-?$/i },
  { label: 'bare-number',     re: /^\d{1,4}$/ },
  { label: 'separator',       re: /^[-=_*~•.#|]{3,}$/ },
  { label: 'pdf-artifact',    re: /^(?:untitled|document|scanned by|converted by|created with)\b.*$/i },
];

/**
 * Lines matching LINE_NOISE are normally dropped — but a promotional
 * pattern can false-positive on a genuine question that happens to
 * mention e.g. "the academy". A line is rescued if it looks structural:
 * it carries an option marker or a question-number prefix.
 */
const STRUCTURAL_HINT = /^(?:\d{1,3}\s*[.)\/-]|q\s*\d|س\s*\d|[A-Da-d][).\]]|\[[A-Da-d]\]|[أ-د]\s*[-.)])/i;

export interface StripResult {
  text: string;
  linesDropped: number;
  droppedByLabel: Record<string, number>;
  /**
   * kept-line index -> 1-based line number in the input.
   *
   * Without this, a rejection reported at "line 68" points into the
   * stripped text, and the admin looking at their original paste finds
   * an unrelated question there.
   */
  lineMap: number[];
}

export interface StripOptions {
  /**
   * Lines matching any of these are never dropped.
   *
   * This exists because of a real collision: the `page-number` pattern
   * matches `1 / 150`, which in the quiz-export corpus is the *question
   * boundary marker*, not pagination. Strategy detection therefore runs
   * before stripping, and passes the boundary pattern in here.
   */
  preserveMarkers?: RegExp[];
}

export function stripNoise(input: string, opts: StripOptions = {}): StripResult {
  const preserve = opts.preserveMarkers ?? [];
  const droppedByLabel: Record<string, number> = {};
  const kept: string[] = [];
  const lineMap: number[] = [];
  let linesDropped = 0;

  const bump = (label: string) => {
    droppedByLabel[label] = (droppedByLabel[label] ?? 0) + 1;
  };

  const keep = (line: string, originalIdx: number) => {
    kept.push(line);
    lineMap.push(originalIdx + 1);   // 1-based
  };

  const inputLines = input.split('\n');

  /**
   * Indices of bare-number lines that are actually ANSWER OPTIONS, not
   * pagination.
   *
   * Reading questions routinely have numeric options -- "When did Piri
   * Reis present his book?" answered by 1513 / 1525 / 1531 / 1552. Those
   * match the page-number and bare-number patterns exactly, and dropping
   * them silently destroys the question. A page number appears alone; an
   * option appears in a run with its siblings, so a run of 2+ adjacent
   * bare numbers is treated as an option list and protected.
   */
  const numericOptionLines = new Set<number>();
  {
    const isBareNumber = (s: string) => /^\d{1,4}$/.test(s.trim());
    let run: number[] = [];
    const flushRun = () => {
      if (run.filter((i) => isBareNumber(inputLines[i])).length >= 2) {
        for (const i of run) if (isBareNumber(inputLines[i])) numericOptionLines.add(i);
      }
      run = [];
    };
    for (let i = 0; i < inputLines.length; i++) {
      if (inputLines[i].trim() === '') flushRun();
      else run.push(i);
    }
    flushRun();
  }

  for (let i = 0; i < inputLines.length; i++) {
    let line = inputLines[i];

    // Protected boundary markers bypass both tiers untouched.
    if (preserve.some((re) => { re.lastIndex = 0; return re.test(line.trim()); })) {
      keep(line.trim(), i);
      continue;
    }

    // Tier 1: inline removal.
    for (const { label, re } of INLINE_NOISE) {
      re.lastIndex = 0;
      if (re.test(line)) {
        re.lastIndex = 0;
        line = line.replace(re, ' ');
        bump(label);
      }
    }
    line = line.replace(/[ ]{2,}/g, ' ').trim();

    if (line === '') {
      // Preserve paragraph breaks: a blank line is a boundary signal the
      // segmenter relies on. Only collapse consecutive blanks.
      if (kept.length && kept[kept.length - 1] !== '') keep('', i);
      continue;
    }

    // Tier 2: whole-line rejection, with a structural rescue.
    const isStructural = STRUCTURAL_HINT.test(line);
    let condemned: string | null = null;
    for (const { label, re } of LINE_NOISE) {
      re.lastIndex = 0;
      if (re.test(line)) { condemned = label; break; }
    }

    // A numeric line that belongs to an option run outranks both the
    // pagination and bare-number verdicts.
    if ((condemned === 'page-number' || condemned === 'bare-number') && numericOptionLines.has(i)) {
      condemned = null;
    }

    if (condemned && !(isStructural && condemned.startsWith('ar-'))) {
      linesDropped++;
      bump(condemned);
      continue;
    }

    keep(line, i);
  }

  // Trim leading/trailing blanks off BOTH arrays together, so lineMap
  // stays index-aligned with the emitted text. (A bare .trim() on the
  // joined string would silently shift every line number by one.)
  let head = 0;
  let tail = kept.length;
  while (head < tail && kept[head] === '') head++;
  while (tail > head && kept[tail - 1] === '') tail--;

  return {
    text: kept.slice(head, tail).join('\n'),
    linesDropped,
    droppedByLabel,
    lineMap: lineMap.slice(head, tail),
  };
}
