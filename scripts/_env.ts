/**
 * Environment loading for the plain tsx scripts.
 *
 * Next loads .env.local automatically; a bare `tsx` process does not, so
 * the migration and verification scripts have to read it themselves.
 *
 * Placeholder values are detected explicitly: pasting the example file
 * unedited otherwise fails deep inside the Supabase client with
 * "Invalid API key", which sends you looking in the wrong place.
 */
import { readFileSync } from 'node:fs';

const PLACEHOLDER = /YOUR-PROJECT|your-anon-key|your-service-role-key|\.\.\.|xxxx/i;

export function loadEnvFile(file = '.env.local'): boolean {
  try {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (/^\s*#/.test(line)) continue;
      const m = line.match(/^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
      // Existing process env wins, so a shell override still works.
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
      }
    }
    return true;
  } catch {
    return false;
  }
}

export interface SupabaseEnv {
  url: string;
  serviceKey: string;
}

/** Resolve Supabase credentials or exit with actionable instructions. */
export function requireSupabaseEnv(): SupabaseEnv {
  const found = loadEnvFile();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const missing: string[] = [];
  if (!url) missing.push('NEXT_PUBLIC_SUPABASE_URL');
  if (!serviceKey) missing.push('SUPABASE_SERVICE_ROLE_KEY');

  const placeholders: string[] = [];
  if (url && PLACEHOLDER.test(url)) placeholders.push('NEXT_PUBLIC_SUPABASE_URL');
  if (serviceKey && PLACEHOLDER.test(serviceKey)) placeholders.push('SUPABASE_SERVICE_ROLE_KEY');

  if (missing.length || placeholders.length) {
    console.error('\n' + '='.repeat(60));
    if (!found) {
      console.error('No .env.local found in the project root.');
    }
    if (missing.length) console.error(`Missing: ${missing.join(', ')}`);
    if (placeholders.length) console.error(`Still a placeholder: ${placeholders.join(', ')}`);

    console.error('\nCreate a file named exactly ".env.local" beside package.json:\n');
    console.error('  NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co');
    console.error('  NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon public key>');
    console.error('  SUPABASE_SERVICE_ROLE_KEY=<service_role secret key>');
    console.error('\nSupabase Dashboard -> Project Settings -> API');
    console.error('  Project URL  -> NEXT_PUBLIC_SUPABASE_URL');
    console.error('  anon public  -> NEXT_PUBLIC_SUPABASE_ANON_KEY');
    console.error('  service_role -> SUPABASE_SERVICE_ROLE_KEY   (secret — never commit)');
    console.error('\n.env.local is already in .gitignore, so it will not be committed.');
    console.error('='.repeat(60) + '\n');
    process.exit(1);
  }

  // A service_role key is a JWT; the anon key is too, and pasting the
  // wrong one is the most common mistake here. RLS would then block the
  // migration with a confusing permission error instead of this.
  if (!/^ey[A-Za-z0-9_-]+\./.test(serviceKey!)) {
    console.error('SUPABASE_SERVICE_ROLE_KEY does not look like a Supabase key (expected it to start with "ey").');
    process.exit(1);
  }

  return { url: url!, serviceKey: serviceKey! };
}
