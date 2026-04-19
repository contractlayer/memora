import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { LocalFileConnector } from '@main/connectors/local-fs';
import { mimeFromPath, isJunkFile } from '@main/connectors/mime';
import type { ParserRegistry } from '@main/parsers';
import { chunkText } from '@main/chunker/text';
import { chunkCode } from '@main/chunker/code';
import {
  buildLineIndex,
  computeLocation,
  needsLineIndex,
} from '@main/services/chunk-location';
import type { SqliteMetadataStore } from '@main/storage/metadata';
import type { LanceVectorStore } from '@main/services/vector-store';
import { awaitCpuBelow } from '@main/services/cpu-throttle';

export type IndexerEvents = {
  progress: { queued: number; inFlight: number; completedToday: number };
  fileIndexed: { path: string; chunks: number };
  fileFailed: { path: string; error: string };
};

export class IndexerService extends EventEmitter {
  private running = false;
  private completedToday = 0;
  // Per-source connectors, keyed by sourceId, so we can read files through them.
  private readonly connectors = new Map<string, LocalFileConnector>();

  constructor(
    private readonly store: SqliteMetadataStore,
    private readonly parsers: ParserRegistry,
    private readonly vectors: LanceVectorStore,
  ) {
    super();
  }

  registerConnector(connector: LocalFileConnector): void {
    this.connectors.set(connector.sourceId, connector);
  }

  async enqueueScan(connector: LocalFileConnector): Promise<number> {
    this.registerConnector(connector);
    let count = 0;
    for await (const doc of connector.listDocuments()) {
      this.store.enqueueJob({
        id: randomUUID(),
        kind: 'parse',
        path: doc.path,
        sourceId: connector.sourceId,
        priority: 0,
        createdAt: new Date().toISOString(),
      });
      count++;
    }
    this.emitProgress();
    return count;
  }

  enqueueChange(sourceId: string, path: string, kind: 'parse' | 'delete'): void {
    this.store.enqueueJob({
      id: randomUUID(),
      kind,
      path,
      sourceId,
      priority: kind === 'delete' ? 10 : 1, // deletes + edits jump the queue
      createdAt: new Date().toISOString(),
    });
    this.emitProgress();
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    void this.loop();
  }

  async stop(): Promise<void> {
    this.running = false;
  }

  private async loop(): Promise<void> {
    while (this.running) {
      const job = this.store.nextJob();
      if (!job) {
        await sleep(500);
        continue;
      }
      // Back off when the system is under load so indexing doesn't spin
      // the fan while the user is working.
      await awaitCpuBelow(0.7, 'indexer');
      // Log every file we process so that if Electron dies mid-job the log
      // tells us exactly which file was in flight.
      console.log(`[indexer] ${job.kind} ${job.path}`);
      try {
        if (job.kind === 'parse') {
          await this.processParseJob(job.path, job.sourceId);
        } else if (job.kind === 'delete') {
          await this.processDeleteJob(job.path, job.sourceId);
        }
        this.store.completeJob(job.id);
        this.completedToday++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[indexer] job failed: ${job.path}`, err);
        this.store.failJob(job.id, msg);
        this.emit('fileFailed', { path: job.path, error: msg });
      }
      this.emitProgress();
    }
  }

  private async processParseJob(path: string, sourceId: string | null): Promise<void> {
    if (!sourceId) throw new Error(`Missing source for job: ${path}`);
    const connector = this.connectors.get(sourceId);
    if (!connector) throw new Error(`Connector not registered: ${sourceId}`);

    // Silently skip OS metadata junk (._*, .DS_Store, Thumbs.db, ...).
    // These can land in the queue from old scans or from being caught by
    // a watcher before the mime filter applied.
    if (isJunkFile(path)) return;

    const mime = mimeFromPath(path);
    if (!mime) throw new Error(`Unsupported file type: ${path}`);

    const { sha256, size, mtime } = await connector.readFile(path);

    const existing = this.store.getFileByPath(sourceId, path);
    if (existing && existing.sha256 === sha256 && existing.indexedAt) {
      // Unchanged. Skip re-parse.
      return;
    }

    const fileId = existing?.id ?? randomUUID();
    this.store.upsertFile({
      id: fileId,
      sourceId,
      path,
      mime,
      size,
      mtime: mtime.toISOString(),
      sha256,
      indexedAt: null, // cleared; set after chunks written
    });

    const parser = this.parsers.resolve(path);
    if (!parser) {
      // Known MIME but no parser registered. Mark indexed so we don't requeue.
      this.store.upsertFile({
        id: fileId,
        sourceId,
        path,
        mime,
        size,
        mtime: mtime.toISOString(),
        sha256,
        indexedAt: new Date().toISOString(),
      });
      this.emit('fileIndexed', { path, chunks: 0 });
      return;
    }

    const parsed = await parser.parse(path);
    const idPrefix = fileId.slice(0, 8);
    // Route code files through symbol-aware chunker so each function/class
    // becomes its own chunk. Everything else uses the recursive text splitter.
    const language =
      mime === 'text/x-source' ? String(parsed.metadata['language'] ?? '') : '';
    const chunks =
      mime === 'text/x-source' && language
        ? chunkCode({ text: parsed.text, language, idPrefix })
        : chunkText({ text: parsed.text, options: { idPrefix } });

    // Vector rows for previous version of this file (if any) are stale — purge.
    // The actual embed happens asynchronously via EmbedWorker, which picks up
    // chunks with vector_indexed_at IS NULL.
    await this.vectors.deleteByFileId(fileId);

    const lineIndex = needsLineIndex(mime) ? buildLineIndex(parsed.text) : undefined;

    this.store.replaceChunksForFile(
      fileId,
      chunks.map((c, i) => {
        const symbols = (c.metadata as { symbols?: string[] }).symbols;
        const location = computeLocation({
          mime,
          byteStart: c.byteStart,
          byteEnd: c.byteEnd,
          pages: parsed.pages,
          lineIndex,
          symbol: symbols?.[0],
        });
        return {
          id: c.id,
          ordinal: i,
          text: c.text,
          tokenCount: c.tokenCount,
          byteStart: c.byteStart,
          byteEnd: c.byteEnd,
          sha256: c.sha256,
          simhash: null,
          metadata: JSON.stringify({
            ...c.metadata,
            parser: parsed.metadata,
            location,
          }),
        };
      }),
    );

    this.store.upsertFile({
      id: fileId,
      sourceId,
      path,
      mime,
      size,
      mtime: mtime.toISOString(),
      sha256,
      indexedAt: new Date().toISOString(),
    });
    this.emit('fileIndexed', { path, chunks: chunks.length });
  }

  private async processDeleteJob(path: string, sourceId: string | null): Promise<void> {
    if (!sourceId) return;
    const existing = this.store.getFileByPath(sourceId, path);
    if (!existing) return;
    await this.vectors.deleteByFileId(existing.id);
    this.store.deleteFile(existing.id);
  }

  private emitProgress(): void {
    const { queued, inFlight } = this.store.queueStats();
    this.emit('progress', { queued, inFlight, completedToday: this.completedToday });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
