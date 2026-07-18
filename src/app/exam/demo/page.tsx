'use client';

/**
 * Visual reference route for the exam simulator. Not part of the student
 * flow — it exists so the port can be compared side by side against the
 * legacy step-prep.html rendering.
 */

import { useEffect, useState } from 'react';
import { ExamShell } from '@/components/exam/ExamShell';
import { QuestionBlock } from '@/components/exam/QuestionBlock';
import type { OptionKey } from '@/lib/llm/types';

const PASSAGE = `In the year 2000, people spent $3.2 trillion dollars on travel. In 2005, they spent $3.4 trillion. In 2016, they will probably spend about $4.2 trillion. What is the most popular country that people go to? France is the most popular: 62.4 million people went to France in 2006. The United States is the second most popular country to visit: 46.3 million people went there in 2006. Spain was third, with 41.3 million visitors. Italy and Britain came next, and China was sixth.

Who travels? Europeans and some Asians travel to other countries the most. But Americans spend the most money in other countries. In 2006, Americans spent $52.6 billion in other countries. Germans were next: they spent $49.8 billion in other countries.`;

const QUESTIONS = [
  {
    questionText: 'The third most popular country people visit is ____',
    options: { A: 'France', B: 'China', C: 'Italy', D: 'Spain' } as Record<OptionKey, string>,
  },
  {
    questionText: 'Who spends the most money on trips?',
    options: { A: 'Americans', B: 'Germans', C: 'Japanese', D: 'French' } as Record<OptionKey, string>,
  },
];

export default function ExamDemoPage() {
  const [answers, setAnswers] = useState<Record<number, OptionKey>>({});
  const [flagged, setFlagged] = useState(false);

  // Set after mount: computing a deadline during render would differ
  // between server and client and trip a hydration mismatch.
  const [deadlineAt, setDeadlineAt] = useState<number | null>(null);
  useEffect(() => { setDeadlineAt(Date.now() + 25 * 60 * 1000); }, []);

  const answeredCount = Object.keys(answers).length;

  return (
    <div className="mx-auto max-w-[1100px] p-4">
      <ExamShell
        deadlineAt={deadlineAt}
        onTimeExpired={() => {}}
        questionLabel={`Questions 1-${QUESTIONS.length} of 40`}
        showFlag
        flagged={flagged}
        onToggleFlag={() => setFlagged((v) => !v)}
        stimulus={<div className="x-passage">{PASSAGE}</div>}
        footer={
          <div className="flex w-full flex-wrap items-stretch">
            <button type="button" className="x-btn x-btn--go">Next &gt;</button>
            <button type="button" className="x-btn">&lt; Back</button>
            <span className="flex-1" />
            <button type="button" className="x-btn x-btn--dim">Help | ？</button>
          </div>
        }
      >
        {QUESTIONS.map((q, i) => (
          <QuestionBlock
            key={i}
            number={i + 1}
            questionText={q.questionText}
            options={q.options}
            selected={answers[i]}
            onSelect={(key) => setAnswers((a) => ({ ...a, [i]: key }))}
          />
        ))}
        <p className="mt-4 text-xs text-[#5a6b7a]" dir="ltr">
          {answeredCount} of {QUESTIONS.length} answered
        </p>
      </ExamShell>
    </div>
  );
}
