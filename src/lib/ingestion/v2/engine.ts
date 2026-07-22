import { extractAnswerKeys, bindAnswerKeys } from './answerKey';
import { parserFor } from './parsers';
import { artifactCounts, buildLinePageMap, fullText, type SourceDocument } from './source/types';
import type { Linkage } from './parsers/types';
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

/**
 * A post-hoc measure of how well a link holds up — NOT how it was made.
 *
 * The linkage itself is purely structural: a question inherits the
 * passage whose region it sat in. This score is computed afterwards by
 * asking independent questions of the result (does the wording overlap
 * the passage? was the passage explicitly labelled?) so that a
 * structurally-plausible but semantically-wrong grouping can still be
 * spotted during review.
 *
 * It must never be read as "the parser was N% sure". The parser was not
 * sure of anything; it followed the document's structure.
 */
export interface LinkConfidence {
  /** 0-1. */
  score: number;
  band: 'high' | 'medium' | 'low';
  /** Each signal and what it contributed, so the number is auditable. */
  signals: Array<{ label: string; passed: boolean; weight: number }>;
}

export interface PreparedQuestion {
  sourceNumber?: number;
  text: string;
  options: Partial<Record<OptionLetter, string>>;
  correctOption?: OptionLetter;
  skillId: string | null;
  /** Index into `passages`. */
  passageRef?: number;
  linkage?: Linkage;
  confidence?: LinkConfidence;
  contentHash: string;
  sourceLine: number;
  sourcePage?: number;
  warnings: string[];
}

export interface UnlinkedQuestion extends PreparedQuestion {
  reason: string;
}

/** A passage the parser produced that no question pointed at. */
export interface EmptyPassage {
  index: number;
  title?: string;
  body: string;
  sourceLine: number;
  sourcePage?: number;
  /** Best available explanation, for review. */
  probableCause: string;
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

  unlinkedQuestions: number;
  emptyPassages: number;
  temporarySkills: number;
  duplicatePassagesMerged: number;
  /** Link confidence spread, for the review page. */
  confidence: { high: number; medium: number; low: number };

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
  /** Refused links, kept separate — never attached to a nearest guess. */
  unlinked: UnlinkedQuestion[];
  /** Passages no question pointed at, with a probable cause. */
  emptyPassages: EmptyPassage[];
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

/**
 * Words too common to prove anything about a link.
 *
 * Without this, "the passage suggests that..." overlaps every passage
 * ever written and the score becomes noise.
 */
const OVERLAP_STOPWORDS = new Set([
  'which', 'following', 'passage', 'according', 'author', 'about', 'their',
  'there', 'these', 'those', 'would', 'could', 'should', 'because', 'before',
  'after', 'other', 'where', 'while', 'question', 'answer', 'below', 'above',
  'best', 'title', 'means', 'refers', 'word', 'line', 'paragraph', 'writer',
]);

function contentWords(s: string): string[] {
  return (s.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((w) => !OVERLAP_STOPWORDS.has(w));
}

/**
 * Score a completed link.
 *
 * Weights are deliberately modest and additive rather than tuned: this
 * is a review aid, and an over-confident number would discourage exactly
 * the manual checking it exists to support.
 */
function scoreLink(stem: string, optionText: string, passageBody: string, linkage: Linkage | undefined, passageHadHeader: boolean): LinkConfidence {
  const body = passageBody.toLowerCase();
  const stemWords = contentWords(stem);
  const optWords = contentWords(optionText);

  const stemHit = stemWords.filter((w) => body.includes(w)).length;
  const optHit = optWords.filter((w) => body.includes(w)).length;

  const stemOverlap = stemWords.length ? stemHit / stemWords.length : 0;
  const optOverlap = optWords.length ? optHit / optWords.length : 0;

  const signals = [
    {
      label: 'ورد داخل منطقة القطعة (الآلية المستخدمة فعليًا)',
      passed: linkage?.mechanism === 'region-position',
      weight: 0.4,
    },
    {
      label: 'القطعة تحمل ترويسة صريحة في المصدر',
      passed: passageHadHeader,
      weight: 0.15,
    },
    {
      label: `مفردات السؤال تظهر في القطعة (${Math.round(stemOverlap * 100)}%)`,
      passed: stemOverlap >= 0.25,
      weight: 0.25,
    },
    {
      label: `مفردات الخيارات تظهر في القطعة (${Math.round(optOverlap * 100)}%)`,
      passed: optOverlap >= 0.2,
      weight: 0.2,
    },
  ];

  const score = signals.reduce((n, s) => n + (s.passed ? s.weight : 0), 0);

  return {
    score,
    band: score >= 0.75 ? 'high' : score >= 0.5 ? 'medium' : 'low',
    signals,
  };
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

  /**
   * Parser line -> source page.
   *
   * Two hops, because key removal renumbers the text the parser sees:
   * parser line -> original line (keys.lineMap) -> page (linePageMap).
   * Skipping the first hop puts every question after a key block on the
   * wrong page.
   */
  const linePageMap = buildLinePageMap(doc);
  const pageOf = (parserLine: number): number | undefined => {
    const originalLine = keys.lineMap[parserLine - 1];
    if (originalLine === undefined) return undefined;
    return linePageMap[originalLine];
  };

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

    const passage = item.passageRef !== undefined ? parsed.passages[item.passageRef] : undefined;

    questions.push({
      sourceNumber: item.sourceNumber,
      text: item.stem,
      options: item.options,
      correctOption: bound.applied.get(idx),
      skillId,
      passageRef: item.passageRef,
      linkage: item.linkage,
      confidence: passage
        ? scoreLink(
            item.stem,
            Object.values(item.options).filter(Boolean).join(' '),
            passage.body,
            item.linkage,
            passage.hadExplicitHeader,
          )
        : undefined,
      contentHash,
      sourceLine: item.sourceLine,
      sourcePage: pageOf(item.sourceLine),
      warnings,
    });
  });

