'use client';

/**
 * The STEP exam chrome: header + sub-bar + two-pane body + footer.
 *
 * This is a faithful port of `.xshell` from the legacy step-prep.html.
 * Structure, colours, and geometry are the simulation — treat changes
 * here as changes to test fidelity, not styling preferences.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ExamTimer, useTimeWarning } from './ExamTimer';

export interface ExamShellProps {
  title?: string;
  /** Epoch ms when the current part expires. null before it starts. */
  deadlineAt: number | null;
  onTimeExpired: () => void;
  /** Legacy prop, retained for the standalone demo route. */
  secondsRemaining?: number;
  questionLabel: string;
  stimulus?: ReactNode;
  footer: ReactNode;
  /** Replaces `footer` outright — used by the review grid. */
  footerOverride?: ReactNode;
  showFlag?: boolean;
  flagged?: boolean;
  onToggleFlag?: () => void;
  children: ReactNode;
}

const FONT_SIZES = [12, 13, 14, 16, 18, 20, 22];

export function ExamShell({
  title = '',
  deadlineAt,
  onTimeExpired,
  questionLabel,
  stimulus,
  footer,
  footerOverride,
  showFlag = false,
  flagged = false,
  onToggleFlag,
  children,
}: ExamShellProps) {
  const [fontSize, setFontSize] = useState(16);
  const [fullscreen, setFullscreen] = useState(false);
  const shellRef = useRef<HTMLDivElement>(null);

  const warn = useTimeWarning(deadlineAt);

  // Lock page scroll while the exam owns the viewport.
  useEffect(() => {
    if (!fullscreen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [fullscreen]);

  // Track the browser's own fullscreen state so the button label stays
  // truthful when the user leaves via Esc rather than our control.
  useEffect(() => {
    const onChange = () => { if (!document.fullscreenElement) setFullscreen(false); };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        setFullscreen(false);
      } else {
        await shellRef.current?.requestFullscreen();
        setFullscreen(true);
      }
    } catch {
      // Fullscreen can be refused (iOS Safari, permissions policy).
      // Fall back to the CSS-only fixed overlay so the exam still fills
      // the viewport rather than silently doing nothing.
      setFullscreen((v) => !v);
    }
  };

  return (
    <div
      ref={shellRef}
      className={`x-shell ${fullscreen ? 'x-shell--fs' : ''}`}
      style={{ ['--xfs' as string]: `${fontSize}px` }}
    >
      <div className="x-header" data-warn={warn}>
        <span className="whitespace-nowrap rounded-md bg-white px-3 py-[3px] text-[0.85rem] font-extrabold text-[#01589b]">
          STEP PRO
        </span>
        <button
          type="button"
          onClick={toggleFullscreen}
          title="Fullscreen / exit"
          aria-label="Toggle fullscreen"
          className={`h-[34px] w-[34px] flex-shrink-0 rounded-lg border-none text-white ${
            fullscreen ? 'bg-[#0ea5e9]' : 'bg-white/15 hover:bg-white/30'
          }`}
        >
          ⛶
        </button>
        <span className="min-w-[140px] flex-1 text-center font-bold">{title}</span>
        <span className="whitespace-nowrap text-right text-[0.78rem] leading-[1.5]">
          🕓 Time Remaining <ExamTimer deadlineAt={deadlineAt} onExpire={onTimeExpired} />
          <br />
          <span className="opacity-90">{questionLabel}</span>
        </span>
      </div>

      <div className="x-subbar">
        {showFlag && (
          <button
            type="button"
            onClick={onToggleFlag}
            aria-pressed={flagged}
            className={`cursor-pointer rounded-md border px-3 py-1 text-[0.85rem] font-bold ${
              flagged
                ? 'border-[#d98e32] bg-[#d98e32] text-[#221503]'
                : 'border-white bg-white text-[#01589b]'
            }`}
          >
            ⚑ Flag for Review
          </button>
        )}
        <span className="flex-1" />
        <label className="flex items-center gap-2">
          Font Size:
          <select
            value={fontSize}
            onChange={(e) => setFontSize(Number(e.target.value))}
            className="rounded-[5px] border-none px-2 py-[2px] font-[inherit] text-[#1c2733]"
          >
            {FONT_SIZES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </label>
      </div>

      <div className="x-main" data-single={!stimulus}>
        {stimulus && <div className="x-stimulus">{stimulus}</div>}
        <div className="x-question">{children}</div>
      </div>

      <div className="x-footer">{footerOverride ?? footer}</div>

      <div
        className="x-rotate-nag fixed inset-0 z-[300] hidden flex-col items-center justify-center gap-4 bg-[#01589b] p-7 text-center text-white"
        role="alert"
      >
        <div className="text-5xl">📱</div>
        <p className="text-lg font-bold">أدر جهازك أفقيًا</p>
        <p className="text-sm opacity-80">اختبار STEP يُؤدى في الوضع الأفقي</p>
      </div>
    </div>
  );
}
