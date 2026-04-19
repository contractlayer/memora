import type { LlmProvider, LlmSettings, SettingsStore } from './settings';

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export type ChatOpts = { temperature?: number; maxTokens?: number };

export interface LlmClient {
  readonly name: LlmProvider;
  readonly model: string;
  chat(messages: ChatMessage[], opts?: ChatOpts): Promise<string>;
  /**
   * Stream tokens as they arrive. Yields text deltas (not cumulative).
   * The final emitted object (yielded last) indicates whether the response
   * was truncated by a max_tokens / length stop reason.
   */
  chatStream(messages: ChatMessage[], opts?: ChatOpts): AsyncIterable<StreamChunk>;
  test(): Promise<{ ok: true } | { ok: false; error: string }>;
}

export type StreamChunk =
  | { type: 'text'; delta: string }
  | { type: 'done'; truncated: boolean };

export const DEFAULT_MODELS: Record<Exclude<LlmProvider, 'none'>, string> = {
  ollama: 'qwen2.5:7b-instruct',
  openai: 'gpt-4o-mini',
  anthropic: 'claude-haiku-4-5-20251001',
  gemini: 'gemini-2.5-flash',
};

// Known-good preset models we show in the dropdown. User can still type a
// custom model name via the "Custom…" option.
export const KNOWN_MODELS: Record<Exclude<LlmProvider, 'none'>, string[]> = {
  ollama: [
    'qwen2.5:7b-instruct',
    'llama3.1:8b',
    'llama3.2:3b',
    'mistral-nemo',
    'phi4',
  ],
  openai: [
    'gpt-4o-mini',
    'gpt-4o',
    'gpt-4.1',
    'gpt-4.1-mini',
    'o3-mini',
  ],
  anthropic: [
    'claude-haiku-4-5-20251001',
    'claude-sonnet-4-6',
    'claude-opus-4-7',
  ],
  gemini: [
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
    'gemini-2.5-pro',
    'gemini-2.0-flash',
  ],
};

// For Ollama, ask the server which models are actually installed. Falls back
// to the preset list if the server is unreachable.
export async function listOllamaModels(baseUrl: string): Promise<string[]> {
  try {
    const res = await fetch(`${baseUrl}/api/tags`);
    if (!res.ok) return KNOWN_MODELS.ollama;
    const data = (await res.json()) as { models?: { name?: string }[] };
    const names = (data.models ?? []).map((m) => m.name).filter((n): n is string => !!n);
    return names.length > 0 ? names : KNOWN_MODELS.ollama;
  } catch {
    return KNOWN_MODELS.ollama;
  }
}

export class LlmRouter {
  constructor(private readonly settings: SettingsStore) {}

  async resolve(): Promise<LlmClient | null> {
    const s = this.settings.getLlm();
    if (s.provider === 'none') {
      console.log('[llm] provider=none → skipping synthesis, returning top snippet');
      return null;
    }

    const model = s.model || DEFAULT_MODELS[s.provider];

    if (s.provider === 'ollama') {
      console.log(`[llm] using ollama model=${model} base=${s.baseUrl ?? 'default'}`);
      return new OllamaClient(model, s.baseUrl ?? 'http://localhost:11434');
    }

    const key = await this.settings.getApiKey(s.provider);
    if (!key) {
      console.warn(`[llm] provider=${s.provider} but API key missing → fallback`);
      return null;
    }

    console.log(`[llm] using ${s.provider} model=${model}`);
    if (s.provider === 'openai') return new OpenAiClient(model, key, s.baseUrl);
    if (s.provider === 'anthropic') return new AnthropicClient(model, key, s.baseUrl);
    if (s.provider === 'gemini') return new GeminiClient(model, key, s.baseUrl);
    return null;
  }
}

// ---------- Stream helpers ----------

/** Yield newline-delimited chunks from a fetch response body. */
async function* readLines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        if (line.length > 0) yield line;
      }
    }
    if (buffer.length > 0) yield buffer;
  } finally {
    reader.releaseLock();
  }
}

