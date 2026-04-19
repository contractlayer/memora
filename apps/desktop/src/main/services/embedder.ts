export interface Embedder {
  readonly modelName: string;
  readonly dimensions: number;
  embed(texts: string[]): Promise<Float32Array[]>;
}

export class BgeM3Embedder implements Embedder {
  readonly modelName = 'BAAI/bge-m3';
  readonly dimensions = 1024;

  async embed(_texts: string[]): Promise<Float32Array[]> {
    // TODO(Phase 1): onnxruntime-node session loading BGE-M3 ONNX weights,
    // batched inference in worker thread pool (max 2 threads, CPU throttle).
    return [];
  }
}
