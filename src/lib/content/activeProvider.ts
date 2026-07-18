/**
 * The single place that decides where content comes from.
 *
 * Everything — the simulator, practice, the admin dashboard, and the
 * future AI and chatbot services — imports `getContentProvider()` and
 * never constructs a provider directly. Changing the source of truth is
 * therefore one edit here, not a hunt through the codebase.
 *
 * Selection:
 *   CONTENT_SOURCE=supabase   force the database
 *   CONTENT_SOURCE=bundle     force the built file
 *   (unset)                   supabase when configured, else bundle
 *
 * The fallback matters: a fresh clone with no keys still runs the
 * simulator from the bundle rather than showing an empty exam.
 */

import { BundleContentProvider } from './bundleProvider';
import { SupabaseContentProvider } from './supabaseProvider';
import { isSupabaseConfigured } from '../supabase/server';
import type { ContentProvider } from './provider';

let cached: ContentProvider | null = null;

export function getContentProvider(): ContentProvider {
  if (cached) return cached;

  const forced = process.env.CONTENT_SOURCE?.toLowerCase();

  if (forced === 'bundle') {
    cached = new BundleContentProvider();
  } else if (forced === 'supabase') {
    if (!isSupabaseConfigured()) {
      throw new Error('CONTENT_SOURCE=supabase but Supabase keys are not configured.');
    }
    cached = new SupabaseContentProvider();
  } else {
    cached = isSupabaseConfigured()
      ? new SupabaseContentProvider()
      : new BundleContentProvider();
  }

  return cached;
}

/** Call after an admin write so the next read sees the change. */
export function invalidateContentCache(): void {
  SupabaseContentProvider.invalidate();
  cached = null;
}

/** Which source is live — shown in the admin UI so it is never a guess. */
export function activeContentSource(): 'supabase' | 'bundle' {
  return getContentProvider().name === 'supabase' ? 'supabase' : 'bundle';
}
