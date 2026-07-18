/**
 * Robust response parsing.
 *
 * Every provider claims to honour "return only JSON". None do it 100% of
 * the time. This recovers the array from fenced blocks, preambles, and
 * truncated output, then validates each element hard — a malformed item
 * is dropped and reported as missing, never coerced into a wrong answer.
 */

import type { OptionKey, QuestionCategory, SolveInput, SolveOutput } from './types';

const CATEGORIES: QuestionCategory[] = ['grammar', 'reading', 'listening', 'writing'];
const KEYS: OptionKey[] = ['A', 'B', 'C', 'D'];

/** Pull the outermost JSON array out of whatever the model actually sent. */
export function extractJsonArray(raw: string): unknown[] | null {
  const text = raw.trim();

  const direct = tryParse(text);
  if (Array.isArray(direct)) return direct;

  // ```json ... ``` fences
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    const inner = tryParse(fenced[1].trim());
    if (Array.isArray(inner)) return inner;
  }

  // First '[' to last ']' — handles preambles and trailing chatter.
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start !== -1 && end > start) {
    const slice = tryParse(text.slice(start, end + 1));
    if (Array.isArray(slice)) return slice;
  }

  // Truncated output (hit the token cap mid-array): salvage whole objects
  // by scanning balanced braces. Better to keep 40 of 50 answers than to
  // discard the batch and pay for it twice.
  if (start !== -1) {
    const salvaged = salvageObjects(text.slice(start));
    if (salvaged.length) return salvaged;
  }

  return null;
}

function tryParse(s: string): unknown {
  try { return JSON.parse(s); } catch { return null; }
}

function salvageObjects(src: string): unknown[] {
  const out: unknown[] = [];
  let depth = 0;
  let objStart = -1;
  let inStr = false;
  let esc = false;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === '{') { if (depth === 0) objStart = i; depth++; }
    else if (ch === '}') {
      depth--;
      if (depth === 0 && objStart !== -1) {
        const parsed = tryParse(src.slice(objStart, i + 1));
        if (parsed) out.push(parsed);
        objStart = -1;
      }
    }
  }
  return out;
}

export interface ParseResult {
  results: SolveOutput[];
  missing: string[];
}

/**
 * Validate raw elements against the questions actually sent.
 *
 * Alignment is by `ref`, never by array position. A model that drops one
 * item mid-batch would otherwise shift every subsequent answer onto the
 * wrong question — silently, and with plausible-looking explanations.
 */
export function validateResults(rawItems: unknown[], inputs: SolveInput[]): ParseResult {
  const byRef = new Map(inputs.map((q) => [q.ref, q]));
  const seen = new Set<string>();
  const results: SolveOutput[] = [];

  for (const item of rawItems) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;

    const ref = typeof o.ref === 'string' ? o.ref : null;
    if (!ref) continue;

    const input = byRef.get(ref);
    if (!input) continue;      // hallucinated ref
    if (seen.has(ref)) continue; // duplicate — keep the first

    const correctOption = typeof o.correctOption === 'string'
      ? (o.correctOption.trim().toUpperCase() as OptionKey)
      : null;
    if (!correctOption || !KEYS.includes(correctOption)) continue;

    // The chosen key must exist on THIS question. A model answering "D"
    // on a three-option item is a real, observed failure.
    if (!(correctOption in input.options) || !input.options[correctOption]?.trim()) continue;

    const explanationAr = typeof o.explanationAr === 'string' ? o.explanationAr.trim() : '';
    if (explanationAr.length < 10) continue;

    const category = typeof o.category === 'string' && CATEGORIES.includes(o.category as QuestionCategory)
      ? (o.category as QuestionCategory)
      : 'grammar';

    const rawConf = typeof o.confidence === 'number' ? o.confidence : 0.5;
    const confidence = Math.min(1, Math.max(0, rawConf));

    seen.add(ref);
    results.push({ ref, category, correctOption, explanationAr, confidence });
  }

  const missing = inputs.map((q) => q.ref).filter((r) => !seen.has(r));
  return { results, missing };
}

/** Fraction of the explanation that is Arabic script — a cheap language check. */
export function arabicRatio(text: string): number {
  const letters = text.replace(/[\s\d\p{P}\p{S}]/gu, '');
  if (!letters.length) return 0;
  const arabic = letters.match(/[؀-ۿݐ-ݿ]/g)?.length ?? 0;
  return arabic / letters.length;
}
