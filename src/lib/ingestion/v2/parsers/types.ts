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

/**
 * How a question came to be attached to its passage.
 *
 * Recorded honestly, because a review tool that shows an invented
 * mechanism is worse than one that shows none. Today there is exactly
 * one: the question sat inside that passage's region of the document.
 * Nothing here does keyword matching, and nothing attaches a question to
 * the nearest passage as a fallback.
 */
export type LinkMechanism =
  /** The question appeared in the text region opened by this passage. */
  | 'region-position'
  /** No passage region was open. The question is NOT linked. */
  | 'unlinked';

export interface Linkage {
  mechanism: LinkMechanism;
  /** Structural facts that produced the link, for display. */
  evidence: string[];
}

export interface ParsedItem {
  sourceNumber?: number;
  stem: string;
  options: Partial<Record<OptionLetter, string>>;
  correctOption?: OptionLetter;
  /** Index into ParseOutput.passages. Reading only. */
  passageRef?: number;
  linkage?: Linkage;
  skillId?: string;
  sourceLine: number;
  sourcePage?: number;
  warnings: string[];
}

/** A question the parser refused to attach to any passage. */
export interface UnlinkedItem extends ParsedItem {
  reason: string;
}

export interface ParsedPassage {
  title?: string;
  body: string;
  /** Canonical hash — repeated copies of one passage collapse onto this. */
  contentHash: string;
  /** How many times this passage appeared in the source. */
  occurrences: number;
  /** Whether the source labelled it, e.g. "Passage 3 : Title". */
  hadExplicitHeader: boolean;
  sourceLine: number;
  sourcePage?: number;
}

export interface ParseOutput {
  items: ParsedItem[];
  passages: ParsedPassage[];
  /**
   * Questions with no passage.
   *
   * Kept apart from `items` rather than attached to the nearest passage.
   * A wrong link is indistinguishable from a right one once saved, so
   * "no answer" is the only honest output when the structure did not
   * say.
   */
  unlinked: UnlinkedItem[];
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
