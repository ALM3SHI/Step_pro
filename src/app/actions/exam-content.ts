'use server';

import { createServiceClient } from '@/lib/supabase/server';
import { AUDIO_BUCKET } from '@/lib/ingestion/constants';
import type { ExamQuestion, SectionKey } from '@/lib/exam/types';

/**
 * Signed-URL lifetime for exam audio.
 *
 * Must outlast the whole sitting, not just the listening part: URLs are
 * signed once when the exam loads, and a candidate can spend an hour on
 * Reading before reaching Listening. A 1-hour default would expire
 * mid-exam and the audio would 403 with no way to recover.
 */
const AUDIO_URL_TTL_SECONDS = 4 * 60 * 60;

export interface LoadExamOptions {
  /** How many questions to draw per section. */
  counts?: Partial<Record<SectionKey, number>>;
}

const DEFAULT_COUNTS: Record<SectionKey, number> = {
  reading: 16,
  grammar: 12,
  listening: 8,
  writing: 4,
};

/**
 * Build an exam pool from the live question bank.
 *
 * Answer keys and explanations ARE included: the results dashboard needs
 * them the moment the exam ends, and withholding them would mean a
 * second round trip at the worst possible moment. This is acceptable
 * because the authoritative score is computed server-side in
 * submit_exam_attempt — a candidate who reads the keys out of the
 * network tab can cheat themselves, not the recorded score.
 */
export async function loadExamQuestions(
  opts: LoadExamOptions = {},
): Promise<{ ok: boolean; questions?: ExamQuestion[]; error?: string }> {
  const db = createServiceClient();
  const counts = { ...DEFAULT_COUNTS, ...opts.counts };
  const out: ExamQuestion[] = [];

  try {
    for (const section of Object.keys(counts) as SectionKey[]) {
      const limit = counts[section];
      if (!limit) continue;

      const { data, error } = await db
        .from('questions')
        .select(`
          id, category, question_text, options, correct_option, explanation,
          image_url, image_alt, ordinal,
          passage_id, passages ( id, body, title, image_url, image_alt ),
          audio_clip_id, audio_clips ( id, audio_key, storage_path )
        `)
        .eq('category', section)
        .eq('is_active', true)
        .limit(limit);

      if (error) return { ok: false, error: `${section}: ${error.message}` };

      for (const row of data ?? []) {
        const passage = Array.isArray(row.passages) ? row.passages[0] : row.passages;
        const clip = Array.isArray(row.audio_clips) ? row.audio_clips[0] : row.audio_clips;

        out.push({
          id: row.id as string,
          section,
          questionText: row.question_text as string,
          options: row.options as ExamQuestion['options'],
          correctOption: row.correct_option as ExamQuestion['correctOption'],
          explanationAr: (row.explanation as string) ?? undefined,
          passageId: (row.passage_id as string) ?? undefined,
          passageText: passage?.body ?? undefined,
          audioId: (row.audio_clip_id as string) ?? undefined,
          // Filled in below, in one batch.
          audioUrl: clip?.storage_path ?? undefined,
          imageUrl: (row.image_url as string) ?? passage?.image_url ?? undefined,
          imageAlt: (row.image_alt as string) ?? passage?.image_alt ?? undefined,
        });
      }
    }

    // Sign each DISTINCT clip once. Signing per question would issue
    // three different URLs for a three-question clip, and the player is
    // keyed by audioId — three URLs would defeat that and re-fetch the
    // same audio three times.
    const paths = [...new Set(out.map((q) => q.audioUrl).filter((p): p is string => Boolean(p)))];
    if (paths.length) {
      const { data: signed, error } = await db.storage
        .from(AUDIO_BUCKET)
        .createSignedUrls(paths, AUDIO_URL_TTL_SECONDS);

      if (error) return { ok: false, error: `audio signing failed: ${error.message}` };

      const urlByPath = new Map<string, string>();
      for (const s of signed ?? []) {
        if (s.signedUrl && s.path) urlByPath.set(s.path, s.signedUrl);
      }

      for (const q of out) {
        if (!q.audioUrl) continue;
        const url = urlByPath.get(q.audioUrl);
        // A listening question with no playable URL is unanswerable —
        // drop the audio rather than render a dead player.
        q.audioUrl = url;
      }
    }

    const usable = out.filter((q) => q.section !== 'listening' || Boolean(q.audioUrl));
    return { ok: true, questions: usable };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
