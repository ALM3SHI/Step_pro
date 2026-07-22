import { extractAnswerKeys, bindAnswerKeys } from './answerKey';
import { parserFor } from './parsers';
import { artifactCounts, fullText, type SourceDocument } from './source/types';
import { hashQuestion } from '../dedupe';
import { SKILLS_BY_SECTION, type SectionId } from '../../content/taxonomy';
import type { FailedBlock, OptionLetter } from './blocks';
import type { ParsedItem, ParsedPassage } from './parsers/types';

/**
 * The ingestion engine.
 *
 * Stage order, and why each is where it is:
 *
 *   1. answer keys  — lifted BEFORE parsing, so a key block under the
 *                     last question cannot be read as option text.
 *   2. parse        — the parser for the CHOSEN section, not a guess.
 *   3. keys bound   — by printed number, after the items exist.
 *   4. hash         — for linking, never for deletion.
 *
 * Nothing here writes to the database. It returns a plan plus a report,
 * and the caller decides what to persist — which is what makes the whole
 * thing testable without Supabase.
 */

export interface PreparedQuestion {
  sourceNumber?: number;
  text: string;
  options: Partial<Record<OptionLetter, string>>;
  correctOption?: OptionLetter;
  skillId: string | null;
  /** Index into `passages`. */
  passageRef?: number;
  contentHash: string;
  sourceLine: number;
  sourcePage?: number;
  warnings: string[];
}

export interface IngestionReport {
  source: { name: string; kind: string };
  pagesScanned: number;
  section: SectionId;
  parser: string;

  passagesFound: number;
  passageReprintsCollapsed: number;
  questionsFound: number;
  answerKeysFound: number;
  answerKeysBound: number;
  questionsWithoutKey: number;

  /** Visual content the text layer could not carry. */
  imagesSkipped: number;
  chartsSkipped: number;
  tablesSkipped: number;

  /** Same question seen twice inside this one import. */
  duplicatesInPayload: number;

  failedBlocks: number;
  warnings: string[];
  notes: string[];

  answerKeyConflicts: Array<{ number: number; options: OptionLetter[] }>;
  invalidAnswerKeys: Array<{ number: number; option: OptionLetter }>;
  unmatchedAnswerKeys: number[];
}

export interface IngestionPlan {
  questions: PreparedQuestion[];
  passages: ParsedPassage[];
  /** Retained verbatim so nothing is lost to a parse failure. */
  failed: FailedBlock[];
  report: IngestionReport;
}

/**
 * Reading items must never be skill-less.
 *
 * A question with no skill vanishes from every weakness analysis, which
 * is the one thing this platform is for. Detection from the stem is
 * crude on purpose — when it cannot tell, it assigns the section's first
 * skill and flags it, so the item is reviewable rather than invisible.
 */
