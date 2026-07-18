/**
 * Content from the built bundle.
 *
 * Zero dependencies at runtime: no database, no network, no API key. The
 * simulator works the moment `npm run content:build` has run, which is
 * what keeps it usable while the Supabase path is still being wired.
 *
 * The bundle is imported statically so Next can inline it into the
 * server build — reading it from disk at request time would break on
 * Vercel, where the filesystem is read-only and the CWD is not the repo
 * root.
 */

import bundleJson from '../../../content/bundle.json';
import type { AudioClip, ContentBundle, Passage } from './schema';
import type { ContentProvider, ContentSnapshot } from './provider';

const bundle = bundleJson as unknown as ContentBundle;

let cached: ContentSnapshot | null = null;

export class BundleContentProvider implements ContentProvider {
  readonly name = 'bundle';

  async load(): Promise<ContentSnapshot> {
    // Built once per process. The bundle is immutable at runtime, so
    // rebuilding these maps per request would be pure waste.
    if (cached) return cached;

    cached = {
      questions: bundle.questions,
      passages: new Map<string, Passage>(bundle.passages.map((p) => [p.id, p])),
      audioClips: new Map<string, AudioClip>(bundle.audioClips.map((a) => [a.id, a])),
    };
    return cached;
  }
}

/** Synchronous access, for scripts and tests. */
export function loadBundleSnapshot(): ContentSnapshot {
  if (!cached) {
    cached = {
      questions: bundle.questions,
      passages: new Map(bundle.passages.map((p) => [p.id, p])),
      audioClips: new Map(bundle.audioClips.map((a) => [a.id, a])),
    };
  }
  return cached;
}

export const bundleMeta = {
  version: bundle.version,
  generatedAt: bundle.generatedAt,
  counts: bundle.counts,
};
