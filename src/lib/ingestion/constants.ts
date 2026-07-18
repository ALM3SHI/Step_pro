/**
 * Shared ingestion constants.
 *
 * Kept out of the `'use server'` action files: those may only export
 * async functions, so a plain `export const` there is a build error.
 */

export const AUDIO_BUCKET = 'listening-audio';

/** Matches the bucket's file_size_limit in migration 0005. */
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

// Not `as const` — this is used with .includes() against an arbitrary
// client-supplied MIME string, and a readonly tuple narrows the
// parameter type so that check no longer compiles.
export const ALLOWED_AUDIO_MIME: string[] = [
  'audio/mpeg',
  'audio/mp3',
  'audio/mp4',
  'audio/x-m4a',
  'audio/wav',
];

/**
 * Questions per Server Action call.
 *
 * Vercel caps function bodies at 4.5 MB; 100 questions with passages
 * lands far below that with room for long reading stimuli.
 */
export const SAVE_CHUNK = 100;
export const MAX_QUESTIONS_PER_CALL = 200;
