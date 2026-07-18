/**
 * Exam assembly: blueprint + content pool -> a concrete exam.
 *
 * The inversion that matters: the BLUEPRINT declares the shape (how many
 * questions, how many parts, how long), and the builder selects content
 * to fill it. The old prototype did the opposite — it derived the exam
 * from whatever questions happened to exist, so the exam silently
 * changed shape as the bank grew.
 *
 * Selection is deterministic given a seed, so an exam can be rebuilt
 * identically for resume, review, and audit.
 */

import type { Blueprint, PartSpec } from '../content/blueprint';
import type { ContentSnapshot } from '../content/provider';
import { selectPool } from '../content/provider';
import type { Passage, Question } from '../content/schema';
import { SECTION_DEFS, type SectionId } from '../content/taxonomy';

export interface ExamScreen {
  /** Question ids shown together on one page. */
  questionIds: string[];
  /** Shared stimulus, if any. */
  passageId?: string;
  audioClipId?: string;
}

export interface ExamPart {
  index: number;
  section: SectionId;
  partNo: number;
  labelAr: string;
  labelEn: string;
  screens: ExamScreen[];
  questionIds: string[];
  durationSeconds: number;
  allowsBack: boolean;
  allowsReview: boolean;
}

export interface BuiltExam {
  blueprintId: string;
  nameAr: string;
  instantFeedback: boolean;
  parts: ExamPart[];
  questions: Record<string, Question>;
  /** Only the passages this exam actually uses. */
  passages: Record<string, Passage>;
  /**
   * Playable audio URL per clip id.
   *
   * Resolved at build time so the runner never needs to know whether the
   * source is a local file or a signed Supabase URL.
   */
  audioUrls: Record<string, string>;
  /** 1-based number within its section, matching the header display. */
  numberInSection: Record<string, number>;
  totalQuestions: number;
  totalSeconds: number;
  seed: number;
  /** Sections that could not be filled to blueprint. */
  shortfalls: Array<{ section: SectionId; wanted: number; got: number }>;
}

// ---------------------------------------------------------------------
// Deterministic shuffling
// ---------------------------------------------------------------------

/** mulberry32 — small, fast, and reproducible from a seed. */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ---------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------

interface StimulusGroup {
  passageId?: string;
  audioClipId?: string;
  questions: Question[];
}

/**
 * Group a pool into screens-worth of questions.
 *
 * Reading questions that share a passage MUST stay together — splitting
 * a passage across two parts would show the same passage twice and let a
 * candidate answer half of it after the part is locked. Same for a
 * listening clip, which plays once.
 */
function groupByStimulus(pool: Question[], section: SectionId): StimulusGroup[] {
  if (section === 'grammar' || section === 'writing') {
    return pool.map((q) => ({ questions: [q] }));
  }

  const groups = new Map<string, StimulusGroup>();
  for (const q of pool) {
    const key = q.passageId ?? q.audioClipId ?? `solo:${q.id}`;
    const existing = groups.get(key);
    if (existing) existing.questions.push(q);
    else {
      groups.set(key, {
        passageId: q.passageId,
        audioClipId: q.audioClipId,
        questions: [q],
      });
    }
  }

  // Keep multi-question groups in their authored order (Q1/Q2/Q3 of a
  // clip), which `ordinal` encodes when present.
  for (const g of groups.values()) {
    g.questions.sort((a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0));
  }
  return [...groups.values()];
}

/**
 * Pack groups into parts of a target size without splitting a group.
 *
 * Greedy best-fit: take the largest group that still fits. This keeps
 * part sizes close to target while guaranteeing whole stimuli.
 */
function packIntoParts(
  groups: StimulusGroup[],
  targets: number[],
): StimulusGroup[][] {
  const remaining = [...groups].sort((a, b) => b.questions.length - a.questions.length);
  const parts: StimulusGroup[][] = targets.map(() => []);
  const filled = targets.map(() => 0);

  for (let p = 0; p < targets.length; p++) {
    while (filled[p] < targets[p] && remaining.length) {
      const room = targets[p] - filled[p];
      // Largest group that fits; if none fits, take the smallest so the
      // part is not left empty over an oversized group.
      let idx = remaining.findIndex((g) => g.questions.length <= room);
      if (idx === -1) idx = remaining.length - 1;
      const [group] = remaining.splice(idx, 1);
      parts[p].push(group);
      filled[p] += group.questions.length;
    }
  }

  // Anything left over (target overshoot) goes to the emptiest part
  // rather than being dropped.
  for (const group of remaining) {
    let min = 0;
    for (let p = 1; p < parts.length; p++) if (filled[p] < filled[min]) min = p;
    parts[min].push(group);
    filled[min] += group.questions.length;
  }

  return parts;
}

// ---------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------

export interface BuildOptions {
  seed?: number;
  /** Questions already seen, to avoid repeats across sittings. */
  excludeIds?: Set<string>;
  /** Include drafts. Admin preview only — drafts have placeholder keys. */
  includeDrafts?: boolean;
  /**
   * Turns a clip's storagePath into a playable URL.
   *
   * Defaults to the local `/listening/…` copy so the simulator runs with
   * no storage configured; the Supabase path supplies a signed-URL
   * resolver instead.
   */
  resolveAudioUrl?: (storagePath: string) => string;
}

