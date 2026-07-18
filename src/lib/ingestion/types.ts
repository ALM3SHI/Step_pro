export type QuestionCategory = 'grammar' | 'reading' | 'listening';
export type OptionKey = 'A' | 'B' | 'C' | 'D';

/** A question after segmentation, before the LLM has seen it. */
export interface ParsedQuestion {
  questionText: string;
  options: Partial<Record<OptionKey, string>>;
  /** Set only when the source text carried an answer key. Our corpora do not. */
  correctOption?: OptionKey;
  contentHash: string;
  /** Index of the passage in PipelineResult.passages, if this is a reading item. */
  passageRef?: number;
  /** Source line number, for tracing a bad parse back to the raw paste. */
  sourceLine: number;
  /** Which segmentation strategy produced this. */
  strategy: SegmentStrategy;
  warnings: string[];
}

export type SegmentStrategy =
  | 'lettered'        // 1. Question / A) opt B) opt   -- classic PDF تجميعات
  | 'quiz-export'     // "N / M" markers, bare unlabelled option lines
  | 'numbered-bare'   // 1. Question, then bare option lines, no "N / M"
  | 'passage';        // reading passage + attached questions

export interface RejectedBlock {
  reason: string;
  sourceLine: number;
  excerpt: string;
}

export interface ParsedPassage {
  title?: string;
  body: string;
  contentHash: string;
}

export interface SegmentResult {
  questions: ParsedQuestion[];
  passages: ParsedPassage[];
  rejected: RejectedBlock[];
  strategy: SegmentStrategy;
  /** 0-1 confidence that the chosen strategy matched the document. */
  strategyConfidence: number;
}

export interface CleanStats {
  rawChars: number;
  cleanedChars: number;
  linesDropped: number;
  mojibakeRepaired: boolean;
}
