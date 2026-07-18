import { createClient } from '@supabase/supabase-js';

/**
 * Service-role client. SERVER ONLY.
 *
 * This key bypasses every RLS policy. It must never be imported into a
 * client component or referenced in code that ships to the browser — the
 * runtime guard below turns that mistake into an immediate crash instead
 * of a silent full-database leak.
 */
export function createServiceClient() {
  if (typeof window !== 'undefined') {
    throw new Error('createServiceClient() was called in the browser — this would leak the service-role key.');
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
  }

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * True when Supabase is configured.
 *
 * Lets a page render a "not configured" state instead of a 500. The
 * exam simulator reads from the content bundle and does not need a
 * database at all, so a missing key must degrade features rather than
 * take the site down.
 */
export function isSupabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}
