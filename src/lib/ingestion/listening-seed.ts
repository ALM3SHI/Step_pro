/**
 * Listening section seed data.
 *
 * Transcribed from the mapping supplied by the platform owner. Every item
 * here was independently cross-checked against the answer keys already
 * embedded in the legacy step-prep.html bank — all 20 agree. The
 * cross-check is re-runnable: scripts/verify-listening-seed.ts.
 *
 * These questions arrive with VERIFIED keys, so the LLM never solves
 * them; it only writes the Arabic explanation, and is explicitly
 * forbidden from overriding the key (see EXPLAIN_ONLY_SYSTEM_PROMPT).
 */

import type { OptionKey } from '../llm/types';
import { hashQuestion } from './dedupe';

export interface ListeningSeedQuestion {
  ordinal: number;
  questionText: string;
  options: Record<OptionKey, string>;
  correctOption: OptionKey;
}

export interface ListeningSeedClip {
  audioKey: string;
  fileName: string;
  questions: ListeningSeedQuestion[];
}

const clip = (
  audioKey: string,
  questions: Array<[string, [string, string, string, string], OptionKey]>,
): ListeningSeedClip => ({
  audioKey,
  fileName: `${audioKey}.mp3`,
  questions: questions.map(([questionText, opts, correctOption], i) => ({
    ordinal: i + 1,
    questionText,
    options: { A: opts[0], B: opts[1], C: opts[2], D: opts[3] },
    correctOption,
  })),
});

export const LISTENING_SEED: ListeningSeedClip[] = [
  clip('1742938770', [
    ['This conversation most likely takes place …',
      ['In a grocery store', 'In a restaurant', 'In a house', 'On a train'], 'B'],
  ]),

  clip('1742938781', [
    ['What kind of project is Osama working on?',
      ['A current events project', 'A business project', 'A family project', 'A history project'], 'D'],
  ]),

  clip('1742938790', [
    ['Most of the participants at a picnic are …',
      ['Drivers', 'Students', 'Friends', 'Families'], 'D'],
    ['Who is the caller talking to?',
      ['A tourism guide', 'A sales manager', 'A travel attendant', 'A travel agent'], 'D'],
  ]),

  clip('1742938798', [
    ['When will the caller fly?',
      ['September 13', 'September 30', 'November 13', 'November 30'], 'A'],
    ["What is the traveler's reservation number?",
      ['1066', '1606', '6601', '6610'], 'A'],
  ]),

  clip('1742938810', [
    ['The octopus can squeeze into tight spaces because it …',
      ['Uses its beak to prey open tight spaces', 'Has no internal or external skeleton',
        'Has a flexible internal skeleton', 'Is behaviorally flexible'], 'B'],
    ['All octopuses are venomous but …',
      ['Only the blue-ringed octopus has been known to kill humans',
        'There have been NO known deaths in recent years',
        'There have only been 300 reported deaths',
        'NONE are deadly to human beings'], 'A'],
  ]),

  clip('1742938822', [
    ['This lecture is most likely to occur in …',
      ['A history class', 'A biology class', 'A chemistry class', 'A geography class'], 'D'],
    ['What is the second longest river in the world?',
      ['The Mississippi', 'The Yangtze', 'The Amazon', 'The Nile'], 'C'],
  ]),

  clip('1742938831', [
    ['Eyad is a good language learner because he …',
      ['Travelled to many foreign countries', 'Lived abroad for many years',
        'Studies almost all the time', 'Likes to talk to people'], 'D'],
    ['What does Eyad say is the most important thing when learning a language?',
      ['Studying abroad', 'Travelling to foreign countries',
        'Having an interest in learning English',
        'Having a host family that only speaks English'], 'C'],
  ]),

  clip('1742938840', [
    ['This announcement would probably be heard in an airport in …',
      ['Doha', 'Bahrain', 'Riyadh', 'Frankfurt'], 'A'],
    ['What has caused the delay?',
      ['A mechanical problem', 'A scheduling problem', 'A medical problem', 'A security problem'], 'C'],
    ['Passengers are asked to board the flight at …',
      ['Gate A6', 'Gate B2', 'The main terminal', 'The security checkpoints'], 'A'],
  ]),

  clip('1742938851', [
    ["The woman's problem is that she …",
      ["DOESN'T have much time", "DOESN'T have much money",
        "CAN'T decide where to go", "CAN'T decide how to travel"], 'C'],
    ['We can conclude that the woman …',
      ['Likes Europe a lot', 'Wants to stay at home',
        'Thinks Europe is costly', 'Has NOT travelled often'], 'C'],
    ['We can conclude that the woman and her husband …',
      ['Have different tastes', 'Are unhappy together',
        "DON'T like foreign places", 'Spend lots of money on travel'], 'A'],
  ]),

  clip('1742938861', [
    ['The two people talking in the conversation are probably …',
      ['A receptionist and a university applicant', 'A secretary and a job applicant',
        'A banker and a loan applicant', 'A boss and a new employee'], 'B'],
    ['The conversation probably takes place in a …',
      ['University office', 'Conference room', 'Business office', 'Cafeteria'], 'C'],
  ]),
];

export const LISTENING_QUESTION_COUNT = LISTENING_SEED.reduce((n, c) => n + c.questions.length, 0);

/** Flatten to rows ready for insertion, with dedupe hashes attached. */
export function listeningSeedRows() {
  return LISTENING_SEED.flatMap((c) =>
    c.questions.map((q) => ({
      audioKey: c.audioKey,
      fileName: c.fileName,
      ordinal: q.ordinal,
      questionText: q.questionText,
      options: q.options,
      correctOption: q.correctOption,
      contentHash: hashQuestion(q.questionText, q.options),
    })),
  );
}
