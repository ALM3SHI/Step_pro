'use client';

/**
 * Background persistence for a running attempt.
 *
 * Design constraints, in priority order:
 *  1. Never block the UI. Sync is fire-and-forget; the candidate's
 *     clicks must never wait on the network.
 *  2. Never lose the last answer. A debounce alone drops whatever was
 *     pending when the tab closes, so submission and pagehide force an
 *     immediate flush.
 *  3. Never apply stale writes. Every payload carries the engine's
 *     revision; the server discards anything it has already passed.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { syncAttempt } from '@/app/exam/actions';
import type { ExamState, OptionKey } from './types';

export type SyncStatus = 'idle' | 'saving' | 'saved' | 'error' | 'offline';

const DEBOUNCE_MS = 1200;

function toPayload(attemptId: string, state: ExamState) {
  return {
    attemptId,
    revision: state.revision,
    answers: state.answers as Record<string, OptionKey>,
    flags: Object.keys(state.flags),
    currentPart: state.partIndex,
    screenIndex: state.screenIndex,
    phase: state.phase,
    partTimings: state.partTimings,
    lockedScreens: state.lockedScreens,
  };
}

export function useAttemptSync(attemptId: string | null, state: ExamState) {
  const [status, setStatus] = useState<SyncStatus>('idle');
  const [lastSavedRevision, setLastSavedRevision] = useState(0);

  // Latest state without making it an effect dependency — the flush
  // callbacks must see current data without being recreated per keystroke.
  const stateRef = useRef(state);
  stateRef.current = state;

  const inFlight = useRef(false);
  const pending = useRef(false);

  const flush = useCallback(async () => {
    if (!attemptId) return;
    const snapshot = stateRef.current;
    if (snapshot.revision === 0) return;

    // Serialise: a second request while one is in flight would race, and
    // the newer revision could lose. Mark pending and run after.
    if (inFlight.current) { pending.current = true; return; }

    inFlight.current = true;
    setStatus('saving');

    try {
      const res = await syncAttempt(toPayload(attemptId, snapshot));
      if (res.ok) {
        setStatus('saved');
        // `applied: false` just means a newer revision won the race.
        // Record what the server actually holds, not what we sent.
        setLastSavedRevision(res.storedRevision ?? snapshot.revision);
      } else {
        setStatus('error');
      }
    } catch {
      setStatus(typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'error');
    } finally {
      inFlight.current = false;
      if (pending.current) {
        pending.current = false;
        void flush();
      }
    }
  }, [attemptId]);

  // Debounced sync on every accepted change.
  useEffect(() => {
    if (!attemptId || state.revision === 0) return;
    if (state.revision === lastSavedRevision) return;

    const t = setTimeout(() => { void flush(); }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [attemptId, state.revision, lastSavedRevision, flush]);

  // Phase transitions are the expensive things to lose (a part boundary
  // is irreversible), so they bypass the debounce entirely.
  const lastPhase = useRef(state.phase);
  const lastPart = useRef(state.partIndex);
  useEffect(() => {
    if (state.phase !== lastPhase.current || state.partIndex !== lastPart.current) {
      lastPhase.current = state.phase;
      lastPart.current = state.partIndex;
      void flush();
    }
  }, [state.phase, state.partIndex, flush]);

  // Tab close / navigation away. `visibilitychange` on hidden is the
  // reliable signal on mobile Safari, where `beforeunload` often never
  // fires at all.
  useEffect(() => {
    if (!attemptId) return;
    const onHide = () => { if (document.visibilityState === 'hidden') void flush(); };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onHide);
    };
  }, [attemptId, flush]);

  return {
    status,
    lastSavedRevision,
    unsavedChanges: state.revision > lastSavedRevision,
    flushNow: flush,
  };
}
