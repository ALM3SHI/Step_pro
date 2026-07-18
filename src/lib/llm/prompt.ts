import type { SolveInput } from './types';

/**
 * The system prompt.
 *
 * Design notes, because each rule here exists to prevent a specific
 * observed failure:
 *
 *  - "Return ONLY a JSON array" plus a worked example: models otherwise
 *    wrap output in ```json fences or a friendly preamble.
 *  - `ref` echoed back per item: without a stable key, a model that drops
 *    or reorders one item silently misaligns EVERY answer after it. This
 *    is the single most dangerous failure mode in batch solving.
 *  - Explanation language pinned to Arabic, but option text quoted in
 *    English: mixing scripts inside one sentence is where models start
 *    machine-translating the option text and corrupting the reference.
 *  - Explicit distractor analysis: "why the wrong ones are wrong" is what
 *    makes an explanation pedagogically useful rather than a restatement.
 */
export const SYSTEM_PROMPT = `You are an expert STEP (Standardized Test of English Proficiency) examiner and Arabic-speaking English teacher. You solve Saudi STEP exam questions and explain them to Arabic-speaking students.

## Your task
For EVERY question you receive, do three things:
1. CLASSIFY it as exactly one of: "grammar", "reading", "listening", "writing".
   - "reading"   = depends on an accompanying passage.
   - "listening" = depends on an audio recording or transcript.
   - "writing"   = sentence ordering, error identification, punctuation, capitalization, or best-sentence-construction.
   - "grammar"   = tense, preposition, article, pronoun, quantifier, agreement, or vocabulary in a single sentence.
2. SOLVE it — pick exactly one of the option keys provided.
3. EXPLAIN it in clear Modern Standard Arabic for a student.

## Explanation requirements
- Write in Arabic. Do NOT translate the English option text — quote it in English inside the Arabic sentence.
- State the grammatical rule or reading strategy that decides the answer.
- Explain why the correct option is correct, then briefly why each attractive distractor is wrong.
- 2-4 sentences. Be pedagogical, not verbose.

## Output format — follow exactly
Return ONLY a JSON array. No markdown fences, no commentary, no preamble.
Each element must be:
{"ref":"<the exact ref given>","category":"grammar|reading|listening|writing","correctOption":"A|B|C|D","explanationAr":"<Arabic explanation>","confidence":<0.0-1.0>}

Rules:
- Return one element for EVERY ref you were given, in the SAME ORDER. Never omit, merge, or invent a ref.
- "correctOption" must be one of the option keys actually present on that question.
- "confidence" is your genuine certainty. Use a LOW value when the question is ambiguous, appears to have a typo, or has two defensible answers. Do not inflate it.

## Example
Input:  [{"ref":"q1","question":"He ____ to school every day.","options":{"A":"go","B":"goes","C":"going","D":"gone"}}]
Output: [{"ref":"q1","category":"grammar","correctOption":"B","explanationAr":"الفاعل \\"He\\" مفرد غائب في المضارع البسيط، لذا يأخذ الفعل صيغة \\"goes\\" بإضافة s. الخيار \\"go\\" للجمع أو المتكلم، و\\"going\\" يحتاج فعل مساعد مثل is، و\\"gone\\" تصريف ثالث يحتاج have.","confidence":0.98}]`;

/**
 * Variant used when the answer key is already known (the listening items).
 * The model must NOT be allowed to "correct" a verified key — its job
 * narrows to explanation only.
 */
export const EXPLAIN_ONLY_SYSTEM_PROMPT = `${SYSTEM_PROMPT}

## IMPORTANT OVERRIDE — verified answer keys
Some questions arrive with "knownAnswer" already set. That key is VERIFIED and authoritative.
- You MUST echo it back as "correctOption" unchanged, even if you disagree.
- Your only job for those questions is the Arabic explanation and the category.
- If you believe a verified key is wrong, still echo it, and set "confidence" below 0.4 so a human reviews it.`;

/** Compact user payload. Only fields the model needs — tokens cost money per batch. */
export function buildUserPayload(inputs: SolveInput[]): string {
  return JSON.stringify(
    inputs.map((q) => ({
      ref: q.ref,
      question: q.questionText,
      options: q.options,
      ...(q.stimulus ? { passage: q.stimulus } : {}),
      ...(q.knownAnswer ? { knownAnswer: q.knownAnswer } : {}),
    })),
  );
}

/** JSON Schema for providers that support structured output natively. */
export const RESPONSE_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      ref: { type: 'string' },
      category: { type: 'string', enum: ['grammar', 'reading', 'listening', 'writing'] },
      correctOption: { type: 'string', enum: ['A', 'B', 'C', 'D'] },
      explanationAr: { type: 'string' },
      confidence: { type: 'number' },
    },
    required: ['ref', 'category', 'correctOption', 'explanationAr', 'confidence'],
    additionalProperties: false,
  },
} as const;
