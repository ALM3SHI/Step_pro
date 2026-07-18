/**
 * Batched execution + self-consistency voting.
 *
 * The grammar and reading corpora ship with NO answer keys, so a single
 * model pass is unfalsifiable — a confident wrong answer is
 * indistinguishable from a confident right one. Self-consistency runs the
 * same question N times at non-zero temperature and keeps the majority.
 * Agreement is a far better accuracy signal than the model's own stated
 * confidence, which is close to useless for this.
 *
 * Anything short of unanimity is flagged for human review rather than
 * silently accepted — that flag is what gets you from ~95% to 99%+.
 */

import type { LLMProvider, OptionKey, QuestionCategory, SolveInput, SolveOutput } from './types';
import { LLMError } from './types';
import { arabicRatio } from './parse';

export type AnswerSource = 'provided_key' | 'llm_consensus' | 'llm_single' | 'human_review';

export interface SolvedQuestion {
  ref: string;
  category: QuestionCategory;
  correctOption: OptionKey;
  explanationAr: string;
  confidence: number;
  /** Share of voters that picked the winning option (1.0 = unanimous). */
  consensusRatio: number;
  votes: Partial<Record<OptionKey, number>>;
  answerSource: AnswerSource;
  needsHumanReview: boolean;
  reviewReasons: string[];
}

export interface SolverOptions {
  /** Questions per API call. 25-50 balances token limits against overhead. */
  chunkSize?: number;
  /** Voting passes. 1 disables voting; 3 or 5 (odd, to avoid ties) is typical. */
  votes?: number;
  /** Concurrent in-flight chunks. */
  concurrency?: number;
  /** Below this agreement ratio, flag for human review. */
  reviewThreshold?: number;
  maxRetries?: number;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number, note?: string) => void;
}

const DEFAULTS = {
  chunkSize: 25,
  votes: 3,
  concurrency: 3,
  reviewThreshold: 1.0,
  maxRetries: 4,
} as const;

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); reject(new Error('aborted')); }, { once: true });
  });

/**
 * One chunk, one voting pass, with retry.
 *
 * Retries only what is genuinely missing. Re-sending an entire 25-question
 * chunk because one item failed to parse triples the bill for no benefit.
 */
async function solveChunkOnce(
  provider: LLMProvider,
  inputs: SolveInput[],
  temperature: number,
  opts: Required<Pick<SolverOptions, 'maxRetries'>> & { signal?: AbortSignal },
): Promise<SolveOutput[]> {
  const collected = new Map<string, SolveOutput>();
  let pending = inputs;

  for (let attempt = 0; attempt <= opts.maxRetries && pending.length; attempt++) {
    try {
      const res = await provider.solveBatch(pending, { temperature, signal: opts.signal });
      for (const r of res.results) collected.set(r.ref, r);
      pending = pending.filter((q) => !collected.has(q.ref));
      if (!pending.length) break;

      // Partial success still counts as progress — don't back off hard.
      if (res.results.length > 0) continue;
    } catch (err) {
      const retryable = err instanceof LLMError ? err.retryable : false;
      if (!retryable || attempt === opts.maxRetries) {
        if (attempt === opts.maxRetries) break;
        throw err;
      }
    }

    // Exponential backoff with jitter, so parallel chunks hitting a 429
    // don't synchronise into a retry stampede.
    const backoff = Math.min(30_000, 800 * 2 ** attempt);
    await sleep(backoff + Math.floor(Math.random() * 400), opts.signal);
  }

  return [...collected.values()];
}

