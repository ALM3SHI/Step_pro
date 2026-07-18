'use client';

import { memo } from 'react';
import { ExamAudioPlayer } from './ExamAudioPlayer';
import type { ExamQuestion } from '@/lib/exam/types';

/**
 * Left pane content: chart, passage, audio, or plain instructions.
 *
 * An analytical item can carry BOTH an image and a passage (a chart plus
 * its commentary), so the image renders above the text rather than
 * replacing it.
 */
export const ExamStimulus = memo(function ExamStimulus({
  question,
  instructions,
}: {
  question: ExamQuestion | undefined;
  instructions: string;
}) {
  if (!question) return <div className="x-instr-pane">{instructions}</div>;

  const hasImage = Boolean(question.imageUrl);
  const hasPassage = Boolean(question.passageText?.trim());

  if (question.audioUrl) {
    return (
      <div>
        {hasImage && <Figure url={question.imageUrl!} alt={question.imageAlt} />}
        <ExamAudioPlayer src={question.audioUrl} />
      </div>
    );
  }

  if (hasImage || hasPassage) {
    return (
      <div>
        {hasImage && <Figure url={question.imageUrl!} alt={question.imageAlt} />}
        {hasPassage && <div className="x-passage">{question.passageText}</div>}
      </div>
    );
  }

  return <div className="x-instr-pane" dir="ltr">{instructions}</div>;
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

export const SECTION_INSTRUCTIONS: Record<string, string> = {
  reading: 'Read the passage carefully, then answer the questions on the right.',
  grammar: 'Choose the option that best completes the sentence or is grammatically correct.',
  listening: 'Listen to the recording. It will play once only. Then answer the questions.',
  writing: 'Read each item carefully and choose the best-constructed option.',
};
