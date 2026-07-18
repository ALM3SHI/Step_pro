/**
 * Content from Supabase — the source of truth after migration.
 *
 * Implements the same `ContentProvider` interface as the bundle, so the
 * exam builder, practice mode, the dashboard, and the future AI and
 * chatbot services all read through one seam and none of them know or
 * care where the rows come from.
 *
 * Reads `servable_questions`, the view that defines "publishable" once
 * (published + active + stimulus present) instead of re-implementing
 * that rule in every caller.
 */

import { createServiceClient } from '../supabase/server';
import type { ContentProvider, ContentSnapshot } from './provider';
import type { AudioClip, OptionKey, Passage, Question } from './schema';
import type { Difficulty, SectionId } from './taxonomy';

interface ServableRow {
  id: string;
  external_id: string | null;
  category: SectionId;
  skill_id: string | null;
  difficulty: Difficulty | null;
  tags: string[] | null;
  question_text: string;
  options: Record<OptionKey, string>;
  correct_option: OptionKey;
  explanation: string | null;
  passage_id: string | null;
  audio_clip_id: string | null;
  ordinal: number | null;
  image_url: string | null;
  image_alt: string | null;
  content_hash: string;
  passage_body: string | null;
  passage_title: string | null;
  passage_image_url: string | null;
  passage_image_alt: string | null;
  audio_key: string | null;
  storage_path: string | null;
}

export interface SupabaseProviderOptions {
  /** Cache lifetime. Content changes rarely; a per-request fetch of
   *  ~1,100 rows would dominate exam start latency. */
  ttlMs?: number;
}

const DEFAULT_TTL_MS = 60_000;

let cache: { at: number; snapshot: ContentSnapshot } | null = null;

export class SupabaseContentProvider implements ContentProvider {
  readonly name = 'supabase';
  private ttlMs: number;

  constructor(opts: SupabaseProviderOptions = {}) {
    this.ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  }

  /** Drop the cache after an admin edit so changes appear immediately. */
  static invalidate() {
    cache = null;
  }

  async load(): Promise<ContentSnapshot> {
    if (cache && Date.now() - cache.at < this.ttlMs) return cache.snapshot;

    const db = createServiceClient();

    // Paged: PostgREST caps a single response, and silently receiving
    // only the first 1,000 rows would shrink the question pool without
    // any error to notice.
    const rows: ServableRow[] = [];
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await db
        .from('servable_questions')
        .select('*')
        .range(from, from + PAGE - 1);
      if (error) throw new Error(`content load failed: ${error.message}`);
      if (!data?.length) break;
      rows.push(...(data as ServableRow[]));
      if (data.length < PAGE) break;
    }

    const passages = new Map<string, Passage>();
    const audioClips = new Map<string, AudioClip>();
    const questions: Question[] = [];

    for (const r of rows) {
      if (r.passage_id && r.passage_body && !passages.has(r.passage_id)) {
        passages.set(r.passage_id, {
          id: r.passage_id,
          titleEn: r.passage_title ?? undefined,
          body: r.passage_body,
          imageUrl: r.passage_image_url ?? undefined,
          imageAlt: r.passage_image_alt ?? undefined,
          contentHash: '',
        });
      }

      if (r.audio_clip_id && r.storage_path && !audioClips.has(r.audio_clip_id)) {
        audioClips.set(r.audio_clip_id, {
          id: r.audio_clip_id,
          audioKey: r.audio_key ?? r.audio_clip_id,
          storagePath: r.storage_path,
        });
      }

      questions.push({
        // The database id is authoritative once Supabase is the source
        // of truth; external_id is only the migration trace.
        id: r.id,
        section: r.category,
        // A NULL skill would break every per-skill analytic. The
        // migration verifier fails on this, so it should be impossible —
        // but defaulting is safer than crashing an exam build.
        skillId: r.skill_id ?? 'tenses',
        difficulty: r.difficulty ?? 'medium',
        text: r.question_text,
        options: r.options,
        correctOption: r.correct_option,
        explanationAr: r.explanation ?? undefined,
        passageId: r.passage_id ?? undefined,
        audioClipId: r.audio_clip_id ?? undefined,
        ordinal: r.ordinal ?? undefined,
        imageUrl: r.image_url ?? undefined,
        imageAlt: r.image_alt ?? undefined,
        tags: r.tags ?? [],
        contentHash: r.content_hash,
        // The view only returns published rows.
        status: 'published',
        sourceRef: r.external_id ?? undefined,
      });
    }

    const snapshot: ContentSnapshot = { questions, passages, audioClips };
    cache = { at: Date.now(), snapshot };
    return snapshot;
  }
}