export function buildExam(
  blueprint: Blueprint,
  snapshot: ContentSnapshot,
  opts: BuildOptions = {},
): BuiltExam {
  const seed = opts.seed ?? 1;
  const rng = makeRng(seed);

  const partsBySection = new Map<SectionId, PartSpec[]>();
  for (const spec of blueprint.parts) {
    partsBySection.set(spec.section, [...(partsBySection.get(spec.section) ?? []), spec]);
  }

  const parts: ExamPart[] = [];
  const questions: Record<string, Question> = {};
  const shortfalls: BuiltExam['shortfalls'] = [];

  for (const [section, specs] of partsBySection) {
    const wanted = specs.reduce((n, s) => n + s.questionCount, 0);

    const pool = selectPool(snapshot, {
      section,
      statuses: opts.includeDrafts ? ['published', 'draft'] : ['published'],
      excludeIds: opts.excludeIds,
    });

    const groups = shuffle(groupByStimulus(pool, section), rng);

    // Take enough groups to cover the section, then pack into parts.
    const taken: StimulusGroup[] = [];
    let count = 0;
    for (const g of groups) {
      if (count >= wanted) break;
      taken.push(g);
      count += g.questions.length;
    }

    if (count < wanted) {
      // Report rather than silently shipping a short exam. The caller
      // decides whether to proceed — a practice drill can, a graded
      // simulation should not.
      shortfalls.push({ section, wanted, got: count });
    }

    /**
     * Rebalance targets to what actually exists.
     *
     * Using the blueprint's targets against a short pool lets the first
     * parts consume everything and leaves the last one EMPTY — a
     * candidate would reach "Part 3" with no questions in it. Scaling
     * the targets keeps every part populated and the section coherent,
     * just shorter, and the shortfall above records the difference.
     */
    const targets = specs.map((s) => s.questionCount);
    if (count < wanted && count > 0) {
      const partCount = Math.min(specs.length, count);
      const per = Math.floor(count / partCount);
      const extra = count % partCount;
      for (let i = 0; i < targets.length; i++) {
        targets[i] = i < partCount ? per + (i < extra ? 1 : 0) : 0;
      }
    }

    const packed = packIntoParts(taken, targets);
    const def = SECTION_DEFS[section];
    const sectionParts: ExamPart[] = [];

    specs.forEach((spec, i) => {
      const groupsForPart = packed[i] ?? [];
      // Drop a part that ended up with nothing rather than rendering an
      // empty one.
      if (!groupsForPart.length) return;

      const screens: ExamScreen[] = groupsForPart.map((g) => ({
        questionIds: g.questions.map((q) => q.id),
        passageId: g.passageId,
        audioClipId: g.audioClipId,
      }));

      const ids = screens.flatMap((s) => s.questionIds);
      for (const g of groupsForPart) for (const q of g.questions) questions[q.id] = q;

      sectionParts.push({
        index: 0, // assigned after ordering
        section,
        partNo: sectionParts.length + 1, // renumber so parts stay 1..N
        labelAr: def.nameAr,
        labelEn: def.nameEn,
        screens,
        questionIds: ids,
        durationSeconds: spec.durationSeconds,
        allowsBack: def.allowsBack,
        allowsReview: def.allowsReview,
      });
    });

    // A dropped part must not take its minutes with it — the section
    // keeps its full time budget, spread over the parts that survived.
    const budget = specs.reduce((n, s) => n + s.durationSeconds, 0);
    const allocated = sectionParts.reduce((n, p) => n + p.durationSeconds, 0);
    if (sectionParts.length && allocated < budget) {
      const bonus = Math.floor((budget - allocated) / sectionParts.length);
      let leftover = budget - allocated - bonus * sectionParts.length;
      for (const p of sectionParts) {
        p.durationSeconds += bonus + (leftover-- > 0 ? 1 : 0);
      }
    }

    parts.push(...sectionParts);
  }

  // Present sections in the official order.
  parts.sort((a, b) => {
    const d = SECTION_DEFS[a.section].displayOrder - SECTION_DEFS[b.section].displayOrder;
    return d !== 0 ? d : a.partNo - b.partNo;
  });
  parts.forEach((p, i) => { p.index = i; });

  // Numbering restarts per section, matching the exam header.
  const numberInSection: Record<string, number> = {};
  const seen: Partial<Record<SectionId, number>> = {};
  for (const p of parts) {
    for (const id of p.questionIds) {
      seen[p.section] = (seen[p.section] ?? 0) + 1;
      numberInSection[id] = seen[p.section]!;
    }
  }

  const totalQuestions = parts.reduce((n, p) => n + p.questionIds.length, 0);

  // Carry only the stimuli this exam uses, so the payload sent to the
  // browser is the exam — not the entire content bank.
  const resolveAudio = opts.resolveAudioUrl ?? ((path: string) => `/listening/${path}`);
  const passages: Record<string, Passage> = {};
  const audioUrls: Record<string, string> = {};

  for (const p of parts) {
    for (const s of p.screens) {
      if (s.passageId) {
        const passage = snapshot.passages.get(s.passageId);
        if (passage) passages[s.passageId] = passage;
      }
      if (s.audioClipId) {
        const clip = snapshot.audioClips.get(s.audioClipId);
        if (clip) audioUrls[s.audioClipId] = resolveAudio(clip.storagePath);
      }
    }
  }

  return {
    blueprintId: blueprint.id,
    nameAr: blueprint.nameAr,
    instantFeedback: blueprint.instantFeedback,
    parts,
    questions,
    passages,
    audioUrls,
    numberInSection,
    totalQuestions,
    totalSeconds: parts.reduce((n, p) => n + p.durationSeconds, 0),
    seed,
    shortfalls,
  };
}

/** Total questions available per section, for the start screen. */
export function poolSummary(snapshot: ContentSnapshot, includeDrafts = false) {
  const out: Record<string, number> = {};
  for (const section of Object.keys(SECTION_DEFS) as SectionId[]) {
    out[section] = selectPool(snapshot, {
      section,
      statuses: includeDrafts ? ['published', 'draft'] : ['published'],
    }).length;
  }
  return out;
}