  // --- 5. questions the parser refused to link ------------------------
  const unlinked: UnlinkedQuestion[] = parsed.unlinked.map((u) => ({
    sourceNumber: u.sourceNumber,
    text: u.stem,
    options: u.options,
    correctOption: undefined,
    skillId: null,
    linkage: u.linkage,
    contentHash: hashQuestion(u.stem, u.options),
    sourceLine: u.sourceLine,
    sourcePage: pageOf(u.sourceLine),
    warnings: u.warnings,
    reason: u.reason,
  }));

  // --- 6. passages nothing pointed at ---------------------------------
  const referenced = new Set(questions.map((q) => q.passageRef).filter((r) => r !== undefined));
  const emptyPassages: EmptyPassage[] = parsed.passages
    .map((p, index) => ({ p, index }))
    .filter(({ index }) => !referenced.has(index))
    .map(({ p, index }) => ({
      index,
      title: p.title,
      body: p.body,
      sourceLine: p.sourceLine,
      sourcePage: pageOf(p.sourceLine),
      probableCause: !p.hadExplicitHeader
        ? 'استُنتجت من فقرات مرقّمة بلا ترويسة — قد تكون تكملة للقطعة السابقة لا قطعة مستقلة'
        : parsed.failed.some((f) => Math.abs(f.sourceLine - p.sourceLine) < 40)
          ? 'أسئلتها على الأرجح ضمن الكتل التي فشل تحليلها قريبًا من هذا السطر'
          : 'وردت في المصدر بلا أسئلة بعدها، أو أن أسئلتها نُسبت للقطعة السابقة',
    }));

  // Passage pages, for display.
  const passagesWithPages = parsed.passages.map((p) => ({
    ...p,
    sourcePage: pageOf(p.sourceLine),
  }));

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

    unlinkedQuestions: unlinked.length,
    emptyPassages: emptyPassages.length,
    temporarySkills: questions.filter((q) => q.warnings.includes(TEMPORARY_SKILL_WARNING)).length,
    // Reprints beyond the first are merges: 6 occurrences = 5 merged.
    duplicatePassagesMerged: parsed.passages.reduce((n, p) => n + Math.max(0, p.occurrences - 1), 0),
    confidence: {
      high: questions.filter((q) => q.confidence?.band === 'high').length,
      medium: questions.filter((q) => q.confidence?.band === 'medium').length,
      low: questions.filter((q) => q.confidence?.band === 'low').length,
    },

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

  return {
    questions,
    passages: passagesWithPages,
    unlinked,
    emptyPassages,
    failed: parsed.failed,
    report,
  };
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
