import { app } from 'electron';
import { join } from 'node:path';

// Default multilingual model — ~100MB, handles English + Vietnamese well.
// Can be swapped for `Xenova/bge-m3` (~570MB, higher quality) via settings later.
export const DEFAULT_EMBEDDING_MODEL = 'Xenova/multilingual-e5-small';
export const DEFAULT_EMBEDDING_DIMS = 384;

// multilingual-e5 expects "query: ..." / "passage: ..." prefixes on inputs for
// best retrieval quality. See https://huggingface.co/intfloat/multilingual-e5-small
const QUERY_PREFIX = 'query: ';
const PASSAGE_PREFIX = 'passage: ';

type FeatureExtractionPipeline = {
  (
    text: string | string[],
    opts?: {
      pooling?: 'mean' | 'cls';
      normalize?: boolean;
      truncation?: boolean;
      max_length?: number;
    },
  ): Promise<{
    data: Float32Array;
    dims: number[];
  }>;
};

// E5 model context limit. Passing longer inputs without truncation can crash
// onnxruntime on some builds (SIGTRAP). We explicitly truncate.
const MAX_INPUT_TOKENS = 512;
// Heuristic: E5's SentencePiece tokenizer averages ~4 chars/token on mixed
// English + code. Chunks above this length almost certainly get truncated at
// 512 tokens, which silently drops context. Warn so we can tighten the
// chunker rather than shipping degraded embeddings.
const TRUNCATION_WARN_CHARS = MAX_INPUT_TOKENS * 4;

export interface Embedder {
  readonly modelName: string;
  readonly dimensions: number;
  load(): Promise<void>;
  embedPassages(texts: string[]): Promise<Float32Array[]>;
  embedQuery(text: string): Promise<Float32Array>;
  isReady(): boolean;
}

export class TransformersEmbedder implements Embedder {
  readonly modelName: string;
  readonly dimensions: number;
  private extractor: FeatureExtractionPipeline | null = null;
  private loadPromise: Promise<void> | null = null;

  constructor(
    modelName: string = DEFAULT_EMBEDDING_MODEL,
    dimensions: number = DEFAULT_EMBEDDING_DIMS,
  ) {
    this.modelName = modelName;
    this.dimensions = dimensions;
  }

  isReady(): boolean {
    return this.extractor !== null;
  }

  async load(): Promise<void> {
    if (this.extractor) return;
    if (this.loadPromise) return this.loadPromise;

    this.loadPromise = (async () => {
      // Lazy-import so the heavy ESM package doesn't pay load cost until needed.
      const { pipeline, env } = await import('@huggingface/transformers');

      // Cache models under the app's userData dir so they survive app upgrades
      // but are easy for the user to locate and delete.
      const cacheDir = join(app.getPath('userData'), 'models');
      env.cacheDir = cacheDir;
      env.allowLocalModels = true;
      env.allowRemoteModels = true;

      const extractor = (await pipeline('feature-extraction', this.modelName, {
        dtype: 'q8',
      })) as unknown as FeatureExtractionPipeline;
      this.extractor = extractor;
    })();

    return this.loadPromise;
  }

  async embedPassages(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return [];
    await this.load();
    const extractor = this.extractor!;
    for (const t of texts) {
      if (t.length > TRUNCATION_WARN_CHARS) {
        console.warn(
          `[embedder] passage length ${t.length} chars likely truncated at ${MAX_INPUT_TOKENS} tokens`,
        );
      }
    }
    const prefixed = texts.map((t) => PASSAGE_PREFIX + t);
    const output = await extractor(prefixed, {
      pooling: 'mean',
      normalize: true,
      truncation: true,
      max_length: MAX_INPUT_TOKENS,
    });
    return unstackVectors(output.data, output.dims);
  }

  async embedQuery(text: string): Promise<Float32Array> {
    await this.load();
    const extractor = this.extractor!;
    const output = await extractor(QUERY_PREFIX + text, {
      pooling: 'mean',
      normalize: true,
      truncation: true,
      max_length: MAX_INPUT_TOKENS,
    });
    // Single-input returns a 2D [1, dims] tensor — take the first row.
    return unstackVectors(output.data, output.dims)[0]!;
  }
}

// Transformers.js returns a flat Float32Array with dims like [batch, dim].
// Split it into one vector per input.
function unstackVectors(data: Float32Array, dims: number[]): Float32Array[] {
  const dim = dims[dims.length - 1]!;
  const batch = dims.length > 1 ? dims[0]! : 1;
  const result: Float32Array[] = [];
  for (let i = 0; i < batch; i++) {
    result.push(data.slice(i * dim, (i + 1) * dim));
  }
  return result;
}
