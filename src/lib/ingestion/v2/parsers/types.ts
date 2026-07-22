import type { FailedBlock, OptionLetter } from '../blocks';
import type { SectionId } from '../../../content/taxonomy';

/**
 * One parser per section, chosen by the maintainer's explicit choice.
 *
 * The old engine ran a single regex tournament and let density decide
 * which of four strategies to apply. It guessed wrong on short pastes,
 * and a wrong guess was silent. The section is known at import time — it
 * is a dropdown on the form — so it is passed in, not inferred.
 */

export interface ParsedItem {
  sourceNumber?: number;
  stem: string;
  options: Partial<Record<OptionLetter, string>>;
  correctOption?: OptionLetter;
  /** Index into ParseOutput.passages. Reading only. */
  passageRef?: number;
  skillId?: string;
  sourceLine: number;
  sourcePage?: number;
  warnings: string[];
}

export interface ParsedPassage {
  title?: string;
  body: string;
  /** Canonical hash — repeated copies of one passage collapse onto this. */
  contentHash: string;
  /** How many times this passage appeared in the source. */
  occurrences: number;
}

export interface ParseOutput {
  items: ParsedItem[];
  passages: ParsedPassage[];
  /** Never dropped — retained for manual review. */
  failed: FailedBlock[];
  notes: string[];
}

export interface ParseContext {
  /** Text with answer keys already removed. */
  text: string;
  section: SectionId;
}

export interface SectionParser {
  readonly section: SectionId;
  readonly label: string;
  parse(ctx: ParseContext): ParseOutput;
}
