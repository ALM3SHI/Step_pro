'use server';

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { requireAdmin } from '@/lib/auth/admin';
import { textAdapter, textFileAdapter } from '@/lib/ingestion/v2/source/textAdapter';
import { ingest, type IngestionPlan, type IngestionReport } from '@/lib/ingestion/v2/engine';
// The OLD engine, imported solely so the two can be measured side by side.
import { runPipeline } from '@/lib/ingestion/pipeline';
import type { FailedBlock, OptionLetter } from '@/lib/ingestion/v2/blocks';
import type { SectionId } from '@/lib/content/taxonomy';

/**
 * Parser preview — READ ONLY.
 *
 * Exists so the new engine can be judged by looking at what it produced,
 * not by trusting its counters. "131 questions, 0 orphans" is a claim;
 * seeing a passage with its six questions underneath it is evidence.
 *
 * This module deliberately imports nothing that can write. Reviewing a
 * parse must never be able to change the bank, so there is no code path
 * from here to the repository at all.
 */

/** Corpora shipped in the repo, offered so a review needs no paste. */
const SAMPLE_FILES: Record<string, { file: string; label: string; section: SectionId }> = {
  reading: { file: 'reading_bank.txt', label: 'بنك القراءة (245KB)', section: 'reading' },
  grammar: { file: 'gramer_bank.txt', label: 'بنك القواعد (31KB)', section: 'grammar' },
};

export interface DebugQuestion {
  index: number;
  sourceNumber?: number;
  text: string;
  options: Partial<Record<OptionLetter, string>>;
  correctOption?: OptionLetter;
  skillId: string | null;
  skillIsTemporary: boolean;
  sourceLine: number;
  sourcePage?: number;
  /** How the link was made, and the structural facts behind it. */
  linkMechanism?: string;
  linkEvidence?: string[];
  /** Post-hoc audit of the link — not what produced it. */
  confidenceScore?: number;
  confidenceBand?: 'high' | 'medium' | 'low';
  confidenceSignals?: Array<{ label: string; passed: boolean; weight: number }>;
  warnings: string[];
}

export interface DebugUnlinked extends DebugQuestion {
  reason: string;
}

export interface DebugEmptyPassage {
  index: number;
  title?: string;
  body: string;
  sourceLine: number;
  sourcePage?: number;
  probableCause: string;
}

export interface DebugPassage {
  index: number;
  title?: string;
  body: string;
  /** How many times the source reprinted this passage. */
  occurrences: number;
  sourceLine: number;
  sourcePage?: number;
  hadExplicitHeader: boolean;
  questions: DebugQuestion[];
}

/** Side-by-side totals for the two engines on identical input. */
export interface ParserComparison {
  old: {
    questions: number;
    passages: number;
    rejected: number;
    /** v1 had no separate answer-key stage. */
    answerKeys: number;
    questionsWithPassage: number;
    strategy: string;
    strategyConfidence: number;
  };
  neu: {
    questions: number;
    passages: number;
    failed: number;
    answerKeys: number;
    questionsWithPassage: number;
    unlinked: number;
    parser: string;
  };
  notes: string[];
}

export interface DebugResult {
  ok: boolean;
  error?: string;
  report?: IngestionReport;
  passages?: DebugPassage[];
  /** Refused links — never attached to a nearest guess. */
  unlinked?: DebugUnlinked[];
  /** Passages nothing pointed at, with a probable cause. */
  emptyPassages?: DebugEmptyPassage[];
  failed?: FailedBlock[];
  /** Present when the section has no passages (grammar/listening/writing). */
  flatQuestions?: DebugQuestion[];
  truncated?: { shown: number; total: number };
  comparison?: ParserComparison;
}

const TEMPORARY_MARKER = 'مهارة مؤقتة';

