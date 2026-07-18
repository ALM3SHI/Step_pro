/**
 * Blueprint construction: pool of questions -> ordered parts.
 *
 * Ported from the legacy `startExam` part builder, with the grouping and
 * time-allocation rules preserved:
 *   - reading  groups by passage, one part per passage
 *   - listening groups by audio clip
 *   - writing  is a single part
 *   - grammar  is split into at most 3 parts
 *   - part duration is proportional to the section weight
 */

import { SECTION_RULES, type ExamPart, type ExamQuestion, type Screen, type SectionKey } from './types';

/** Section presentation order, as sat in the real exam. */
const SECTION_ORDER: SectionKey[] = ['reading', 'grammar', 'listening', 'writing'];

function groupScreens(section: SectionKey, ids: string[], byId: Record<string, ExamQuestion>): Screen[] {
  if (section === 'reading') {
    const byPassage = new Map<string, string[]>();
    for (const id of ids) {
      // Questions with no passage each get their own screen rather than
      // being lumped into a shared "undefined" bucket — that bug would
      // render dozens of unrelated questions on one page.
      const key = byId[id].passageId ?? `solo:${id}`;
      byPassage.set(key, [...(byPassage.get(key) ?? []), id]);
    }
    return [...byPassage.values()];
  }

  if (section === 'listening') {
    const byAudio = new Map<string, string[]>();
    for (const id of ids) {
      const key = byId[id].audioId ?? `solo:${id}`;
      byAudio.set(key, [...(byAudio.get(key) ?? []), id]);
    }
    return [...byAudio.values()];
  }

  return ids.map((id) => [id]);
}

function partCountFor(section: SectionKey, screenCount: number): number {
  if (section === 'reading') return screenCount;   // one part per passage
  if (section === 'writing') return 1;
  return Math.min(3, screenCount);
}

export interface BuildOptions {
  /** Total exam duration in minutes, split across parts by weight. */
  totalMinutes: number;
}

export function buildParts(questions: ExamQuestion[], opts: BuildOptions): {
  parts: ExamPart[];
  byId: Record<string, ExamQuestion>;
  numberInSection: Record<string, number>;
} {
  const byId: Record<string, ExamQuestion> = {};
  for (const q of questions) byId[q.id] = q;

  const parts: ExamPart[] = [];

  for (const section of SECTION_ORDER) {
    const ids = questions.filter((q) => q.section === section).map((q) => q.id);
    if (!ids.length) continue;

    const screens = groupScreens(section, ids, byId);
    const nParts = Math.max(1, partCountFor(section, screens.length));
    const per = Math.max(1, Math.ceil(screens.length / nParts));

    for (let s = 0, partNo = 1; s < screens.length; s += per, partNo++) {
      const chunkScreens = screens.slice(s, s + per);
      parts.push({
        index: parts.length,
        section,
        labelEn: SECTION_RULES[section].nameEn,
        partNo,
        screens: chunkScreens,
        questionIds: chunkScreens.flat(),
        durationSeconds: 0, // assigned below
      });
    }
  }

  // Time allocation: weight each part by (question count x section weight),
  // then distribute the total budget proportionally.
  const weightOf = (p: ExamPart) => p.questionIds.length * SECTION_RULES[p.section].weightPct;
  const totalWeight = parts.reduce((n, p) => n + weightOf(p), 0);
  const totalSeconds = opts.totalMinutes * 60;

  for (const p of parts) {
    p.durationSeconds = totalWeight > 0
      ? Math.max(60, Math.round(totalSeconds * (weightOf(p) / totalWeight)))
      : 60;
  }

  // Question numbering restarts per section, matching the legacy display
  // ("Question 7 of 40" counts within Reading, not across the whole exam).
  const numberInSection: Record<string, number> = {};
  const seen: Partial<Record<SectionKey, number>> = {};
  for (const p of parts) {
    for (const id of p.questionIds) {
      seen[p.section] = (seen[p.section] ?? 0) + 1;
      numberInSection[id] = seen[p.section]!;
    }
  }

  return { parts, byId, numberInSection };
}

/** Total questions per section — used by the header label and scoring. */
export function sectionTotals(parts: ExamPart[]): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const p of parts) {
    totals[p.section] = (totals[p.section] ?? 0) + p.questionIds.length;
  }
  return totals;
}
