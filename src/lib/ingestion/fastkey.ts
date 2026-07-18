/**
 * Fast-Key mapping engine.
 *
 * Parses an answer-key string produced by an external LLM (ChatGPT /
 * Gemini web) and binds it to staged questions.
 *
 * THE CENTRAL RISK: silent misalignment. If the model returns 98 keys for
 * 100 questions, or skips #47, position-based mapping shifts every
 * subsequent answer by one — producing 100 plausible-looking, wrong
 * records. So this engine binds by the DECLARED NUMBER, never by array
 * position, and reports anything it could not place instead of guessing.
 *
 * Supported shapes (mixed freely in one paste):
 *   1:A   1. A   1- A   1) A   1 A   [1] A   Q1: A   #1 A
 *   ١:أ   ٢-ب                      (Arabic digits and letters)
 *   **1.** A                       (markdown bold)
 *   | 1 | A |                      (markdown table rows)
 *   1. A — الفاعل مفرد غائب        (trailing explanation is captured)
 *   A, B, C, D                     (bare sequence — positional, flagged)
 */

import { normalizeDigits } from './normalize';

export type OptionKey = 'A' | 'B' | 'C' | 'D';

/** Arabic option letters map onto A-D positionally. */
const ARABIC_LETTER: Record<string, OptionKey> = {
  'أ': 'A', 'ا': 'A', 'ب': 'B', 'ج': 'C', 'د': 'D',
};

function toOptionKey(raw: string): OptionKey | null {
  const t = raw.trim();
  if (ARABIC_LETTER[t]) return ARABIC_LETTER[t];
  const up = t.toUpperCase();
  return up === 'A' || up === 'B' || up === 'C' || up === 'D' ? up : null;
}

export interface FastKeyEntry {
  /** 1-based question number as declared in the paste. */
  index: number;
  option: OptionKey;
  explanation?: string;
  raw: string;
}

export interface FastKeyParseResult {
  entries: FastKeyEntry[];
  /** Same index declared twice with DIFFERENT answers — never auto-resolved. */
  conflicts: Array<{ index: number; kept: OptionKey; discarded: OptionKey }>;
  /** Fragments that looked like a key but did not parse. */
  malformed: string[];
  /** True when no numbers were found and order was assumed. */
  positional: boolean;
  detectedFormat: string;
}

/**
 * Numbered pair.
 *
 * The letter must be followed by a non-letter, so "1. Around" does not
 * read as question 1 answer A. The optional trailing group captures an
 * explanation after a dash, colon, or em dash.
 */
const NUMBERED = new RegExp(
  [
    '(?:^|[\\s,;|])',                       // start or separator
    '\\*{0,2}\\s*',                         // markdown bold OPENING (**1.** A)
    '(?:[Qq]|#|\\[)?\\s*',                  // optional Q / # / [
    '(\\d{1,4})',                           // (1) index
    '\\s*[\\]\\)\\.\\-:\\|]?\\s*',          // separator: ) . - : ] |
    '\\*{0,2}\\s*',                         // markdown bold CLOSING
    '([A-Da-dأابجد])',                      // (2) option letter
    '(?![A-Za-z\\u0621-\\u064A])',          // not part of a longer word
    '\\s*(?:[\\-–—:]\\s*([^\\n|,;]{3,300}))?', // (3) optional explanation
  ].join(''),
  'g',
);

/** Bare letter sequence, e.g. "A B C D" or "A, B, C, D". */
const BARE_SEQUENCE = /^[\s,;|]*(?:[A-Da-dأابجد][\s,;|]+){2,}[A-Da-dأابجد][\s,;|]*$/;

export function parseFastKeys(input: string): FastKeyParseResult {
  const malformed: string[] = [];

  // Normalise digits first so ١٢٣ parses identically to 123. Deliberately
  // NOT running full punctuation normalisation — that rewrites the dashes
  // this parser uses as separators.
  const text = normalizeDigits(input).replace(/\r\n?/g, '\n').trim();
  if (!text) {
    return { entries: [], conflicts: [], malformed: [], positional: false, detectedFormat: 'empty' };
  }

  // --- pass 1: numbered pairs -----------------------------------------
  const byIndex = new Map<number, FastKeyEntry>();
  const conflicts: FastKeyParseResult['conflicts'] = [];
  let match: RegExpExecArray | null;

  /** Raw fragments that DID parse, including ones later discarded. */
  const consumed: string[] = [];

  NUMBERED.lastIndex = 0;
  while ((match = NUMBERED.exec(text))) {
    // The leading separator is part of the match, so lastIndex sits one
    // character past the separator that should START the next pair
    // ("1:A, 2:B" eats the comma). Step back ALWAYS — doing it only on
    // the success path silently swallowed the entry after any duplicate.
    if (NUMBERED.lastIndex > 0) NUMBERED.lastIndex -= 1;

    const index = Number(match[1]);
    const option = toOptionKey(match[2]);
    if (!option || index < 1) continue;

    const explanation = match[3]?.trim() || undefined;
    const entry: FastKeyEntry = { index, option, explanation, raw: match[0].trim() };
    consumed.push(entry.raw);

    const existing = byIndex.get(index);
    if (existing) {
      if (existing.option !== option) {
        // Two different answers for one question. Keep the FIRST and
        // report it — picking silently would be a coin flip on a wrong
        // answer that then looks verified.
        conflicts.push({ index, kept: existing.option, discarded: option });
      } else if (!existing.explanation && explanation) {
        existing.explanation = explanation;
      }
      continue;
    }

    byIndex.set(index, entry);
  }

  if (byIndex.size > 0) {
    const entries = [...byIndex.values()].sort((a, b) => a.index - b.index);

    // Surface lines that clearly intended to be keys but produced
    // nothing. Checked against everything CONSUMED, not just the entries
    // kept — a discarded duplicate was understood perfectly well, and
    // reporting it as unparseable sends the admin hunting a non-bug.
    for (const line of text.split('\n')) {
      const t = line.trim();
      if (!t || t.length > 200) continue;
      if (!/^\W*\d{1,4}\W/.test(t)) continue;
      const covered = consumed.some((raw) => t.includes(raw) || raw.includes(t));
      if (!covered) malformed.push(t.slice(0, 120));
    }

    return {
      entries,
      conflicts,
      malformed,
      positional: false,
      detectedFormat: describeFormat(entries[0]?.raw ?? ''),
    };
  }

  // --- pass 2: bare sequence (positional) ------------------------------
  const compact = text.replace(/\n/g, ' ');
  if (BARE_SEQUENCE.test(compact)) {
    const letters = compact.match(/[A-Da-dأابجد]/g) ?? [];
    const entries = letters
      .map((l, i) => {
        const option = toOptionKey(l);
        return option ? { index: i + 1, option, raw: l } : null;
      })
      .filter((e): e is FastKeyEntry => e !== null);

    return {
      entries,
      conflicts: [],
      malformed: [],
      // Order is ASSUMED here. The UI must warn: one missing letter
      // shifts every answer after it.
      positional: true,
      detectedFormat: 'bare sequence (order assumed)',
    };
  }

  return {
    entries: [],
    conflicts: [],
    malformed: text.split('\n').slice(0, 5).map((l) => l.trim()).filter(Boolean),
    positional: false,
    detectedFormat: 'unrecognised',
  };
}

