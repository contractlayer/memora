export type RerankCandidate = {
  chunkId: string;
  text: string;
};

export interface Reranker {
  rerank(query: string, candidates: RerankCandidate[]): Promise<{ chunkId: string; score: number }[]>;
}

export class BgeReranker implements Reranker {
  async rerank(_query: string, _candidates: RerankCandidate[]): Promise<
    { chunkId: string; score: number }[]
  > {
    // TODO(Phase 2): BGE reranker base via onnxruntime-node. Expect top-50 in, top-5 out.
    return [];
  }
}
