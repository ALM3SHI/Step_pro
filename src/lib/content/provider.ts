/**
 * Content source abstraction.
 *
 * The exam engine asks for questions; it never knows where they came
 * from. Today that is the built bundle (works with no database, no
 * network, no keys). Tomorrow it is Supabase, and later it may be an
 * AI-assisted adaptive selector — each is a new implementation of this
 * interface, not a change to the engine.
 *
 * This is also the seam the future AI services plug into: an adaptive
 * provider that picks the next question from a learner's weakness
 * profile satisfies the same contract.
 */

import type { AudioClip, Passage, Question } from './schema';
import type { Difficulty, SectionId } from './taxonomy';

export interface PoolQuery {
  section: SectionId;
  /** Only `published` is servable; drafts lack verified answer keys. */
  statuses?: Array<Question['status']>;
  skillIds?: string[];
  /** Targeted practice narrows to one band; the exam never sets this. */
  difficulties?: Difficulty[];
  excludeIds?: Set<string>;
}

export interface ContentSnapshot {
  questions: Question[];
  passages: Map<string, Passage>;
  audioClips: Map<string, AudioClip>;
}

export interface ContentProvider {
  readonly name: string;
  load(): Promise<ContentSnapshot>;
}

/** Filter a snapshot down to a servable pool. */
export function selectPool(snapshot: ContentSnapshot, query: PoolQuery): Question[] {
  const statuses = new Set(query.statuses ?? ['published']);
  const skills = query.skillIds?.length ? new Set(query.skillIds) : null;
  const difficulties = query.difficulties?.length ? new Set(query.difficulties) : null;

  return snapshot.questions.filter((q) => {
    if (q.section !== query.section) return false;
    if (!statuses.has(q.status)) return false;
    if (skills && !skills.has(q.skillId)) return false;
    if (difficulties && !difficulties.has(q.difficulty)) return false;
    if (query.excludeIds?.has(q.id)) return false;

    // A question whose stimulus is missing is unanswerable. Cheaper to
    // exclude here than to render a dead audio player mid-exam.
    if (q.audioClipId && !snapshot.audioClips.has(q.audioClipId)) return false;
    if (q.passageId && !snapshot.passages.has(q.passageId)) return false;
    return true;
  });
}
