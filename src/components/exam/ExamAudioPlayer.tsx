'use client';

/**
 * Listening stimulus player.
 *
 * Mirrors real STEP behaviour: after a short reading window the clip
 * plays ONCE, automatically, and the controls are inert. Letting a
 * student replay audio would invalidate the section, so the lock is
 * enforced on playback state, not just by hiding the button.
 */

import { useEffect, useRef, useState } from 'react';

export interface ExamAudioPlayerProps {
  src: string;
  /** Seconds to read the questions before playback begins. */
  readSeconds?: number;
  onEnded?: () => void;
}

type Phase = 'reading' | 'playing' | 'done';

const clock = (s: number) => {
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
};

export function ExamAudioPlayer({ src, readSeconds = 15, onEnded }: ExamAudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [phase, setPhase] = useState<Phase>('reading');
  const [countdown, setCountdown] = useState(readSeconds);
  const [elapsed, setElapsed] = useState(0);
  const [duration, setDuration] = useState(0);
  const [blocked, setBlocked] = useState(false);

  // Reading window.
  useEffect(() => {
    if (phase !== 'reading') return;
    if (countdown <= 0) { setPhase('playing'); return; }
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [phase, countdown]);

  // Single automatic playback.
  useEffect(() => {
    if (phase !== 'playing') return;
    const el = audioRef.current;
    if (!el) return;
    el.play().catch(() => {
      // Browsers block autoplay without a user gesture. Surface a single
      // explicit start control rather than leaving a silent dead player.
      setBlocked(true);
    });
  }, [phase]);

  const startManually = () => {
    setBlocked(false);
    audioRef.current?.play().catch(() => setBlocked(true));
  };

  const pct = duration > 0 ? Math.min(100, (elapsed / duration) * 100) : 0;

  return (
    <div className="x-audio" dir="ltr">
      <div
        className={`flex max-w-[560px] items-center gap-3 rounded-[10px] border p-4 ${
          phase === 'playing' ? 'border-[#e0e7ec] bg-[#f2f5f7]' : 'border-[#d5dee6] bg-[#f1f5f9]'
        }`}
      >
        <button
          type="button"
          disabled={!blocked}
          onClick={startManually}
          aria-label={blocked ? 'Start audio' : 'Audio plays automatically'}
          className="h-9 w-9 flex-shrink-0 rounded-full border-none bg-[#01589b] text-white disabled:opacity-40"
        >
          {phase === 'playing' ? '❚❚' : '▶'}
        </button>

        <div className="h-[5px] flex-1 overflow-hidden rounded-full bg-[#c9d4dd]">
          <div className="h-full bg-[#01589b] transition-[width] duration-1000 ease-linear" style={{ width: `${pct}%` }} />
        </div>

        <span className="whitespace-nowrap text-[0.85rem] tabular-nums text-[#5a6b7a]">
          {clock(elapsed)} / {duration ? clock(duration) : '--:--'}
        </span>
      </div>

      <div
        className={`mt-3 text-left text-[0.9rem] leading-[1.75] ${
          phase === 'playing' ? 'font-semibold text-[#01589b]'
            : phase === 'done' ? 'font-semibold text-[#159079]' : 'text-[#5a6b7a]'
        }`}
        role="status"
        aria-live="polite"
      >
        {blocked && 'Press ▶ to start the recording. It will play once only.'}
        {!blocked && phase === 'reading' && `Read the questions. The recording starts in ${countdown}s and plays ONCE only.`}
        {!blocked && phase === 'playing' && 'Now playing — this recording will not be repeated.'}
        {!blocked && phase === 'done' && 'The recording has finished.'}
      </div>

      <audio
        ref={audioRef}
        src={src}
        preload="auto"
        controlsList="nodownload"
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
        onTimeUpdate={(e) => setElapsed(e.currentTarget.currentTime)}
        onEnded={() => { setPhase('done'); onEnded?.(); }}
        className="hidden"
      />
    </div>
  );
}
