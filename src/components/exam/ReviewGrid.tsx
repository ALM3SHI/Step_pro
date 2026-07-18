'use client';

import { memo, useMemo } from 'react';
import type { ExamPart } from '@/lib/exam/buildExam';
import type { SessionState } from '@/lib/exam/session';

export interface ReviewGridProps {
  session: SessionState;
  part: ExamPart;
  isLastPart: boolean;
  onJumpToScreen: (screenIndex: number) => void;
}

/**
 * End-of-part review screen.
 *
 * Title bar, instructions box, incomplete counter, and the question
 * table — the structure a STEP candidate expects between parts.
 *
 * The footer is NOT rendered here; the shell owns that slot and the
 * runner supplies <ReviewFooter/>. Rendering it in both places duplicated
 * the whole action row on screen.
 */
export const ReviewGrid = memo(function ReviewGrid({
  session,
  part,
  isLastPart,
  onJumpToScreen,
}: ReviewGridProps) {
  const rows = useMemo(
    () =>
      part.questionIds.map((id) => ({
        id,
        number: session.exam.numberInSection[id],
        complete: Boolean(session.answers[id]),
        flagged: Boolean(session.flags[id]),
        screenIndex: part.screens.findIndex((sc) => sc.questionIds.includes(id)),
      })),
    [part, session.answers, session.flags, session.exam.numberInSection],
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
    <div className="flex w-full flex-wrap items-stretch">
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
    </div>
  );
}
