import { EventEmitter } from 'node:events';
import type { SqliteMetadataStore } from '@main/storage/metadata';
import type { Embedder } from '@main/services/embedder';
import type { LanceVectorStore } from '@main/services/vector-store';
import { awaitCpuBelow } from '@main/services/cpu-throttle';

export type EmbedWorkerEvents = {
  batchEmbedded: { count: number; remaining: number };
  error: { error: string };
};

// Batches larger than 1 SIGTRAP onnxruntime-node on Apple Silicon with
// multilingual-e5-small q8 after the first batch. Until we either swap the
// model/runtime or isolate embedding in a worker, stay at 1. Slower but stable.
const BATCH_SIZE = 1;
const IDLE_SLEEP_MS = 1000;

// Background worker that pulls chunks missing vectors from SQLite,
// embeds them, upserts to LanceDB, then marks them vectorized. Runs
// decoupled from the main indexer so the BM25 index can fill fast
// and semantic vectors catch up behind it without blocking.
export class EmbedWorker extends EventEmitter {
  private running = false;
  private loopPromise: Promise<void> | null = null;

  constructor(
    private readonly store: SqliteMetadataStore,
    private readonly embedder: Embedder,
    private readonly vectors: LanceVectorStore,
  ) {
    super();
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.loopPromise = this.loop();
  }

  async stop(): Promise<void> {
    this.running = false;
    await this.loopPromise;
  }

  private async loop(): Promise<void> {
    console.log('[embedWorker] loop started');
    let iter = 0;
    while (this.running) {
      iter++;
      if (iter <= 3 || iter % 10 === 0) {
        console.log(`[embedWorker] iter ${iter}`);
      }
      const pending = this.store.nextChunksToEmbed(BATCH_SIZE);
      if (pending.length === 0) {
        await sleep(IDLE_SLEEP_MS);
        continue;
      }
      // Back off when the system is under load. Embedding is CPU-intensive
      // (ONNX on CPU) so this actually matters for user UX.
      await awaitCpuBelow(0.7, 'embed');
      console.log(
        `[embedWorker] embedding ${pending[0]!.id} (${pending[0]!.text.length} chars)`,
      );

      try {
        const vectors = await this.embedder.embedPassages(pending.map((c) => c.text));
        console.log(`[embedWorker] got ${vectors.length} vectors, upserting`);
        await this.vectors.upsert(
          pending.map((c, i) => ({
            id: c.id,
            fileId: c.fileId,
            ordinal: c.ordinal,
            text: c.text,
            vector: vectors[i]!,
          })),
        );
        console.log(`[embedWorker] upserted ${pending.length}`);
        this.store.markChunksVectorized(pending.map((c) => c.id));
        const remaining = this.store.countPendingVectorChunks();
        this.emit('batchEmbedded', { count: pending.length, remaining });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[embedWorker] batch failed:', err);
        this.emit('error', { error: msg });
        await sleep(5000);
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