const SKILL_HINTS: Array<{ skill: string; test: RegExp }> = [
  // Ordered most-specific first. `main` sits below the others because
  // "the passage" and "mainly" appear inside detail questions too, and a
  // loose main-idea rule swallowed a third of the bank on first run.
  { skill: 'ref', test: /\b(refers? to|referring to|the word\s+["“][^"”]+["”]\s+in line|pronoun)\b/i },
  { skill: 'vocab', test: /\b(closest in meaning|means?\s+the\s+same|the word\s+["“]?\w+["”]?\s+means|synonym)\b/i },
  { skill: 'infer', test: /\b(infer(?:red|ence)?|impl(?:y|ies|ied)|suggests?\s+that|we can conclude|most likely|probably)\b/i },
  { skill: 'main', test: /\b(main idea|best title|primary purpose|mainly (?:about|discuss)|passage is mainly)\b/i },
  { skill: 'detail', test: /\b(according to (?:the )?(?:passage|author|text)|how (?:much|many|long|often)|which of the following is (?:true|mentioned|not)|the author states|when did|where did|who\s)\b/i },
];

export const TEMPORARY_SKILL_WARNING = 'مهارة مؤقتة — لم تُكتشف تلقائيًا، تحتاج مراجعة';

/**
 * The bucket an undetected item lands in, per section.
 *
 * Chosen as each section's most common, most neutral skill rather than
 * whichever happens to be listed first: a fallback that pretends to be
 * "Main Idea" corrupts the weakness analysis it was meant to protect.
 * Every item assigned this way carries TEMPORARY_SKILL_WARNING and is
 * findable in the panel.
 */
const TEMPORARY_SKILL: Partial<Record<SectionId, string>> = {
  reading: 'detail',
  grammar: 'tenses',
  listening: 'ldetail',
  writing: 'error',
};

function inferSkill(section: SectionId, stem: string): { skillId: string; temporary: boolean } {
  const allowed = new Set((SKILLS_BY_SECTION[section] ?? []).map((s) => s.id));

  for (const { skill, test } of SKILL_HINTS) {
    if (allowed.has(skill) && test.test(stem)) return { skillId: skill, temporary: false };
  }

  // A temporary skill, never null. "No skill" drops the item out of every
  // weakness analysis silently; this keeps it countable and reviewable.
  const fallback = TEMPORARY_SKILL[section] ?? (SKILLS_BY_SECTION[section] ?? [])[0]?.id;
  return { skillId: fallback ?? '', temporary: true };
}

export interface IngestOptions {
  section: SectionId;
  /** Assign a temporary skill when detection fails. Reading needs this. */
  assignTemporarySkill?: boolean;
}

export function ingest(doc: SourceDocument, opts: IngestOptions): IngestionPlan {
  const raw = fullText(doc);

  // --- 1. answer keys, before anything reads the text as content ------
  const keys = extractAnswerKeys(raw);

  // --- 2. the parser for the section the maintainer chose -------------
  const parser = parserFor(opts.section);
  const parsed = parser.parse({ text: keys.text, section: opts.section });

  // --- 3. bind keys to items -----------------------------------------
  const bound = bindAnswerKeys(
    parsed.items.map((i) => ({ sourceNumber: i.sourceNumber, options: i.options })),
    keys.entries,
  );

  // --- 4. prepare, hashing for LINKAGE rather than deletion -----------
  const seen = new Map<string, number>();
  let duplicatesInPayload = 0;
  const questions: PreparedQuestion[] = [];

  parsed.items.forEach((item: ParsedItem, idx) => {
    const contentHash = hashQuestion(item.stem, item.options);
    if (seen.has(contentHash)) duplicatesInPayload++;
    else seen.set(contentHash, idx);

    const warnings = [...item.warnings];
    let skillId: string | null = item.skillId ?? null;

    if (!skillId && opts.assignTemporarySkill) {
      const inferred = inferSkill(opts.section, item.stem);
      skillId = inferred.skillId || null;
      if (inferred.temporary) warnings.push(TEMPORARY_SKILL_WARNING);
    }

    questions.push({
      sourceNumber: item.sourceNumber,
      text: item.stem,
      options: item.options,
      correctOption: bound.applied.get(idx),
      skillId,
      passageRef: item.passageRef,
      contentHash,
      sourceLine: item.sourceLine,
      sourcePage: item.sourcePage,
      warnings,
    });
  });

  const artifacts = artifactCounts(doc);

  const report: IngestionReport = {
    source: { name: doc.name, kind: doc.kind },
    pagesScanned: doc.pages.length,
    section: opts.section,
    parser: parser.label,

    passagesFound: parsed.passages.length,
    passageReprintsCollapsed: parsed.passages.reduce((n, p) => n + Math.max(0, p.occurrences - 1), 0),
    questionsFound: questions.length,
    answerKeysFound: keys.entries.length,
    answerKeysBound: bound.applied.size,
    questionsWithoutKey: bound.unkeyedItems.length,

    imagesSkipped: artifacts.image ?? 0,
    chartsSkipped: artifacts.chart ?? 0,
    tablesSkipped: artifacts.table ?? 0,

    duplicatesInPayload,

    failedBlocks: parsed.failed.length,
    warnings: doc.warnings,
    notes: [
      ...parsed.notes,
      keys.detectedFormat
        ? `مفاتيح الإجابة: ${keys.entries.length} مفتاحًا (${keys.detectedFormat}), أُزيل ${keys.removedLineCount} سطرًا من النص قبل التحليل.`
        : 'لم يُعثر على قسم مفاتيح إجابة في المصدر.',
    ],

    answerKeyConflicts: keys.conflicts,
    invalidAnswerKeys: bound.invalidOption,
    unmatchedAnswerKeys: bound.unmatchedKeys.map((k) => k.number),
  };

  return { questions, passages: parsed.passages, failed: parsed.failed, report };
}

/** Human-readable report, for the admin panel and for tests. */
export function formatReport(r: IngestionReport): string {
  const lines = [
    `source              : ${r.source.name} (${r.source.kind})`,
    `pages scanned       : ${r.pagesScanned}`,
    `parser              : ${r.parser}`,
    '',
    `passages found      : ${r.passagesFound}`,
    `passage reprints    : ${r.passageReprintsCollapsed} collapsed`,
    `questions found     : ${r.questionsFound}`,
    `answer keys found   : ${r.answerKeysFound}`,
    `answer keys bound   : ${r.answerKeysBound}`,
    `questions w/o key   : ${r.questionsWithoutKey}`,
    '',
    `images skipped      : ${r.imagesSkipped}`,
    `charts skipped      : ${r.chartsSkipped}`,
    `tables skipped      : ${r.tablesSkipped}`,
    '',
    `duplicates in file  : ${r.duplicatesInPayload}`,
    `failed blocks       : ${r.failedBlocks}`,
  ];
  if (r.answerKeyConflicts.length) {
    lines.push('', `key conflicts       : ${r.answerKeyConflicts.map((c) => `${c.number}=${c.options.join('/')}`).join(', ')}`);
  }
  if (r.invalidAnswerKeys.length) {
    lines.push(`invalid keys        : ${r.invalidAnswerKeys.map((c) => `${c.number}->${c.option}`).join(', ')}`);
  }
  for (const n of r.notes) lines.push(`note: ${n}`);
  for (const w of r.warnings) lines.push(`warn: ${w}`);
  return lines.join('\n');
}
