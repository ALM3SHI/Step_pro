'use client';

import { memo } from 'react';
import { ExamAudioPlayer } from './ExamAudioPlayer';

/**
 * Left pane content: chart, passage, audio, or plain instructions.
 *
 * Takes resolved values rather than a question object — the stimulus
 * belongs to the SCREEN, not to any one question on it, and passing the
 * first question was a quiet way to lose that distinction.
 */
export const ExamStimulus = memo(function ExamStimulus({
  passageText,
  audioUrl,
  imageUrl,
  imageAlt,
  instructions,
}: {
  passageText?: string;
  audioUrl?: string;
  imageUrl?: string;
  imageAlt?: string;
  instructions: string;
}) {
  const hasImage = Boolean(imageUrl);

  if (audioUrl) {
    return (
      <div>
        {hasImage && <Figure url={imageUrl!} alt={imageAlt} />}
        <ExamAudioPlayer src={audioUrl} />
      </div>
    );
  }

  if (hasImage || passageText?.trim()) {
    return (
      <div>
        {hasImage && <Figure url={imageUrl!} alt={imageAlt} />}
        {passageText?.trim() && <div className="x-passage">{passageText}</div>}
      </div>
    );
  }

  return <div className="x-instr-pane" dir="rtl">{instructions}</div>;
});

function Figure({ url, alt }: { url: string; alt?: string }) {
  return (
    <figure className="x-figure">
      {/* Plain <img>, not next/image: stimulus graphics come from
          Supabase storage at unknown dimensions, and the optimizer would
          need every bucket host allow-listed up front. */}
      <img src={url} alt={alt ?? ''} loading="eager" decoding="async" />
      {alt && <figcaption>{alt}</figcaption>}
    </figure>
  );
}