/** Aggregate AsyncIterable<StreamChunk> to a single string — for `chat()` fallback. */
async function collectStream(stream: AsyncIterable<StreamChunk>): Promise<string> {
  let out = '';
  let truncated = false;
  for await (const ch of stream) {
    if (ch.type === 'text') out += ch.delta;
    else if (ch.type === 'done') truncated = ch.truncated;
  }
  if (truncated) {
    return `${out}\n\n*…answer truncated at maxTokens limit — ask a follow-up to continue.*`;
  }
  return out;
}

// ---------- Ollama ----------

class OllamaClient implements LlmClient {
  readonly name = 'ollama' as const;
  constructor(readonly model: string, private readonly baseUrl: string) {}

  async chat(messages: ChatMessage[], opts?: ChatOpts): Promise<string> {
    return collectStream(this.chatStream(messages, opts));
  }

  async *chatStream(
    messages: ChatMessage[],
    opts?: ChatOpts,
  ): AsyncGenerator<StreamChunk> {
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages,
        stream: true,
        options: { temperature: opts?.temperature ?? 0.2 },
      }),
    });
    if (!res.ok || !res.body) {
      throw new Error(`Ollama chat ${res.status}: ${!res.body ? 'no body' : await res.text()}`);
    }
    for await (const line of readLines(res.body)) {
      const evt = JSON.parse(line) as {
        message?: { content?: string };
        done?: boolean;
        done_reason?: string;
      };
      const delta = evt.message?.content;
      if (delta) yield { type: 'text', delta };
      if (evt.done) {
        yield { type: 'done', truncated: evt.done_reason === 'length' };
        return;
      }
    }
    yield { type: 'done', truncated: false };
  }

  async test(): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`);
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }
}

// ---------- OpenAI ----------

class OpenAiClient implements LlmClient {
  readonly name = 'openai' as const;
  private readonly baseUrl: string;
  constructor(readonly model: string, private readonly apiKey: string, baseUrl?: string) {
    this.baseUrl = baseUrl ?? 'https://api.openai.com/v1';
  }

  async chat(messages: ChatMessage[], opts?: ChatOpts): Promise<string> {
    return collectStream(this.chatStream(messages, opts));
  }

  async *chatStream(
    messages: ChatMessage[],
    opts?: ChatOpts,
  ): AsyncGenerator<StreamChunk> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        temperature: opts?.temperature ?? 0.2,
        max_tokens: opts?.maxTokens ?? 1024,
        stream: true,
      }),
    });
    if (!res.ok || !res.body) {
      throw new Error(`OpenAI chat ${res.status}: ${!res.body ? 'no body' : await res.text()}`);
    }
    let truncated = false;
    for await (const line of readLines(res.body)) {
      // SSE lines: "data: {...}" or "data: [DONE]" or blank.
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') break;
      if (payload.length === 0) continue;
      const evt = JSON.parse(payload) as {
        choices?: { delta?: { content?: string }; finish_reason?: string | null }[];
      };
      const choice = evt.choices?.[0];
      const delta = choice?.delta?.content;
      if (delta) yield { type: 'text', delta };
      if (choice?.finish_reason === 'length') truncated = true;
    }
    yield { type: 'done', truncated };
  }

  async test(): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        headers: { authorization: `Bearer ${this.apiKey}` },
      });
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }
}

// ---------- Anthropic ----------

class AnthropicClient implements LlmClient {
  readonly name = 'anthropic' as const;
  private readonly baseUrl: string;
  constructor(readonly model: string, private readonly apiKey: string, baseUrl?: string) {
    this.baseUrl = baseUrl ?? 'https://api.anthropic.com/v1';
  }

  async chat(messages: ChatMessage[], opts?: ChatOpts): Promise<string> {
    return collectStream(this.chatStream(messages, opts));
  }

  async *chatStream(
    messages: ChatMessage[],
    opts?: ChatOpts,
  ): AsyncGenerator<StreamChunk> {
    // Anthropic splits system vs user/assistant messages across two fields.
    const system = messages.find((m) => m.role === 'system')?.content;
    const conversation = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role, content: m.content }));

    const res = await fetch(`${this.baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.model,
        system,
        messages: conversation,
        temperature: opts?.temperature ?? 0.2,
        max_tokens: opts?.maxTokens ?? 1024,
        stream: true,
      }),
    });
    if (!res.ok || !res.body) {
      throw new Error(
        `Anthropic chat ${res.status}: ${!res.body ? 'no body' : await res.text()}`,
      );
    }
    // Anthropic SSE: pairs of `event: <name>` + `data: {...}`. We only care
    // about content_block_delta (text deltas) and message_delta (stop_reason).
    let truncated = false;
    for await (const line of readLines(res.body)) {
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload.length === 0) continue;
      const evt = JSON.parse(payload) as {
        type?: string;
        delta?: { type?: string; text?: string; stop_reason?: string };
      };
      if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
        const delta = evt.delta.text ?? '';
        if (delta) yield { type: 'text', delta };
      } else if (evt.type === 'message_delta' && evt.delta?.stop_reason === 'max_tokens') {
        truncated = true;
      } else if (evt.type === 'message_stop') {
        break;
      }
    }
    yield { type: 'done', truncated };
  }

  async test(): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
      // Anthropic has no cheap list-models endpoint; do a minimal 1-token ping.
      const res = await fetch(`${this.baseUrl}/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 1,
          messages: [{ role: 'user', content: 'hi' }],
        }),
      });
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}: ${await res.text()}` };
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }
}

