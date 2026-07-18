'use client';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Browser client. ANON KEY ONLY.
 *
 * Its single job is uploading audio straight to Storage with a
 * server-issued signed URL. Vercel functions cap request bodies at
 * 4.5 MB, so routing a 20 MB MP3 through a Server Action returns
 * FUNCTION_PAYLOAD_TOO_LARGE no matter what bodySizeLimit says — the
 * file has to skip the function entirely.
 *
 * The anon key is public by design and safe to ship. The service-role
 * key must never appear in this file or anything it imports.
 */
let cached: SupabaseClient | null = null;

export function getBrowserClient(): SupabaseClient {
  if (cached) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set.',
    );
  }

  cached = createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
  return cached;
}
