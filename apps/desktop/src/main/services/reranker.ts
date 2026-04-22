import { app } from 'electron';
import { join } from 'node:path';

// Cross-encoder reranker — scores (query, passage) pairs directly instead of
// comparing embeddings. Much stronger than bi-encoder similarity for the final
// top-N slot, at the cost of running the model per-candidate.
//
// bge-reranker-v2-m3 is a multilingual XLM-RoBERTa reranker (100+ languages
// including Vietnamese). Picked over MS-MARCO MiniLM because cross-lingual
// queries (e.g., VN question against EN docs) were getting mis-ranked: the
// multilingual embedder retrieved the right chunks, but an English-only
// reranker then scored them low and dropped them from the final top-K.
//
// Cost: ~570MB q8 download on first launch (vs ~30MB for MiniLM), and
// ~150ms per candidate on M1 (vs ~10ms). Rerank over 20 candidates is ~3s
// on cold cache, ~1.5s hot. Acceptable for search; falls back to RRF-only
// if the model fails to load.
export const DEFAULT_RERANKER_MODEL = 'Xenova/bge-reranker-v2-m3';

export type RerankCandidate = {
  chunkId: string;
  text: string;
};

export type RerankResult = {
  chunkId: string;
  score: number;
};

export interface Reranker {
  readonly modelName: string;
  load(): Promise<void>;
  rerank(query: string, candidates: RerankCandidate[]): Promise<RerankResult[]>;
  isReady(): boolean;
}

type TextClassificationPipeline = (
  inputs: { text: string; text_pair: string } | { text: string; text_pair: string }[],
  opts?: { truncation?: boolean; max_length?: number },
) => Promise<{ label: string; score: number }[] | { label: string; score: number }>;

const MAX_INPUT_TOKENS = 512;

export class TransformersReranker implements Reranker {
  readonly modelName: string;
  private classifier: TextClassificationPipeline | null = null;
  private loadPromise: Promise<void> | null = null;
  private loadFailed = false;

  constructor(modelName: string = DEFAULT_RERANKER_MODEL) {
    this.modelName = modelName;
  }

  isReady(): boolean {
    return this.classifier !== null;
  }

  async load(): Promise<void> {
    if (this.classifier) return;
    if (this.loadFailed) throw new Error('reranker previously failed to load');
    if (this.loadPromise) return this.loadPromise;

    this.loadPromise = (async () => {
      try {
        const { pipeline, env } = await import('@huggingface/transformers');
        const cacheDir = join(app.getPath('userData'), 'models');
        env.cacheDir = cacheDir;
        env.allowLocalModels = true;
        env.allowRemoteModels = true;

        const classifier = (await pipeline('text-classification', this.modelName, {
          dtype: 'q8',
        })) as unknown as TextClassificationPipeline;
        this.classifier = classifier;
        console.log(`[reranker] loaded ${this.modelName}`);
      } catch (err) {
        this.loadFailed = true;
        console.error('[reranker] load failed:', err);
        throw err;
      }
    })();

    return this.loadPromise;
  }

  async rerank(query: string, candidates: RerankCandidate[]): Promise<RerankResult[]> {
    if (candidates.length === 0) return [];
    await this.load();
    const classifier = this.classifier!;

    // Run sequentially — batch inference on onnxruntime-node has triggered
    // SIGTRAP on Apple Silicon in this codebase before. Cost: ~10ms/candidate
    // on M1 for MiniLM-L-6, so 20 candidates ≈ 200ms total.
    const results: RerankResult[] = [];
    for (const c of candidates) {
      const out = await classifier(
        { text: query, text_pair: c.text },
        { truncation: true, max_length: MAX_INPUT_TOKENS },
      );
      const first = Array.isArray(out) ? out[0]! : out;
      results.push({ chunkId: c.chunkId, score: first.score });
    }

    return results.sort((a, b) => b.score - a.score);
  }
}
