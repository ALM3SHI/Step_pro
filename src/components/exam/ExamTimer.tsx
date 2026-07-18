'use client';

import { memo, useEffect, useRef, useState } from 'react';

export interface ExamTimerProps {
  /** Epoch ms when this part expires, or null before it starts. */
  deadlineAt: number | null;
  onExpire: () => void;
}

const pad = (n: number) => String(n).padStart(2, '0');
export const formatClock = (s: number) => `${pad(Math.floor(Math.max(0, s) / 60))}:${pad(Math.max(0, s) % 60)}`;

/**
 * Isolated clock.
 *
 * The whole reason the engine stores a DEADLINE rather than a
 * seconds-remaining counter: the tick lives here, so one second of exam
 * time re-renders this component and nothing else. Putting the countdown
 * in the reducer would re-render the passage, every option, and the
 * audio player once per second for the length of the exam.
 *
 * Renders nothing until mounted — server and client would otherwise
 * disagree on the time and trip a hydration mismatch.
 */
export const ExamTimer = memo(function ExamTimer({ deadlineAt, onExpire }: ExamTimerProps) {
  const [remaining, setRemaining] = useState<number | null>(null);

  // Keeps the latest callback without making it an effect dependency,
  // so a new inline handler on the parent cannot restart the interval.
  const onExpireRef = useRef(onExpire);
  useEffect(() => { onExpireRef.current = onExpire; }, [onExpire]);

  useEffect(() => {
    if (deadlineAt === null) { setRemaining(null); return; }

    let fired = false;
    const tick = () => {
      const left = Math.round((deadlineAt - Date.now()) / 1000);
      setRemaining(left);
      if (left <= 0 && !fired) {
        fired = true;
        onExpireRef.current();
      }
    };

    tick();
    // Drift-free: re-aligns to the wall clock each tick rather than
    // accumulating setInterval lag over a 45-minute part.
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [deadlineAt]);

  const display = remaining === null ? '00:00' : formatClock(remaining);

  return (
    <b className="text-[1.08rem] tabular-nums" suppressHydrationWarning>
      {display}
    </b>
  );
});

/** True when the header should turn red. Kept separate so the colour
 *  change does not depend on re-rendering the clock's parent. */
export function useTimeWarning(deadlineAt: number | null): boolean {
  const [warn, setWarn] = useState(false);

  useEffect(() => {
    if (deadlineAt === null) { setWarn(false); return; }
    const check = () => setWarn(deadlineAt - Date.now() < 120_000);
    check();
    const id = setInterval(check, 1000);
    return () => clearInterval(id);
  }, [deadlineAt]);

  return warn;
}
