'use client';

import type { OptionKey } from '@/lib/llm/types';

export interface QuestionBlockProps {
  number: number;
  questionText: string;
  options: Partial<Record<OptionKey, string>>;
  selected?: OptionKey;
  onSelect: (key: OptionKey) => void;
  disabled?: boolean;
}

const ORDER: OptionKey[] = ['A', 'B', 'C', 'D'];

/**
 * One question with its radio options.
 *
 * The real simulator shows NO A/B/C/D letters next to options — only
 * radio circles — so the letter is exposed to assistive tech via
 * aria-label instead of being drawn. Adding visible letters here would
 * break the pixel match.
 */
export function QuestionBlock({
  number,
  questionText,
  options,
  selected,
  onSelect,
  disabled = false,
}: QuestionBlockProps) {
  const present = ORDER.filter((k) => options[k]?.trim());

  return (
    <div className="border-b border-[#e4eaef] py-4 first:pt-0 last:border-b-0">
      <div className="mb-[10px] text-[0.9rem] text-[#5a6b7a]" dir="ltr">
        Question {number}
      </div>

      {/* dangerouslySetInnerHTML is deliberately NOT used: legacy items
          contain raw <br> tags, but rendering ingested content as HTML
          would let a poisoned paste inject markup into the exam. */}
      <p className="x-qtext">{questionText}</p>

      <div className="mt-[10px] flex flex-col gap-2" role="radiogroup" aria-label={`Question ${number}`}>
        {present.map((key) => (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={selected === key}
            aria-label={`Option ${key}: ${options[key]}`}
            disabled={disabled}
            data-selected={selected === key}
            className="x-opt"
            onClick={() => onSelect(key)}
          >
            <span className="x-radio" aria-hidden="true" />
            <span>{options[key]}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
