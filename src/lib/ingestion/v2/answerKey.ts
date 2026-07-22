/**
 * Stage 1 — answer-key extraction.
 *
 * Runs BEFORE any segmentation and physically removes the key regions
 * from the text handed to the parsers.
 *
 * This ordering is the whole point. The previous engine parsed first, so
 * a key block sitting under the last question was read as more option
 * text and produced:
 *
 *   D) "He failed the midterm Answers: 1 C 2 A"
 *
 * — the last option corrupted AND every key lost. A key is metadata
 * about questions, not part of one, so it is lifted out first and bound
 * back by number afterwards.
 */

export type OptionLetter = 'A' | 'B' | 'C' | 'D';

export interface AnswerKeyEntry {
  /** 1-based question number as printed in the source. */
  number: number;
  option: OptionLetter;
  /** Line in the original text, for the report. */
  sourceLine: number;
}

export interface AnswerKeyResult {
  entries: AnswerKeyEntry[];
  /** Text with every key region removed — what the parsers receive. */
  text: string;
  /** Numbers that appeared more than once with different letters. */
  conflicts: Array<{ number: number; options: OptionLetter[] }>;
  /** Key-ish lines that could not be read, kept for the report. */
  malformed: string[];
  /** How the key section was recognised, for the report. */
  detectedFormat: string | null;
  removedLineCount: number;
  /**
   * Output line index -> original line index.
   *
   * Key removal renumbers everything after it, so without this a parser
   * reporting "line 214" points at the wrong place in the source — and
   * page numbers, which are derived from original lines, would be wrong
   * for every question after the first key block.
   */
  lineMap: number[];
}

/**
 * Headers that introduce a key section.
 *
 * A header alone is not enough to delete anything — the lines after it
 * must actually look like keys. "Answers" is also an ordinary English
 * word and appears inside real reading passages.
 */
const KEY_HEADER =
  /^\s*(?:answers?|answer\s*keys?|key|solutions?|الإجابات?|مفاتيح\s*الإجابات?|الحلول?|الاجابات?)\s*[:：\-–]?\s*$/i;

/**
 * One key on its own line: `1 C` `1. C` `1) C` `1 - c` `1: C`.
 *
 * The letter must be the WHOLE remainder. Without that anchor this
 * matches the opening of a real question ("1. Choose the correct...")
 * and deletes it.
 */
const KEY_LINE = /^\s*(\d{1,4})\s*[.)\-:–]?\s*([A-Da-d])\s*$/;

/** Several keys on one line: `1 C 2 D 3 A` or `1-C, 2-D, 3-A`. */
const KEY_RUN = /(\d{1,4})\s*[.)\-:–]?\s*([A-Da-d])(?=\s|,|;|$)/g;

/** A line that is nothing but keys — at least three, so prose cannot match. */
function isKeyRunLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  const matches = [...trimmed.matchAll(KEY_RUN)];
  if (matches.length < 3) return false;
  // Everything on the line must be accounted for by the key pattern;
  // otherwise it is prose that happens to contain "3 a".
  const consumed = matches.reduce((n, m) => n + m[0].length, 0);
  const separators = (trimmed.match(/[\s,;]/g) ?? []).length;
  return consumed + separators >= trimmed.length * 0.9;
}

/**
 * Lift every answer key out of the text.
 *
 * Two shapes are handled: a dedicated key SECTION introduced by a header,
 * and stray key lines anywhere in the document. Both are removed from the
 * returned text so no parser can mistake them for content.
 */
