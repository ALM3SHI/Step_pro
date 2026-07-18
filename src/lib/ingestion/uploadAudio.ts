'use client';

import { getBrowserClient } from '@/lib/supabase/client';
import { createAudioUploadUrl } from '@/app/actions/ingestion';

export interface UploadOutcome {
  ok: boolean;
  error?: string;
  audioKey?: string;
  storagePath?: string;
}

/**
 * Upload an MP3 straight to Supabase Storage.
 *
 * Two steps, and the split is the whole point:
 *   1. a Server Action validates size/type and mints a one-shot signed
 *      upload token (a few hundred bytes over the wire);
 *   2. the BROWSER sends the file directly to Supabase.
 *
 * The file never passes through a Vercel function, so the 4.5 MB payload
 * cap does not apply. Sending the MP3 to a Server Action instead would
 * fail with FUNCTION_PAYLOAD_TOO_LARGE for anything over ~4.5 MB — and
 * most listening clips here are larger than that.
 */
export async function uploadListeningAudio(file: File): Promise<UploadOutcome> {
  const signed = await createAudioUploadUrl({
    fileName: file.name,
    sizeBytes: file.size,
    mimeType: file.type,
  });

  if (!signed.ok || !signed.path || !signed.token) {
    return { ok: false, error: signed.error ?? 'تعذّر إنشاء رابط الرفع' };
  }

  const supabase = getBrowserClient();
  const { error } = await supabase.storage
    .from(signed.bucket!)
    .uploadToSignedUrl(signed.path, signed.token, file, {
      contentType: file.type || 'audio/mpeg',
      upsert: true,
    });

  if (error) return { ok: false, error: `فشل الرفع: ${error.message}` };

  return { ok: true, audioKey: signed.audioKey, storagePath: signed.path };
}
