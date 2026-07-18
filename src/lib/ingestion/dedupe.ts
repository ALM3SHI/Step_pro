/**
 * Stage 4 — deduplication.
 *
 * The hash is computed over an aggressively canonicalised form so that
 * cosmetic differences between two copies of the same question (dot-count
 * in a blank, casing, option order, trailing punctuation) collapse to one
 * hash. Getting this wrong in either direction is expensive: too loose
 * and distinct questions vanish; too strict and you pay the LLM twice.
 */

// Isomorphic by necessity: the hybrid admin workflow parses in the
// browser, and node:crypto cannot be bundled there. See sha256.ts.
import { sha256Hex } from './sha256';
import type { OptionKey, ParsedQuestion } from './types';

/**
 * Canonical form for hashing. Deliberately lossy — this string is never
 * displayed or stored, only hashed.
 */
export function canonicalize(input: string): string {
  return input
    .toLowerCase()
    // Blanks of any length/character collapse to one token.
    .replace(/[.·]{2,}|_{2,}|-{3,}/g, ' _ ')
    // Arabic diacritics carry no lexical weight here.
    .replace(/[ً-ْٰـ]/g, '')
    // Alef / ya / ta-marbuta orthographic variants.
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    // Drop all punctuation and symbols; keep letters, digits, spaces.
    .replace(/[^\p{L}\p{N}\s_]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function hashText(text: string): string {
  return sha256Hex(canonicalize(text));
}

/**
 * Hash question + options together.
 *
 * Options are sorted before hashing, so the same item with shuffled
 * choices — very common across different تجميعات compilations — produces
 * one hash instead of four.
 */
export function hashQuestion(
  questionText: string,
  options: Partial<Record<OptionKey, string>>,
): string {
  const present = Object.values(options).filter((v): v is string => Boolean(v && v.trim()));
  const canonOptions = present.map(canonicalize).sort();

  // Capitalization/punctuation items canonicalise all four options to the
  // same string (case and commas are exactly what they test). When that
  // collapse happens, fall back to the raw option text so two distinct
  // items built on the same sentence do not collide into one hash.
  const collapsed = new Set(canonOptions).size < present.length;
  const optionPart = collapsed
    ? present.map((v) => v.trim()).sort().join('|')
    : canonOptions.join('|');

  return sha256Hex(`${canonicalize(questionText)}::${optionPart}`);
}

export interface DedupeResult {
  unique: ParsedQuestion[];
  duplicatesInBatch: ParsedQuestion[];
  duplicatesInDatabase: ParsedQuestion[];
}

/**
 * Split a parsed set into new vs already-known.
 *
 * `existingHashes` should be the result of a single
 * `select content_hash from questions where content_hash in (...)`
 * query — batched, not one round trip per question.
 */
export function dedupe(
  questions: ParsedQuestion[],
  existingHashes: ReadonlySet<string>,
): DedupeResult {
  const seen = new Set<string>();
  const unique: ParsedQuestion[] = [];
  const duplicatesInBatch: ParsedQuestion[] = [];
  const duplicatesInDatabase: ParsedQuestion[] = [];

  for (const q of questions) {
    if (existingHashes.has(q.contentHash)) {
      duplicatesInDatabase.push(q);
      continue;
    }
    if (seen.has(q.contentHash)) {
      duplicatesInBatch.push(q);
      continue;
    }
    seen.add(q.contentHash);
    unique.push(q);
  }

  return { unique, duplicatesInBatch, duplicatesInDatabase };
}