export function extractAnswerKeys(input: string): AnswerKeyResult {
  const lines = input.split('\n');
  const keep: boolean[] = new Array(lines.length).fill(true);
  const byNumber = new Map<number, { options: OptionLetter[]; line: number }>();
  const malformed: string[] = [];
  let detectedFormat: string | null = null;

  const record = (n: number, letter: string, line: number) => {
    const option = letter.toUpperCase() as OptionLetter;
    const existing = byNumber.get(n);
    if (existing) {
      if (!existing.options.includes(option)) existing.options.push(option);
    } else {
      byNumber.set(n, { options: [option], line });
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // --- a header, followed by actual keys ---
    if (KEY_HEADER.test(line)) {
      // Look ahead past blank lines for evidence before deleting anything.
      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) j++;
      const looksLikeKeys =
        j < lines.length && (KEY_LINE.test(lines[j]) || isKeyRunLine(lines[j]));

      if (looksLikeKeys) {
        detectedFormat ??= 'key section';
        keep[i] = false;
        // Consume the run of key lines that follows.
        for (let k = j; k < lines.length; k++) {
          const l = lines[k];
          if (!l.trim()) { keep[k] = false; continue; }
          if (KEY_LINE.test(l)) {
            const m = l.match(KEY_LINE)!;
            record(Number(m[1]), m[2], k + 1);
            keep[k] = false;
            continue;
          }
          if (isKeyRunLine(l)) {
            for (const m of l.matchAll(KEY_RUN)) record(Number(m[1]), m[2], k + 1);
            keep[k] = false;
            continue;
          }
          // Anything else ends the section.
          break;
        }
        continue;
      }
      // Header with no keys after it is ordinary text; leave it alone.
    }

    // --- stray key lines outside a section ---
    if (KEY_LINE.test(line)) {
      const m = line.match(KEY_LINE)!;
      record(Number(m[1]), m[2], i + 1);
      keep[i] = false;
      detectedFormat ??= 'inline key lines';
      continue;
    }

    if (isKeyRunLine(line)) {
      for (const m of line.matchAll(KEY_RUN)) record(Number(m[1]), m[2], i + 1);
      keep[i] = false;
      detectedFormat ??= 'key run';
      continue;
    }
  }

  const entries: AnswerKeyEntry[] = [];
  const conflicts: AnswerKeyResult['conflicts'] = [];

  for (const [number, { options, line }] of [...byNumber].sort((a, b) => a[0] - b[0])) {
    if (options.length > 1) {
      // Two different letters for one number: reported, never guessed.
      // Picking one would silently key a question wrong, which is the
      // most expensive defect this bank can carry.
      conflicts.push({ number, options });
      continue;
    }
    entries.push({ number, option: options[0], sourceLine: line });
  }

  const removedLineCount = keep.filter((k) => !k).length;

  const lineMap: number[] = [];
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!keep[i]) continue;
    lineMap.push(i);
    kept.push(lines[i]);
  }

  return {
    entries,
    text: kept.join('\n'),
    conflicts,
    malformed,
    detectedFormat,
    removedLineCount,
    lineMap,
  };
}

// ---------------------------------------------------------------------
// Binding
// ---------------------------------------------------------------------

export interface BindableItem {
  /** The number printed in the source, when the parser recovered one. */
  sourceNumber?: number;
  options: Partial<Record<OptionLetter, string>>;
}

export interface BindResult {
  /** option per item index. */
  applied: Map<number, OptionLetter>;
  /** Keys whose number matched no question. */
  unmatchedKeys: AnswerKeyEntry[];
  /** Item indexes left without a key. */
  unkeyedItems: number[];
  /** Keys naming an option the question does not have. */
  invalidOption: Array<{ number: number; option: OptionLetter }>;
}

/**
 * Attach keys to parsed questions.
 *
 * Matching is by the source number when the parser recovered one, and
 * falls back to 1-based position only when NO item has a number — a
 * document with partial numbering would otherwise bind keys to the wrong
 * questions, which is worse than leaving them unkeyed.
 */
export function bindAnswerKeys(
  items: BindableItem[],
  keys: AnswerKeyEntry[],
): BindResult {
  const applied = new Map<number, OptionLetter>();
  const invalidOption: BindResult['invalidOption'] = [];
  const usedKeys = new Set<number>();

  const numbered = items.filter((i) => typeof i.sourceNumber === 'number').length;
  const byPosition = numbered === 0;

  const indexFor = (keyNumber: number): number => {
    if (byPosition) return keyNumber - 1;
    return items.findIndex((i) => i.sourceNumber === keyNumber);
  };

  for (const key of keys) {
    const idx = indexFor(key.number);
    if (idx < 0 || idx >= items.length) continue;

    const item = items[idx];
    if (!item.options[key.option]?.trim()) {
      // A key naming an option the item does not have is a real, observed
      // failure (D on a three-option question) and must not be written.
      invalidOption.push({ number: key.number, option: key.option });
      usedKeys.add(key.number);
      continue;
    }

    applied.set(idx, key.option);
    usedKeys.add(key.number);
  }

  return {
    applied,
    unmatchedKeys: keys.filter((k) => !usedKeys.has(k.number)),
    unkeyedItems: items.map((_, i) => i).filter((i) => !applied.has(i)),
    invalidOption,
  };
}
