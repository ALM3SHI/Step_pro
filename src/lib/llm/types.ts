export type OptionKey = 'A' | 'B' | 'C' | 'D';
export type QuestionCategory = 'grammar' | 'reading' | 'listening' | 'writing';

/** What the pipeline sends to a provider. */
export interface SolveInput {
  /** Stable id used to align responses back to questions. */
  ref: string;
  questionText: string;
  options: Partial<Record<OptionKey, string>>;
  /** Reading passage or listening transcript, when present. */
  stimulus?: string;
  /** Pre-known answer. When set, the model explains instead of solving. */
  knownAnswer?: OptionKey;
}

/** What a provider returns for one question. */
export interface SolveOutput {
  ref: string;
  category: QuestionCategory;
  correctOption: OptionKey;
  explanationAr: string;
  /** Model's own stated confidence, 0-1. Advisory only — we trust votes. */
  confidence: number;
}

export interface LLMResponse {
  results: SolveOutput[];
  /** Refs the model failed to return or returned unparseably. */
  missing: string[];
  usage?: { inputTokens?: number; outputTokens?: number };
}

export interface GenerateOptions {
  /**
   * 0 for a single deterministic pass; raised for self-consistency voting,
   * where identical sampling would defeat the point of voting.
   */
  temperature?: number;
  maxOutputTokens?: number;
  signal?: AbortSignal;
}

/**
 * The seam every provider implements. Swapping Gemini -> OpenAI -> a local
 * Ollama model must require no change above this interface.
 */
export interface LLMProvider {
  readonly name: string;
  readonly model: string;
  solveBatch(inputs: SolveInput[], opts?: GenerateOptions): Promise<LLMResponse>;
}

export class LLMError extends Error {
  constructor(
    message: string,
    readonly provider: string,
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'LLMError';
  }
}
