/**
 * Provider adapters.
 *
 * Every provider is reduced to one operation — "here is a JSON payload of
 * questions, return a JSON array of answers" — so switching providers is
 * an env var change. Nothing above this file knows which vendor is live.
 */

import { EXPLAIN_ONLY_SYSTEM_PROMPT, RESPONSE_SCHEMA, SYSTEM_PROMPT, buildUserPayload } from './prompt';
import { extractJsonArray, validateResults } from './parse';
import { LLMError, type GenerateOptions, type LLMProvider, type LLMResponse, type SolveInput } from './types';

function systemFor(inputs: SolveInput[]): string {
  return inputs.some((q) => q.knownAnswer) ? EXPLAIN_ONLY_SYSTEM_PROMPT : SYSTEM_PROMPT;
}

function finish(text: string, inputs: SolveInput[], usage?: LLMResponse['usage']): LLMResponse {
  const arr = extractJsonArray(text);
  if (!arr) {
    return { results: [], missing: inputs.map((q) => q.ref), usage };
  }
  const { results, missing } = validateResults(arr, inputs);
  return { results, missing, usage };
}

/** Retryable = worth backing off on. 429 and 5xx yes; 400/401/403 no. */
function classify(status: number): boolean {
  return status === 429 || status === 408 || status >= 500;
}

// ---------------------------------------------------------------------
// Google Gemini
// ---------------------------------------------------------------------
export class GeminiProvider implements LLMProvider {
  readonly name = 'gemini';
  constructor(
    private apiKey: string,
    readonly model = 'gemini-1.5-flash',
  ) {}

  async solveBatch(inputs: SolveInput[], opts: GenerateOptions = {}): Promise<LLMResponse> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: opts.signal,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemFor(inputs) }] },
        contents: [{ role: 'user', parts: [{ text: buildUserPayload(inputs) }] }],
        generationConfig: {
          temperature: opts.temperature ?? 0,
          maxOutputTokens: opts.maxOutputTokens ?? 8192,
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA,
        },
      }),
    });

    if (!res.ok) {
      throw new LLMError(`gemini ${res.status}: ${await res.text()}`, this.name, classify(res.status), res.status);
    }

    const data = await res.json();
    const text: string = data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('') ?? '';
    return finish(text, inputs, {
      inputTokens: data?.usageMetadata?.promptTokenCount,
      outputTokens: data?.usageMetadata?.candidatesTokenCount,
    });
  }
}

// ---------------------------------------------------------------------
// OpenAI (also covers any OpenAI-compatible endpoint, incl. Ollama)
// ---------------------------------------------------------------------
export class OpenAIProvider implements LLMProvider {
  readonly name = 'openai';
  constructor(
    private apiKey: string,
    readonly model = 'gpt-4o-mini',
    private baseUrl = 'https://api.openai.com/v1',
  ) {}

  async solveBatch(inputs: SolveInput[], opts: GenerateOptions = {}): Promise<LLMResponse> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey}`,
      },
      signal: opts.signal,
      body: JSON.stringify({
        model: this.model,
        temperature: opts.temperature ?? 0,
        max_tokens: opts.maxOutputTokens ?? 8192,
        // json_object (not json_schema) because our top level is an array;
        // the prompt pins the shape and parse.ts validates it.
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: `${systemFor(inputs)}\n\nWrap the array in {"results": [...]}.` },
          { role: 'user', content: buildUserPayload(inputs) },
        ],
      }),
    });

    if (!res.ok) {
      throw new LLMError(`openai ${res.status}: ${await res.text()}`, this.name, classify(res.status), res.status);
    }

    const data = await res.json();
    const text: string = data?.choices?.[0]?.message?.content ?? '';

    // json_object mode returns {"results":[...]}; unwrap before parsing.
    let payload = text;
    try {
      const obj = JSON.parse(text);
      if (obj && !Array.isArray(obj) && Array.isArray(obj.results)) payload = JSON.stringify(obj.results);
    } catch { /* fall through to the tolerant extractor */ }

    return finish(payload, inputs, {
      inputTokens: data?.usage?.prompt_tokens,
      outputTokens: data?.usage?.completion_tokens,
    });
  }
}

// ---------------------------------------------------------------------
// Anthropic
// ---------------------------------------------------------------------
export class AnthropicProvider implements LLMProvider {
  readonly name = 'anthropic';
  constructor(
    private apiKey: string,
    readonly model = 'claude-haiku-4-5-20251001',
  ) {}

  async solveBatch(inputs: SolveInput[], opts: GenerateOptions = {}): Promise<LLMResponse> {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      signal: opts.signal,
      body: JSON.stringify({
        model: this.model,
        max_tokens: opts.maxOutputTokens ?? 8192,
        temperature: opts.temperature ?? 0,
        system: systemFor(inputs),
        messages: [
          { role: 'user', content: buildUserPayload(inputs) },
          // Prefilling the assistant turn with '[' forces the response to
          // start as a JSON array — no preamble to strip.
          { role: 'assistant', content: '[' },
        ],
      }),
    });

    if (!res.ok) {
      throw new LLMError(`anthropic ${res.status}: ${await res.text()}`, this.name, classify(res.status), res.status);
    }

    const data = await res.json();
    const body: string = data?.content?.map((c: { text?: string }) => c.text ?? '').join('') ?? '';
    return finish(`[${body}`, inputs, {
      inputTokens: data?.usage?.input_tokens,
      outputTokens: data?.usage?.output_tokens,
    });
  }
}

// ---------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------
export function createProvider(env: NodeJS.ProcessEnv = process.env): LLMProvider {
  const which = (env.LLM_PROVIDER ?? 'gemini').toLowerCase();

  switch (which) {
    case 'gemini': {
      const key = env.GEMINI_API_KEY;
      if (!key) throw new Error('GEMINI_API_KEY is not set');
      return new GeminiProvider(key, env.LLM_MODEL ?? 'gemini-1.5-flash');
    }
    case 'openai': {
      const key = env.OPENAI_API_KEY;
      if (!key) throw new Error('OPENAI_API_KEY is not set');
      return new OpenAIProvider(key, env.LLM_MODEL ?? 'gpt-4o-mini', env.OPENAI_BASE_URL);
    }
    case 'anthropic': {
      const key = env.ANTHROPIC_API_KEY;
      if (!key) throw new Error('ANTHROPIC_API_KEY is not set');
      return new AnthropicProvider(key, env.LLM_MODEL ?? 'claude-haiku-4-5-20251001');
    }
    case 'ollama':
      // Ollama exposes an OpenAI-compatible API; no key needed.
      return new OpenAIProvider('ollama', env.LLM_MODEL ?? 'llama3.1', env.OLLAMA_BASE_URL ?? 'http://localhost:11434/v1');
    default:
      throw new Error(`Unknown LLM_PROVIDER "${which}"`);
  }
}
