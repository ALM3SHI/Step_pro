/**
 * Structural normalisation — remove what is provably not question content,
 * by SHAPE, never by source.
 *
 * Every rule here keys on a structural property any document could have:
 * a line of nothing but one repeated symbol is a divider; a line that is
 * mostly Arabic script inside an English section is commentary. None of
 * it knows or cares which academy produced the file. A rule that did
 * would be caught by scripts/test-no-academy-logic.ts.
 *
 * Line numbers are preserved through a map so a block can still be traced
 * to its page after cleaning.
 */

export interface CleanResult {
  text: string;
  /** output line index -> input line index. */
  lineMap: number[];
}

/**
 * A divider: a line that is one punctuation character repeated.
 *
 * `~~~~~`, `-----`, `=====`, `*****`, `_____`, `.....` used as a rule
 * across the page. Four is the floor so an ellipsis blank (`....`) inside
 * a real question is never mistaken for a divider — though those are
 * handled before this runs, the margin is cheap.
 */
const DIVIDER = /^\s*([~\-=*_#·—–])\1{3,}\s*$/;

function scriptCounts(line: string): { arabic: number; latin: number } {
  const arabic = (line.match(/[؀-ۿݐ-ݿ]/g) ?? []).length;
  const latin = (line.match(/[A-Za-z]/g) ?? []).length;
  return { arabic, latin };
}

export interface CleanOptions {
  /**
   * The section's content language is English (reading, grammar,
   * writing, listening are all English on STEP). When true, a line that
   * is predominantly Arabic is treated as commentary and dropped.
   *
   * Kept as an option rather than assumed, so a future Arabic-content
   * section would simply pass false — still structural, not hardcoded.
   */
  expectEnglish?: boolean;
}

/**
 * Is this line commentary rather than content?
 *
 * True when Arabic letters dominate AND there is little English to lose.
 * A mixed line like "Passage 6 (الماتريوشكا)" is NOT dropped — it carries
 * English structure; only its Arabic run is stripped, elsewhere.
 */
function isForeignCommentary(line: string): boolean {
  const { arabic, latin } = scriptCounts(line);
  if (arabic === 0) return false;
  // Dominantly Arabic, with at most a few Latin characters (a stray "If"
  // or "On" inside an Arabic explanation does not make it English).
  return arabic > latin * 1.5 && latin <= 6;
}

/**
 * Strip Arabic runs from an otherwise-English line.
 *
 * "Passage 6 (الماتريوشكا)" -> "Passage 6 ()", then tidied to "Passage 6".
 * Only applied to lines kept as content, so a passage title survives with
 * its English intact and its Arabic gloss removed.
 */
function stripArabicRuns(line: string): string {
  return line
    .replace(/[؀-ۿݐ-ݿࢠ-ࣿ]+/g, ' ')
    // Empty brackets left by a removed Arabic gloss.
    .replace(/\(\s*\)/g, ' ')
    .replace(/\[\s*\]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function structuralClean(input: string, opts: CleanOptions = {}): CleanResult {
  const lines = input.split('\n');
  const outLines: string[] = [];
  const lineMap: number[] = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();

    if (DIVIDER.test(trimmed)) continue;

    if (opts.expectEnglish && trimmed) {
      if (isForeignCommentary(trimmed)) continue;
      const { arabic } = scriptCounts(trimmed);
      if (arabic > 0) {
        // Mixed line: keep the English, drop the Arabic gloss.
        const cleaned = stripArabicRuns(raw);
        if (!cleaned) continue;
        outLines.push(cleaned);
        lineMap.push(i);
        continue;
      }
    }

    outLines.push(raw);
    lineMap.push(i);
  }

  return { text: outLines.join('\n'), lineMap };
}

// ---------------------------------------------------------------------
// Inline options
// ---------------------------------------------------------------------

export type OptionLetter = 'A' | 'B' | 'C' | 'D';
const LETTERS: OptionLetter[] = ['A', 'B', 'C', 'D'];

export interface InlineOptions {
  /** Text with the option group removed, e.g. the bare stem. */
  stem: string;
  options: Partial<Record<OptionLetter, string>>;
}

/**
 * Separators an author uses BETWEEN options, most distinctive first.
 *
 * An en/em dash is almost never intra-option, so it wins. A spaced hyphen
 * is next. A slash and comma are last because they also appear inside a
 * single option ("had / had learned"), so they are only used when nothing
 * stronger is present.
 */
const SEPARATORS: Array<{ re: RegExp; label: string }> = [
  { re: /\s*[–—]\s*/, label: 'dash' },
  // A hyphen with whitespace on at least one side — "me - my", "at -in-
  // on". A hyphen with no adjacent space is intra-word ("well-known")
  // and must not split.
  { re: /\s+-\s*|\s*-\s+/, label: 'hyphen' },
  { re: /\s*\/\s*/, label: 'slash' },
];

function splitOptions(inner: string): string[] | null {
  for (const { re } of SEPARATORS) {
    const parts = inner.split(re).map((s) => s.trim()).filter(Boolean);
    if (parts.length >= 2 && parts.length <= 4) return parts;
  }
  return null;
}

/**
 * Pull an inline option group out of a line.
 *
 * Matches `(opt SEP opt SEP opt)` whether it is the whole line or embedded
 * mid-sentence ("was born (at - in - on) June 22"). The group is replaced
 * by a blank marker in the returned stem, so a fill-in item reads
 * naturally and a downstream length check still sees a short stem.
 *
 * Returns null when no parenthesised group yields a clean 2-4 split — so
 * ordinary prose parentheses ("(1)", "(see below)") are left untouched.
 */
export function extractInlineOptions(line: string): InlineOptions | null {
  // Every parenthesised group on the line; the widest that splits wins.
  const groups = [...line.matchAll(/\(([^()]{2,160})\)/g)];
  for (const g of groups.sort((a, b) => b[1].length - a[1].length)) {
    const opts = splitOptions(g[1]);
    if (!opts) continue;

    const options: Partial<Record<OptionLetter, string>> = {};
    opts.slice(0, 4).forEach((o, i) => { options[LETTERS[i]] = o; });

    const stem = line.replace(g[0], ' …… ').replace(/\s{2,}/g, ' ').trim();
    return { stem, options };
  }
  return null;
}
