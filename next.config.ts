import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
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
