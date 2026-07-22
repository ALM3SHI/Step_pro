import { splitBlocks, type FailedBlock } from '../blocks';
import { hashText } from '../../dedupe';
import type {
  ParseContext, ParseOutput, ParsedItem, ParsedPassage, SectionParser, UnlinkedItem,
} from './types';

/**
 * Reading — a passage with its questions, not a list of questions.
 *
 * The structure this parser exists to preserve:
 *
 *   Passage
 *     -> question, question, question ...
 *
 * Two properties matter and neither is optional:
 *
 *  1. EVERY reading question ends up attached to a passage. A reading
 *     item with nothing to read is not a hard question, it is a broken
 *     import — and five of them reached the live exam last time.
 *
 *  2. A passage repeated in the source collapses to ONE passage. Real
 *     STEP dumps reprint the whole passage above every question, so a
 *     naive parser creates forty copies of one text and scatters its
 *     questions across them.
 */

/** `Passage 1 : Title` / `القطعة 2 - العنوان` — an explicit passage header. */
const PASSAGE_HEADER =
  /^\s*(?:passage|reading|text|القطعة|النص)\s*(\d{1,3})?\s*[:：\-–]?\s*(.{0,120})$/i;

/** `1) <long prose>` — a numbered passage paragraph, not a question. */
const PARAGRAPH = /^\s*\(?(\d{1,2})\)\s+(.{80,})$/;

/** `N / M` — quiz-export item boundary; also ends a passage. */
const QUIZ_MARKER = /^\s*\d{1,4}\s*\/\s*\d{1,4}\s*$/;

/** Noise lines a quiz export leaves between items. */
const EXPORT_NOISE = /^\s*(?:you have not answered this question|لم تجب عن هذا السؤال)\s*$/i;

/** Prose long enough to be passage body rather than a question stem. */
const PROSE_MIN_CHARS = 120;

interface Region {
  passageLines: string[];
  passageTitle?: string;
  questionLines: string[];
  startLine: number;
  /** Line the question run began on, for reporting. */
  questionsStartLine: number;
  /** True when the source printed "Passage N : Title" above it. */
  hadExplicitHeader: boolean;
}

/**
 * Cut the document into regions of "passage, then its questions".
 *
 * A region ends when the next passage begins. Because the same passage
 * is usually reprinted before each question, regions are collapsed by
 * content hash afterwards rather than trusted to be distinct.
 */
function splitIntoRegions(lines: string[]): Region[] {
  const regions: Region[] = [];
  let current: Region | null = null;
  let inPassage = false;

  // Returns the region; the caller assigns it to `current`. Assigning
  // inside the helper would hide the write from control-flow analysis
  // and narrow `current` to `never` at every later use.
  const newRegion = (
    title: string | undefined, line: number, hadExplicitHeader: boolean,
  ): Region => {
    const region: Region = {
      passageLines: [], passageTitle: title, questionLines: [],
      startLine: line, questionsStartLine: line, hadExplicitHeader,
    };
    regions.push(region);
    return region;
  };

  // Record where the question run starts, so a question can be traced
  // back to its line in the source rather than to the passage header.
  const noteQuestionLine = (region: Region, line: number) => {
    if (!region.questionLines.length) region.questionsStartLine = line;
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const t = raw.trim();
    if (!t || EXPORT_NOISE.test(t)) continue;

    const header = t.match(PASSAGE_HEADER);
    // A header only counts when a title or a paragraph follows it —
    // "Reading" alone appears in ordinary prose.
    if (header && (header[2]?.trim() || PARAGRAPH.test(lines[i + 1]?.trim() ?? ''))) {
      current = newRegion(header[2]?.trim() || undefined, i + 1, true);
      inPassage = true;
      continue;
    }

    if (PARAGRAPH.test(t)) {
      // A numbered paragraph with no header still opens a passage.
      if (!current || !inPassage) current = newRegion(undefined, i + 1, false);
      current.passageLines.push(t);
      inPassage = true;
      continue;
    }

    if (!current) {
      // Prose before any marker: treat long text as an untitled passage,
      // anything shorter as the start of the question run.
      current = newRegion(undefined, i + 1, false);
      if (t.length >= PROSE_MIN_CHARS) {
        inPassage = true;
        current.passageLines.push(t);
      } else {
        inPassage = false;
        noteQuestionLine(current, i + 1);
        current.questionLines.push(t);
      }
      continue;
    }

    if (QUIZ_MARKER.test(t)) { inPassage = false; continue; }

    // Long prose while still inside the passage extends it; anything
    // else switches us into the question run.
    if (inPassage && t.length >= PROSE_MIN_CHARS) { current.passageLines.push(t); continue; }

    inPassage = false;
    noteQuestionLine(current, i + 1);
    current.questionLines.push(t);
  }

  return regions;
}

