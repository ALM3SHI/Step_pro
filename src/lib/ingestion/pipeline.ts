/**
 * The ingestion pipeline: raw paste -> validated, deduplicated questions.
 *
 * Stage order matters and is not arbitrary:
 *   1. normalize  — repair encoding first; every later regex assumes
 *                   canonical characters.
 *   2. detect     — choose a strategy BEFORE stripping, so the stripper
 *                   knows which markers are boundaries vs pagination.
 *   3. stripNoise — with those markers protected.
 *   4. segment    — structural parse + validation.
 *   5. dedupe     — hash against the batch and the database.
 *
 * The LLM stage consumes `result.questions` and is deliberately not part
 * of this module: cleaning must be testable without an API key.
 */

import { normalize } from './normalize';
import { stripNoise } from './noise';
import { detectStrategy, protectedMarkersFor, segment } from './segment';
import { dedupe } from './dedupe';
import type { ParsedPassage, ParsedQuestion, RejectedBlock, SegmentStrategy } from './types';

export interface PipelineOptions {
  /** Hashes already present in the DB. Empty set = treat everything as new. */
  existingHashes?: ReadonlySet<string>;
  /** Override auto-detection. */
  forceStrategy?: SegmentStrategy;
}

export interface PipelineResult {
  questions: ParsedQuestion[];
  passages: ParsedPassage[];
  rejected: RejectedBlock[];
  stats: {
    rawChars: number;
    cleanedChars: number;
    mojibakeRepaired: boolean;
    linesDropped: number;
    droppedByLabel: Record<string, number>;
    strategy: SegmentStrategy;
    strategyConfidence: number;
    parsed: number;
    duplicatesInBatch: number;
    duplicatesInDatabase: number;
    rejected: number;
    unique: number;
    /** parsed / (parsed + rejected) — the headline accuracy number. */
    yieldRate: number;
  };
}

export function runPipeline(raw: string, opts: PipelineOptions = {}): PipelineResult {
  const { text: normalized, mojibakeRepaired } = normalize(raw);

  // Detect on normalized-but-unstripped text: the stripper can destroy
  // the very markers detection depends on.
  const detected = detectStrategy(normalized);
  const strategy = opts.forceStrategy ?? detected.strategy;

  const stripped = stripNoise(normalized, {
    preserveMarkers: protectedMarkersFor(strategy),
  });

  const seg = segment(stripped.text, strategy);

  // Translate stripped-text line numbers back to lines in the raw paste,
  // so a rejection an admin investigates points at the right place.
  const toRawLine = (n: number) => stripped.lineMap[n - 1] ?? n;
  for (const q of seg.questions) q.sourceLine = toRawLine(q.sourceLine);
  for (const r of seg.rejected) r.sourceLine = toRawLine(r.sourceLine);

  const { unique, duplicatesInBatch, duplicatesInDatabase } = dedupe(
    seg.questions,
    opts.existingHashes ?? new Set(),
  );

  const parsed = seg.questions.length;
  const rejectedCount = seg.rejected.length;

  return {
    questions: unique,
    passages: seg.passages,
    rejected: seg.rejected,
    stats: {
      rawChars: raw.length,
      cleanedChars: stripped.text.length,
      mojibakeRepaired,
      linesDropped: stripped.linesDropped,
      droppedByLabel: stripped.droppedByLabel,
      strategy: seg.strategy,
      strategyConfidence: seg.strategyConfidence,
      parsed,
      duplicatesInBatch: duplicatesInBatch.length,
      duplicatesInDatabase: duplicatesInDatabase.length,
      rejected: rejectedCount,
      unique: unique.length,
      yieldRate: parsed + rejectedCount === 0 ? 0 : parsed / (parsed + rejectedCount),
    },
  };
}
