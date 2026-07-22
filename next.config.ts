import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  /**
   * The parser-review page reads these corpora from disk at request time.
   *
   * Vercel ships only the files its trace analysis finds, and a path
   * built with `path.join(process.cwd(), name)` is invisible to that
   * analysis — so without this the page works locally and throws ENOENT
   * in production. Listed explicitly rather than globbed: these two are
   * review fixtures, and nothing else should be readable at runtime.
   */
  outputFileTracingIncludes: {
    '/admin/parser-debug': ['./reading_bank.txt', './gramer_bank.txt'],
  },

  experimental: {
    /**
     * Question batches only. Audio does NOT pass through here.
     *
     * Vercel enforces a hard 4.5 MB cap on function request and response
     * bodies and returns FUNCTION_PAYLOAD_TOO_LARGE above it — raising
     * this value cannot lift that ceiling, it only changes what Next
     * accepts locally. This is set to 4 MB so local dev fails the same
     * way production does instead of passing and then breaking on
     * deploy. Ingestion chunks at 100 questions per call to stay well
     * under it; MP3s go browser -> Supabase Storage directly.
     */
    serverActions: { bodySizeLimit: '4mb' },
  },
};

export default nextConfig;