/** Tally votes for one question across passes. */
function tally(ref: string, passes: SolveOutput[][], input: SolveInput, reviewThreshold: number): SolvedQuestion | null {
  const mine = passes.map((p) => p.find((r) => r.ref === ref)).filter((r): r is SolveOutput => Boolean(r));
  if (!mine.length) return null;

  const votes: Partial<Record<OptionKey, number>> = {};
  for (const r of mine) votes[r.correctOption] = (votes[r.correctOption] ?? 0) + 1;

  const ranked = (Object.entries(votes) as Array<[OptionKey, number]>).sort((a, b) => b[1] - a[1]);
  const [winner, winnerVotes] = ranked[0];
  const consensusRatio = winnerVotes / mine.length;

  // Take the explanation from a pass that actually chose the winner —
  // otherwise you ship an explanation arguing for the losing option.
  const winningPasses = mine.filter((r) => r.correctOption === winner);
  const best = winningPasses.reduce((a, b) => (b.confidence > a.confidence ? b : a));

  const reviewReasons: string[] = [];
  if (consensusRatio < reviewThreshold) {
    reviewReasons.push(`voters split ${ranked.map(([k, v]) => `${k}:${v}`).join(' ')}`);
  }
  if (best.confidence < 0.6) reviewReasons.push(`low model confidence ${best.confidence.toFixed(2)}`);
  if (mine.length < passes.length) reviewReasons.push(`only ${mine.length}/${passes.length} passes returned this item`);

  // An "Arabic" explanation that is mostly Latin script means the model
  // drifted into English — a silent quality failure worth catching.
  const ratio = arabicRatio(best.explanationAr);
  if (ratio < 0.35) reviewReasons.push(`explanation only ${(ratio * 100).toFixed(0)}% Arabic script`);

  // A verified key overrides the vote entirely.
  const hasKey = Boolean(input.knownAnswer);
  if (hasKey && input.knownAnswer !== winner) {
    reviewReasons.push(`model chose ${winner} but verified key is ${input.knownAnswer}`);
  }

  const answerSource: AnswerSource = hasKey
    ? 'provided_key'
    : passes.length > 1
      ? 'llm_consensus'
      : 'llm_single';

  return {
    ref,
    category: best.category,
    correctOption: hasKey ? input.knownAnswer! : winner,
    explanationAr: best.explanationAr,
    confidence: best.confidence,
    consensusRatio,
    votes,
    answerSource,
    needsHumanReview: reviewReasons.length > 0,
    reviewReasons,
  };
}

/** Run `thunks` with a bounded number in flight at once. */
async function pooled<T>(thunks: Array<() => Promise<T>>, limit: number): Promise<T[]> {
  const results: T[] = new Array(thunks.length);
  let next = 0;

  const workers = Array.from({ length: Math.min(limit, thunks.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= thunks.length) return;
      results[i] = await thunks[i]();
    }
  });

  await Promise.all(workers);
  return results;
}

export interface SolveReport {
  solved: SolvedQuestion[];
  /** Refs no pass ever returned. */
  failed: string[];
  stats: {
    total: number;
    solvedCount: number;
    unanimous: number;
    flaggedForReview: number;
    failedCount: number;
    chunks: number;
    votes: number;
  };
}

export async function solveAll(
  provider: LLMProvider,
  inputs: SolveInput[],
  options: SolverOptions = {},
): Promise<SolveReport> {
  const cfg = { ...DEFAULTS, ...options };
  const chunks = chunk(inputs, cfg.chunkSize);
  const solved: SolvedQuestion[] = [];
  const failed: string[] = [];
  let done = 0;

  for (const group of chunks) {
    // Pass 0 is deterministic (temp 0); later passes are sampled, since
    // repeating a greedy decode would produce identical output and make
    // "voting" meaningless.
    const passThunks = Array.from({ length: cfg.votes }, (_, v) => () =>
      solveChunkOnce(provider, group, v === 0 ? 0 : 0.7, {
        maxRetries: cfg.maxRetries,
        signal: cfg.signal,
      }).catch(() => [] as SolveOutput[]),
    );

    const passes = await pooled(passThunks, cfg.concurrency);

    for (const input of group) {
      const result = tally(input.ref, passes, input, cfg.reviewThreshold);
      if (result) solved.push(result);
      else failed.push(input.ref);
    }

    done += group.length;
    cfg.onProgress?.(done, inputs.length, `${solved.length} solved, ${failed.length} failed`);
  }

  return {
    solved,
    failed,
    stats: {
      total: inputs.length,
      solvedCount: solved.length,
      unanimous: solved.filter((s) => s.consensusRatio === 1).length,
      flaggedForReview: solved.filter((s) => s.needsHumanReview).length,
      failedCount: failed.length,
      chunks: chunks.length,
      votes: cfg.votes,
    },
  };
}
