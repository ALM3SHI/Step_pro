'use client';

/**
 * Background persistence for a running session.
 *
 * Rules, in priority order:
 *  1. Never block the exam. Sync is fire-and-forget; a click must never
 *     wait on the network, and a Supabase outage must not stop a sitting.
 *  2. Never lose the last answer. A debounce alone drops whatever was
 *     pending when the tab closes, so part transitions and pagehide
 *     force an immediate flush.
 *  3. Never apply stale writes. Every payload carries the reducer's
 *     revision; the server discards anything it has already passed.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { saveAttempt } from '@/app/actions/attempts';
import type { SessionState } from './session';

export type SyncStatus = 'idle' | 'saving' | 'saved' | 'error' | 'offline' | 'disabled';

const DEBOUNCE_MS = 1200;

export function useAttemptSync(attemptId: string | null, state: SessionState) {
  const [status, setStatus] = useState<SyncStatus>(attemptId ? 'idle' : 'disabled');
  const [lastSavedRevision, setLastSavedRevision] = useState(0);

  // Latest state without making it an effect dependency — the flush
  // callbacks must see current data without being recreated per answer.
  const stateRef = useRef(state);
  stateRef.current = state;

  const inFlight = useRef(false);
  const pending = useRef(false);

  const flush = useCallback(async () => {
    if (!attemptId) return;
    const s = stateRef.current;
    if (s.revision === 0) return;

    // Serialise: two concurrent writes race, and the newer revision can
    // lose. Mark pending and run after the current one settles.
    if (inFlight.current) { pending.current = true; return; }

    inFlight.current = true;
    setStatus('saving');

    try {
      const res = await saveAttempt({
        attemptId,
        revision: s.revision,
        answers: s.answers,
        flags: Object.keys(s.flags),
        partIndex: s.partIndex,
        screenIndex: s.screenIndex,
        phase: s.phase,
        partTimings: s.partTimings,
        lockedScreens: s.lockedScreens,
      });

      if (res.ok) {
        setStatus('saved');
        // Record what the server actually holds, not what we sent — a
        // lost race means a newer revision already won.
        setLastSavedRevision(res.storedRevision ?? s.revision);
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

  // Part boundaries are irreversible, so they bypass the debounce.
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
