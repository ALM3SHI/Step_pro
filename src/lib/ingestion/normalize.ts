/**
 * Stage 1 — character-level normalisation.
 *
 * Runs before any regex noise stripping: the noise patterns assume
 * canonical characters, so repairing encoding and unifying the dozen
 * Unicode dash/quote/space variants first is what makes those patterns
 * hold at 99%+ rather than 90%.
 */

/**
 * Repair double-encoded UTF-8 ("mojibake").
 *
 * The grammar corpus contains sequences like `Fatherâ€™s`. That is
 * U+2019 -> UTF-8 bytes E2 80 99 -> misread as CP1252 -> "â€™" -> encoded
 * as UTF-8 again.
 *
 * The obvious fix -- round-trip the whole string through latin1 -- is
 * WRONG and silently destroys data: every already-correct character above
 * U+00FF is mangled by it. `charCodeAt(0) & 0xff` turns '…' (U+2026) into
 * '&', and turns every Arabic letter into garbage. So this repairs one
 * damaged run at a time and leaves everything else byte-identical.
 */
const MOJIBAKE_SIGNATURE = /[ÂÃâ€][-¿ -⁯™“”‘’¦§¬]/g;

/** CP1252 code points for bytes 0x80-0x9F, where it differs from Latin-1. */
const CP1252_HIGH: Record<string, number> = {
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84,
  '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88,
  '‰': 0x89, 'Š': 0x8a, '‹': 0x8b, 'Œ': 0x8c,
  'Ž': 0x8e, '‘': 0x91, '’': 0x92, '“': 0x93,
  '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97,
  '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b,
  'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f,
};

/** The CP1252 byte for a character, or null if it has none. */
function cp1252Byte(ch: string): number | null {
  const code = ch.codePointAt(0)!;
  if (code <= 0x7f) return code;
  if (code >= 0xa0 && code <= 0xff) return code;
  // Raw C1 controls U+0080-U+009F. These appear when the bad decode was
  // Latin-1 rather than CP1252 — which is what the real corpus contains
  // ("â" + U+0080 + U+0099, not "â€™"). Both forms must be handled.
  if (code >= 0x80 && code <= 0x9f) return code;
  return CP1252_HIGH[ch] ?? null;
}

/**
 * UTF-8 lead bytes as they render when misdecoded as CP1252:
 * C2/C3 -> Â/Ã (Latin-1 supplement), D8/D9 -> Ø/Ù (Arabic),
 * E2 -> â (general punctuation), E3-E9 -> ã-é.
 */
const MOJIBAKE_LEAD = /[Â-ÉØ-Ûâ-é]/;

export function repairMojibake(input: string): { text: string; repaired: boolean } {
  if (!MOJIBAKE_LEAD.test(input)) return { text: input, repaired: false };

  const decoder = new TextDecoder('utf-8', { fatal: true });
  let repaired = false;
  let out = '';
  let i = 0;

  while (i < input.length) {
    const ch = input[i];

    if (!MOJIBAKE_LEAD.test(ch)) {
      out += ch;
      i++;
      continue;
    }

    // Collect a candidate run: the lead, plus up to 3 characters whose
    // CP1252 bytes are UTF-8 continuation bytes (0x80-0xBF).
    const lead = cp1252Byte(ch);
    if (lead === null) { out += ch; i++; continue; }

    const bytes: number[] = [lead];
    let j = i + 1;
    while (j < input.length && bytes.length < 4) {
      const b = cp1252Byte(input[j]);
      if (b === null || b < 0x80 || b > 0xbf) break;
      bytes.push(b);
      j++;
    }

    if (bytes.length < 2) { out += ch; i++; continue; }

    // Accept the longest run that decodes as strictly-valid UTF-8.
    let decoded: string | null = null;
    let consumed = 0;
    for (let len = bytes.length; len >= 2; len--) {
      try {
        decoded = decoder.decode(Uint8Array.from(bytes.slice(0, len)));
        consumed = len;
        break;
      } catch {
        /* invalid at this length — try a shorter run */
      }
    }

    if (decoded !== null && !decoded.includes('�')) {
      out += decoded;
      i += consumed;
      repaired = true;
    } else {
      out += ch;
      i++;
    }
  }

  return { text: out, repaired };
}

/** Arabic-Indic and Eastern Arabic-Indic digits -> ASCII. */
const DIGIT_MAP: Record<string, string> = {
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
  '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4',
  '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
};

export function normalizeDigits(input: string): string {
  return input.replace(/[٠-٩۰-۹]/g, (d) => DIGIT_MAP[d] ?? d);
}

/**
 * Unify the punctuation variants that PDF extractors emit, so that a
 * single downstream pattern matches every dialect of "option marker"
 * and "ellipsis blank".
 */
export function normalizePunctuation(input: string): string {
  return input
    // Quotes
    .replace(/[‘’‚‛′´`]/g, "'")
    .replace(/[“”„‟″«»]/g, '"')
    // Dashes -> ASCII hyphen
    .replace(/[‐-―−⁃﹘﹣－]/g, '-')
    // Ellipsis char -> dots (blanks in STEP items are runs of dots)
    .replace(/…/g, '...')
    // Arabic comma / semicolon / question mark -> ASCII equivalents,
    // keeping the Arabic forms out of the boundary regexes.
    .replace(/،/g, ',')
    .replace(/؛/g, ';')
    .replace(/؟/g, '?')
    // Full-width Latin punctuation from CJK-mode PDFs
    .replace(/（/g, '(').replace(/）/g, ')')
    .replace(/．/g, '.').replace(/：/g, ':');
}

/**
 * Strip zero-width and bidi control characters.
 *
 * PDF exports of Arabic documents are littered with RLM/LRM/RLE/PDF
 * marks. They are invisible but break `^` anchors and word-boundary
 * matching, which is exactly how "clean-looking" text fails to parse.
 */
export function stripInvisibles(input: string): string {
  return input
    .replace(/[​-‏‪-‮⁦-⁩﻿­]/g, '')
    .replace(/ /g, ' ')      // NBSP -> space
    .replace(/[\t\v\f]/g, ' ');
}

/**
 * Collapse a run of dots/underscores used as a fill-in-the-blank into a
 * single canonical token. Without this, two copies of the same question
 * with 5 vs 7 dots hash differently and both survive dedupe.
 */
export function normalizeBlanks(input: string): string {
  return input
    .replace(/[.·]{3,}/g, ' ____ ')
    .replace(/_{2,}/g, ' ____ ')
    .replace(/-{3,}/g, ' ____ ');
}

/** Normalise line endings and collapse runs of blank lines to one. */
export function normalizeWhitespace(input: string): string {
  return input
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ ]{2,}/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Full stage-1 pass. */
export function normalize(input: string): { text: string; mojibakeRepaired: boolean } {
  const { text: repaired, repaired: didRepair } = repairMojibake(input);
  let out = stripInvisibles(repaired);
  out = normalizePunctuation(out);
  out = normalizeDigits(out);
  out = normalizeWhitespace(out);
  return { text: out, mojibakeRepaired: didRepair };
}