export const readingParser: SectionParser = {
  section: 'reading',
  label: 'Reading Comprehension',

  parse({ text }: ParseContext): ParseOutput {
    const lines = text.split('\n');
    const regions = splitIntoRegions(lines);

    const passages: ParsedPassage[] = [];
    const indexByHash = new Map<string, number>();
    const items: ParsedItem[] = [];
    const unlinked: UnlinkedItem[] = [];
    const failed: FailedBlock[] = [];
    const notes: string[] = [];

    for (const region of regions) {
      const body = region.passageLines.join('\n').trim();
      const questionText = region.questionLines.join('\n').trim();

      if (!questionText) continue;

      let passageRef: number | undefined;
      let reprint = false;

      if (body) {
        // Collapse reprints: the hash is over canonical text, so the
        // same passage printed forty times yields one row.
        const h = hashText(body);
        const existing = indexByHash.get(h);
        if (existing !== undefined) {
          passageRef = existing;
          passages[existing].occurrences++;
          reprint = true;
        } else {
          passageRef = passages.length;
          passages.push({
            title: region.passageTitle,
            body,
            contentHash: h,
            occurrences: 1,
            hadExplicitHeader: region.hadExplicitHeader,
            sourceLine: region.startLine,
          });
          indexByHash.set(h, passageRef);
        }
      }

      const split = splitBlocks(questionText, { optionsPerQuestion: 4, minOptions: 2 });
      // Block line numbers are relative to the question run.
      const toSourceLine = (n: number) => n + region.questionsStartLine - 1;

      for (const block of split.blocks) {
        const base = {
          sourceNumber: block.sourceNumber,
          stem: block.stem,
          options: block.options,
          sourceLine: toSourceLine(block.sourceLine),
          warnings: block.warnings,
        };

        /**
         * No passage region was open.
         *
         * The question is NOT attached to the nearest passage. Once
         * saved, a wrong link is indistinguishable from a right one, and
         * a reading question under the wrong text is unanswerable in a
         * way nobody notices until a candidate sits it.
         */
        if (passageRef === undefined) {
          unlinked.push({
            ...base,
            linkage: {
              mechanism: 'unlinked',
              evidence: ['لا توجد منطقة قطعة مفتوحة قبل هذا السؤال'],
            },
            reason: 'لم يسبقه أي نص قطعة في المصدر',
          });
          continue;
        }

        const evidence = [
          `ورد داخل منطقة القطعة رقم ${passageRef + 1} (السطر ${region.startLine} فصاعدًا)`,
        ];
        if (region.hadExplicitHeader) {
          evidence.push('القطعة معلَّمة بترويسة صريحة في المصدر');
        } else {
          evidence.push('القطعة استُنتجت من فقرات مرقّمة، بلا ترويسة صريحة');
        }
        if (reprint) evidence.push('نسخة مكررة من القطعة — طُويت على النسخة الأولى');

        items.push({
          ...base,
          passageRef,
          linkage: { mechanism: 'region-position', evidence },
        });
      }

      for (const f of split.failed) {
        failed.push({ ...f, sourceLine: toSourceLine(f.sourceLine) });
      }
    }

    const reprinted = passages.filter((p) => p.occurrences > 1).length;
    if (reprinted) {
      notes.push(
        `${reprinted} قطعة كانت مكررة في المصدر وطُويت إلى نسخة واحدة ` +
        '(المصدر يعيد طباعة القطعة قبل كل سؤال).',
      );
    }
    if (unlinked.length) {
      notes.push(
        `${unlinked.length} سؤال قراءة بلا قطعة — لم يُربط بأقرب قطعة، ` +
        'بل عُزل في قسم «أسئلة بلا ربط» للمراجعة.',
      );
    }

    return { items, passages, unlinked, failed, notes };
  },
};
