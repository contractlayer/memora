export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export interface LlmClient {
  readonly name: string;
  chat(messages: ChatMessage[], opts?: { stream?: boolean }): AsyncIterable<string>;
}

export class LlmRouter {
  async detect(): Promise<LlmClient> {
    // TODO(Phase 2): GET http://localhost:11434/api/tags. If 200, use Ollama.
    // Else fall back to node-llama-cpp loading Qwen2.5-7B-Instruct Q4.
    throw new Error('LlmRouter.detect not implemented');
  }
}
