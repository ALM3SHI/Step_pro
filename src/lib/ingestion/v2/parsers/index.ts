import { splitBlocks } from '../blocks';
import { readingParser } from './reading';
import type { ParseContext, ParseOutput, SectionParser } from './types';
import type { SectionId } from '../../../content/taxonomy';

/**
 * Grammar, Listening and Writing share a shape: standalone items with no
 * stimulus in the text. They differ in what a plausible item looks like,
 * so each declares its own expectations rather than sharing one regex.
 *
 * Reading is genuinely different — passage-scoped — and lives in its own
 * file.
 */
function standaloneParser(
  section: SectionId,
  label: string,
  opts: { optionsPerQuestion: number; minOptions: number; note?: string },
): SectionParser {
  return {
    section,
    label,
    parse({ text }: ParseContext): ParseOutput {
      const split = splitBlocks(text, {
        optionsPerQuestion: opts.optionsPerQuestion,
        minOptions: opts.minOptions,
      });

      const notes: string[] = [];
      if (opts.note) notes.push(opts.note);

      // Say which signal carried the document. When a parse comes back
      // thin, this is the first thing worth knowing.
      const used = Object.entries(split.signals)
        .filter(([, n]) => n > 0)
        .map(([k, n]) => `${k}:${n}`);
      notes.push(used.length ? `إشارات البنية المكتشفة — ${used.join('، ')}` : 'لم تُكتشف أي إشارة بنية.');

      return {
        items: split.blocks.map((b) => ({
          sourceNumber: b.sourceNumber,
          stem: b.stem,
          options: b.options,
          sourceLine: b.sourceLine,
          warnings: b.warnings,
        })),
        passages: [],
        failed: split.failed,
        notes,
      };
    },
  };
}

export const grammarParser = standaloneParser('grammar', 'Structure / Grammar', {
  optionsPerQuestion: 4,
  minOptions: 2,
});

/**
 * Listening items are the same shape as grammar ones — the audio is
 * attached at save time, not found in the text. This is exactly what the
 * old engine got wrong: it had no listening path at all, so a listening
 * paste fell through to a strategy that needed numbering and produced
 * nothing while reporting no errors.
 */
export const listeningParser = standaloneParser('listening', 'Listening Comprehension', {
  optionsPerQuestion: 4,
  minOptions: 2,
  note: 'أسئلة الاستماع تُربط بالتسجيل عند الحفظ، لا من النص.',
});

/**
 * Writing Analysis items often carry only 3 options and their stems are
 * long (a full sentence with an underlined span), so the floor is lower.
 */
export const writingParser = standaloneParser('writing', 'Writing Analysis', {
  optionsPerQuestion: 4,
  minOptions: 2,
});

export { readingParser };

const REGISTRY: Record<SectionId, SectionParser> = {
  reading: readingParser,
  grammar: grammarParser,
  listening: listeningParser,
  writing: writingParser,
};

/** The parser for a section. Chosen explicitly — never guessed. */
export function parserFor(section: SectionId): SectionParser {
  return REGISTRY[section];
}

export type { ParseContext, ParseOutput, SectionParser };