export async function debugParseAction(input: {
  /** Raw text, or a key from SAMPLE_FILES. */
  source: { kind: 'paste'; text: string } | { kind: 'sample'; key: string };
  section: SectionId;
  /** How many passages to render. The point is manual review, not bulk. */
  limit?: number;
  /** Also run the OLD engine on the same input and report both. */
  compare?: boolean;
}): Promise<DebugResult> {
  try {
    await requireAdmin();

    let text: string;
    let name: string;

    if (input.source.kind === 'sample') {
      const sample = SAMPLE_FILES[input.source.key];
      if (!sample) return { ok: false, error: 'ملف غير معروف' };
      // Repo-relative and from a fixed allow-list — never a client path.
      text = await readFile(path.join(process.cwd(), sample.file), 'utf8');
      name = sample.file;
    } else {
      text = input.source.text;
      name = 'نص ملصوق';
      if (!text.trim()) return { ok: false, error: 'الصق نصًا أولًا' };
    }

    const doc = input.source.kind === 'sample'
      ? await textFileAdapter.load(text, name)
      : await textAdapter.load(text, name);

    const plan = ingest(doc, { section: input.section, assignTemporarySkill: true });

    const toDebug = (
      q: (typeof plan.questions)[number] | (typeof plan.unlinked)[number],
      i: number,
    ): DebugQuestion => ({
      index: i,
      sourceNumber: q.sourceNumber,
      text: q.text,
      options: q.options,
      correctOption: q.correctOption,
      skillId: q.skillId,
      skillIsTemporary: q.warnings.some((w) => w.includes(TEMPORARY_MARKER)),
      sourceLine: q.sourceLine,
      sourcePage: q.sourcePage,
      linkMechanism: q.linkage?.mechanism,
      linkEvidence: q.linkage?.evidence,
      confidenceScore: q.confidence?.score,
      confidenceBand: q.confidence?.band,
      confidenceSignals: q.confidence?.signals,
      warnings: q.warnings,
    });

    const all = plan.questions.map(toDebug);

    // Group questions under their passage — the linkage IS the thing
    // being reviewed, so it has to be the shape of the data returned.
    const passages: DebugPassage[] = plan.passages.map((p, i) => ({
      index: i,
      title: p.title,
      body: p.body,
      occurrences: p.occurrences,
      sourceLine: p.sourceLine,
      sourcePage: p.sourcePage,
      hadExplicitHeader: p.hadExplicitHeader,
      questions: all.filter((_, qi) => plan.questions[qi].passageRef === i),
    }));

    const limit = Math.max(1, Math.min(input.limit ?? 20, 200));
    const shown = passages.slice(0, limit);

    const comparison = input.compare
      ? compareEngines(text, plan)
      : undefined;

    return {
      ok: true,
      report: plan.report,
      passages: shown,
      unlinked: plan.unlinked.map(toDebug).map((q, i) => ({
        ...q,
        reason: plan.unlinked[i].reason,
      })),
      emptyPassages: plan.emptyPassages,
      // Sections without passages render as a flat list instead.
      flatQuestions: passages.length ? undefined : all.slice(0, limit * 5),
      failed: plan.failed.slice(0, 100),
      truncated: passages.length > shown.length
        ? { shown: shown.length, total: passages.length }
        : undefined,
      comparison,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Run BOTH engines on identical input.
 *
 * The old engine is imported here and nowhere else in this file; it is
 * run purely to be measured. The number that matters is
 * `questionsWithPassage` — v1 parsed passages but the admin UI dropped
 * the link, so its reading output reached the database with none.
 */
function compareEngines(text: string, plan: IngestionPlan): ParserComparison {
  const old = runPipeline(text);

  const oldWithPassage = old.questions.filter((q) => q.passageRef !== undefined).length;
  const newWithPassage = plan.questions.filter((q) => q.passageRef !== undefined).length;

  const notes: string[] = [];

  if (old.questions.length === 0 && old.rejected.length === 0) {
    notes.push(
      'المحرك القديم أعاد صفر أسئلة وصفر مرفوضات على هذا النص — ' +
      'أي أنه لم يفهم شيئًا وأبلغ أن كل شيء سليم.',
    );
  }
  notes.push(
    `المحرك القديم اختار استراتيجية «${old.stats.strategy}» بثقة ` +
    `${(old.stats.strategyConfidence * 100).toFixed(0)}% بناءً على كثافة الأنماط. ` +
    'المحرك الجديد لا يخمّن — القسم يُحدَّد يدويًا.',
  );
  if (oldWithPassage !== newWithPassage) {
    notes.push(
      `أسئلة مرتبطة بقطعة: القديم ${oldWithPassage}، الجديد ${newWithPassage}.`,
    );
  }
  notes.push(
    'المحرك القديم لا يملك مرحلة استخراج مفاتيح إجابة إطلاقًا، ' +
    `بينما استخرج الجديد ${plan.report.answerKeysFound} مفتاحًا.`,
  );

  return {
    old: {
      questions: old.questions.length,
      passages: old.passages.length,
      rejected: old.rejected.length,
      answerKeys: 0,
      questionsWithPassage: oldWithPassage,
      strategy: old.stats.strategy,
      strategyConfidence: old.stats.strategyConfidence,
    },
    neu: {
      questions: plan.questions.length,
      passages: plan.passages.length,
      failed: plan.failed.length,
      answerKeys: plan.report.answerKeysFound,
      questionsWithPassage: newWithPassage,
      unlinked: plan.unlinked.length,
      parser: plan.report.parser,
    },
    notes,
  };
}

/** The sample corpora available for review. */
export async function listSamplesAction(): Promise<
  Array<{ key: string; label: string; section: SectionId }>
> {
  await requireAdmin();
  return Object.entries(SAMPLE_FILES).map(([key, v]) => ({
    key, label: v.label, section: v.section,
  }));
}