// ---------- Google Gemini ----------

class GeminiClient implements LlmClient {
  readonly name = 'gemini' as const;
  private readonly baseUrl: string;
  constructor(readonly model: string, private readonly apiKey: string, baseUrl?: string) {
    this.baseUrl = baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta';
  }

  async chat(messages: ChatMessage[], opts?: ChatOpts): Promise<string> {
    return collectStream(this.chatStream(messages, opts));
  }

  async *chatStream(
    messages: ChatMessage[],
    opts?: ChatOpts,
  ): AsyncGenerator<StreamChunk> {
    // Gemini separates systemInstruction from the user/assistant thread.
    // It also uses "model" instead of "assistant" for the role.
    const systemPrompt = messages.find((m) => m.role === 'system')?.content;
    const contents = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));

    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        temperature: opts?.temperature ?? 0.2,
        maxOutputTokens: opts?.maxTokens ?? 1024,
      },
    };
    if (systemPrompt) {
      body['systemInstruction'] = { parts: [{ text: systemPrompt }] };
    }

    // `?alt=sse` makes Gemini return Server-Sent Events instead of a JSON array
    // that you can only read once the response completes.
    const res = await fetch(
      `${this.baseUrl}/models/${encodeURIComponent(this.model)}:streamGenerateContent?alt=sse`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': this.apiKey,
        },
        body: JSON.stringify(body),
      },
    );
    if (!res.ok || !res.body) {
      throw new Error(`Gemini chat ${res.status}: ${!res.body ? 'no body' : await res.text()}`);
    }
    let truncated = false;
    for await (const line of readLines(res.body)) {
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload.length === 0) continue;
      const evt = JSON.parse(payload) as {
        candidates?: {
          content?: { parts?: { text?: string }[] };
          finishReason?: string;
        }[];
      };
      const candidate = evt.candidates?.[0];
      for (const part of candidate?.content?.parts ?? []) {
        if (part.text) yield { type: 'text', delta: part.text };
      }
      if (candidate?.finishReason === 'MAX_TOKENS') truncated = true;
    }
    yield { type: 'done', truncated };
  }

  async test(): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        headers: { 'x-goog-api-key': this.apiKey },
      });
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}: ${await res.text()}` };
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }
}
