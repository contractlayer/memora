export type VectorRecord = {
  id: string;
  vector: Float32Array;
  text: string;
  metadata: Record<string, unknown>;
};

export type HybridSearchQuery = {
  text: string;
  vector: Float32Array;
  topK?: number;
  filter?: Record<string, unknown>;
};

export type SearchHit = {
  id: string;
  score: number;
  text: string;
  metadata: Record<string, unknown>;
};

export interface VectorStore {
  upsert(records: VectorRecord[]): Promise<void>;
  delete(ids: string[]): Promise<void>;
  hybridSearch(query: HybridSearchQuery): Promise<SearchHit[]>;
}

export class LanceDbStore implements VectorStore {
  async upsert(_records: VectorRecord[]): Promise<void> {
    // TODO(Phase 1): @lancedb/lancedb connect + merge upsert.
  }
  async delete(_ids: string[]): Promise<void> {
    // TODO(Phase 1)
  }
  async hybridSearch(_query: HybridSearchQuery): Promise<SearchHit[]> {
    // TODO(Phase 1): LanceDB native hybrid (BM25 + vector + RRF fusion).
    return [];
  }
}
