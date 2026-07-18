'use client';

import { memo, useMemo } from 'react';
import type { ExamPart, ExamState } from '@/lib/exam/types';

export interface ReviewGridProps {
  state: ExamState;
  part: ExamPart;
  isLastPart: boolean;
  onJumpToScreen: (screenIndex: number) => void;
}

/**
 * The end-of-part review screen.
 *
 * Port of the legacy `reviewView`: title bar, blue instructions box,
 * status bar with the incomplete count, and the question table. Markup
 * and classes mirror `.xrev*` / `.xtable` / `.xqrow` exactly.
 *
 * The footer is NOT rendered here — the shell owns that slot and the
 * workspace supplies <ReviewFooter/> through `footerOverride`. Rendering
 * it in both places duplicated the entire action row on screen.
 */
export const ReviewGrid = memo(function ReviewGrid({
  state,
  part,
  isLastPart,
  onJumpToScreen,
}: ReviewGridProps) {
  // Derived once per state change rather than per row render.
  const rows = useMemo(
    () =>
      part.questionIds.map((id) => ({
        id,
        number: state.numberInSection[id],
        complete: Boolean(state.answers[id]),
        flagged: Boolean(state.flags[id]),
        screenIndex: part.screens.findIndex((sc) => sc.includes(id)),
      })),
    [part, state.answers, state.flags, state.numberInSection],
  );

  const incomplete = rows.filter((r) => !r.complete).length;

  return (
    <div className="x-rev" dir="ltr">
        <div className="x-rev-title">
          {part.labelEn} - Part {part.partNo} - Review
        </div>

        <div className="x-instr">
          <div className="x-instr-head">Instructions</div>
          <div className="x-instr-body">
            Below is a summary of your answers. You can review your questions in three (3)
            different ways using the buttons in the lower corner, or click on a question number
            to go directly to its location in the test.
            {!isLastPart && (
              <> <b>Note:</b> after you press Next Part, you cannot return to this part.</>
            )}
          </div>
        </div>

        <div className="x-revbar">
          <span>{part.labelEn} - Part {part.partNo}</span>
          <span>(Incomplete {incomplete} of {rows.length})</span>
        </div>

        <div className="x-table">
          {rows.map((r) => (
            <button
              key={r.id}
              type="button"
              className="x-qrow"
              onClick={() => onJumpToScreen(r.screenIndex)}
            >
              <span className={r.flagged ? 'x-fon' : 'x-foff'} aria-hidden>⚑</span>
              <span>Question {r.number}</span>
              <span className="flex-1" />
              <span className={r.complete ? 'x-st-c' : 'x-st-i'}>
                {r.complete ? 'Complete' : 'Incomplete'}
              </span>
            </button>
          ))}
        </div>
    </div>
  );
});

/** Rendered into the shell's footer slot. */
export function ReviewFooter({
  isLastPart,
  hasFlagged,
  hasIncomplete,
  onAdvance,
  onReviewAll,
  onReviewIncomplete,
  onReviewFlagged,
}: {
  isLastPart: boolean;
  hasFlagged: boolean;
  hasIncomplete: boolean;
  onAdvance: () => void;
  onReviewAll: () => void;
  onReviewIncomplete: () => void;
  onReviewFlagged: () => void;
}) {
  return (
    <div className="flex w-full flex-wrap items-stretch" data-review-footer>
      <button type="button" className="x-btn x-btn--go" onClick={onAdvance}>
        {isLastPart ? 'Finish Exam ✓' : 'Next Part >'}
      </button>
      <span className="flex-1" />
      <button type="button" className="x-btn" onClick={onReviewFlagged} disabled={!hasFlagged}>
        Review Flagged ⚑
      </button>
      <button type="button" className="x-btn" onClick={onReviewIncomplete} disabled={!hasIncomplete}>
        Review Incomplete ⊗
      </button>
      <button type="button" className="x-btn" onClick={onReviewAll}>
        Review All ▷
      </button>
      <button type="button" className="x-btn x-btn--dim">Help | ？</button>
    </div>
  );
}
