import type { QueryAskRequest, QueryAskResponse } from '@shared/ipc';

export class QueryOrchestrator {
  async ask(_req: QueryAskRequest): Promise<QueryAskResponse> {
    // TODO(Phase 2) — flow:
    // 1. LLM query parser → extract entities/dates/filters (structured JSON).
    // 2. Embedder.embed(query).
    // 3. VectorStore.hybridSearch(topK=50).
    // 4. Reranker.rerank → top-5.
    // 5. Build prompt with citations. Stream synthesis via LlmRouter.
    // 6. Return QueryAskResponse with citations.
    return { answer: '', citations: [] };
  }
}