function describeFormat(sample: string): string {
  const s = sample.trim();
  if (/^\d+\s*:/.test(s)) return '1: A';
  if (/^\d+\s*\./.test(s)) return '1. A';
  if (/^\d+\s*-/.test(s)) return '1 - A';
  if (/^\d+\s*\)/.test(s)) return '1) A';
  if (/^[Qq]/.test(s)) return 'Q1: A';
  return '1 A';
}

// ---------------------------------------------------------------------
// Binding
// ---------------------------------------------------------------------

export interface BindableQuestion {
  /** Stable id used by the staging UI. */
  ref: string;
  /** Needed by buildExternalPrompt, so the round trip uses one type. */
  questionText: string;
  options: Partial<Record<OptionKey, string>>;
}

export interface BindOutcome<T extends BindableQuestion> {
  /** Questions with a key successfully applied. */
  applied: Array<{ question: T; option: OptionKey; explanation?: string }>;
  /** Keys whose number falls outside the staged range. */
  outOfRange: FastKeyEntry[];
  /** Keys naming an option this question does not have (e.g. D on a 3-option item). */
  invalidOption: Array<{ entry: FastKeyEntry; ref: string }>;
  /** Staged questions no key covered. */
  unmatched: T[];
  conflicts: FastKeyParseResult['conflicts'];
  malformed: string[];
  positional: boolean;
  detectedFormat: string;
  stats: { staged: number; parsed: number; applied: number; coverage: number };
}

/**
 * Bind parsed keys onto staged questions.
 *
 * `questions` MUST be in the same order the admin pasted them, because
 * the key numbers refer to that order. Binding is by 1-based position in
 * that array — matching the numbering the external LLM was shown.
 */
export function bindFastKeys<T extends BindableQuestion>(
  questions: T[],
  parsed: FastKeyParseResult,
): BindOutcome<T> {
  const applied: BindOutcome<T>['applied'] = [];
  const outOfRange: FastKeyEntry[] = [];
  const invalidOption: BindOutcome<T>['invalidOption'] = [];
  const covered = new Set<string>();

  for (const entry of parsed.entries) {
    const q = questions[entry.index - 1];
    if (!q) {
      outOfRange.push(entry);
      continue;
    }
    // The key must name an option this question actually has. A model
    // answering "D" on a three-option item is a real, observed failure.
    if (!q.options[entry.option]?.trim()) {
      invalidOption.push({ entry, ref: q.ref });
      continue;
    }
    applied.push({ question: q, option: entry.option, explanation: entry.explanation });
    covered.add(q.ref);
  }

  const unmatched = questions.filter((q) => !covered.has(q.ref));

  return {
    applied,
    outOfRange,
    invalidOption,
    unmatched,
    conflicts: parsed.conflicts,
    malformed: parsed.malformed,
    positional: parsed.positional,
    detectedFormat: parsed.detectedFormat,
    stats: {
      staged: questions.length,
      parsed: parsed.entries.length,
      applied: applied.length,
      coverage: questions.length ? applied.length / questions.length : 0,
    },
  };
}

/**
 * Numbered prompt text for pasting into an external LLM.
 *
 * Emits the SAME numbering the binder expects, so the round trip cannot
 * drift. Asking for a bare "N: X" list keeps the reply short and cheap
 * to parse.
 */
export function buildExternalPrompt(
  questions: Array<{ questionText: string; options: Partial<Record<OptionKey, string>> }>,
  opts: { withExplanations?: boolean } = {},
): string {
  const head = opts.withExplanations
    ? 'Answer each STEP exam question. Reply ONLY as one line per question in the form "N: X - <short Arabic explanation>". No preamble.'
    : 'Answer each STEP exam question. Reply ONLY as a compact list in the form "N: X", comma separated. No preamble, no explanations.';

  const body = questions
    .map((q, i) => {
      const opts_ = (['A', 'B', 'C', 'D'] as OptionKey[])
        .filter((k) => q.options[k]?.trim())
        .map((k) => `${k}) ${q.options[k]}`)
        .join('  ');
      return `${i + 1}. ${q.questionText}\n   ${opts_}`;
    })
    .join('\n');

  return `${head}\n\n${body}`;
}
