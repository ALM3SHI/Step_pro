'use server';

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { requireAdmin } from '@/lib/auth/admin';
import { textAdapter, textFileAdapter } from '@/lib/ingestion/v2/source/textAdapter';
import { ingest, type IngestionReport } from '@/lib/ingestion/v2/engine';
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
  warnings: string[];
}

export interface DebugPassage {
  index: number;
  title?: string;
  body: string;
  /** How many times the source reprinted this passage. */
  occurrences: number;
  questions: DebugQuestion[];
}

export interface DebugResult {
  ok: boolean;
  error?: string;
  report?: IngestionReport;
  passages?: DebugPassage[];
  /** Questions the parser produced with no passage. Should be empty. */
  orphans?: DebugQuestion[];
  failed?: FailedBlock[];
  /** Present when the section has no passages (grammar/listening/writing). */
  flatQuestions?: DebugQuestion[];
  truncated?: { shown: number; total: number };
}

const TEMPORARY_MARKER = 'مهارة مؤقتة';

export async function debugParseAction(input: {
  /** Raw text, or a key from SAMPLE_FILES. */
  source: { kind: 'paste'; text: string } | { kind: 'sample'; key: string };
  section: SectionId;
  /** How many passages to render. The point is manual review, not bulk. */
  limit?: number;
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

    const toDebug = (q: (typeof plan.questions)[number], i: number): DebugQuestion => ({
      index: i,
      sourceNumber: q.sourceNumber,
      text: q.text,
      options: q.options,
      correctOption: q.correctOption,
      skillId: q.skillId,
      skillIsTemporary: q.warnings.some((w) => w.includes(TEMPORARY_MARKER)),
      sourceLine: q.sourceLine,
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
      questions: all.filter((_, qi) => plan.questions[qi].passageRef === i),
    }));

    const orphans = all.filter((_, qi) => plan.questions[qi].passageRef === undefined);

    const limit = Math.max(1, Math.min(input.limit ?? 20, 200));
    const shown = passages.slice(0, limit);

    return {
      ok: true,
      report: plan.report,
      passages: shown,
      orphans: passages.length ? orphans : undefined,
      // Sections without passages render as a flat list instead.
      flatQuestions: passages.length ? undefined : all.slice(0, limit * 5),
      failed: plan.failed.slice(0, 100),
      truncated: passages.length > shown.length
        ? { shown: shown.length, total: passages.length }
        : undefined,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
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
