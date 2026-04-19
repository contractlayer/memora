import Database, { type Database as Db } from 'better-sqlite3';
import { SCHEMA_SQL } from './schema';

export type SourceRow = {
  id: string;
  kind: string;
  path: string;
  addedAt: string;
  lastScan: string | null;
};

export type FileRow = {
  id: string;
  sourceId: string;
  path: string;
  mime: string;
  size: number;
  mtime: string;
  sha256: string;
  indexedAt: string | null;
};

export type ChunkRow = {
  id: string;
  fileId: string;
  ordinal: number;
  text: string;
  tokenCount: number;
  byteStart: number;
  byteEnd: number;
  sha256: string;
  simhash: bigint | null;
  metadata: string | null;
};

export type SearchHitRow = {
  chunkId: string;
  fileId: string;
  text: string;
  ordinal: number;
  byteStart: number;
  byteEnd: number;
  metadata: string | null;
  path: string;
  mime: string;
  bm25: number;
};

export type JobRow = {
  id: string;
  kind: 'parse' | 'reindex' | 'delete';
  path: string;
  sourceId: string | null;
  priority: number;
  status: 'queued' | 'in_flight' | 'done' | 'failed';
  retries: number;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

export class SqliteMetadataStore {
  private db: Db | null = null;

  init(dbPath: string): void {
    this.db = new Database(dbPath);
    this.db.exec(SCHEMA_SQL);
    this.db.prepare('INSERT OR IGNORE INTO schema_version (version) VALUES (1)').run();
    this.migrate();
    this.purgeJunkFiles();
    this.backfillFtsIfEmpty();
    const orphaned = this.purgeOrphanJobs();
    if (orphaned > 0) {
      console.log(`[metadata] purged ${orphaned} orphan job(s) from removed sources`);
    }
  }

  // Remove files accidentally indexed before OS-metadata filters landed
  // (macOS ._* AppleDouble, .DS_Store, Windows Thumbs.db / desktop.ini).
  // chunks cascade via FK; FTS rows purge alongside.
  private purgeJunkFiles(): void {
    const db = this.must();
    const patterns = [
      "path LIKE '%/._%'",
      "path LIKE '%/.DS_Store'",
      "path LIKE '%/Thumbs.db'",
      "path LIKE '%/desktop.ini'",
      "path LIKE '%/.localized'",
    ];
    const toDelete = db
      .prepare<[], { id: string }>(
        `SELECT id FROM files WHERE ${patterns.join(' OR ')}`,
      )
      .all();
    if (toDelete.length === 0) return;
    const tx = db.transaction(() => {
      const deleteFts = db.prepare('DELETE FROM chunks_fts WHERE file_id = ?');
      const deleteFile = db.prepare('DELETE FROM files WHERE id = ?');
      for (const { id } of toDelete) {
        deleteFts.run(id);
        deleteFile.run(id);
      }
    });
    tx();
    console.log(`[metadata] purged ${toDelete.length} junk file row(s)`);
  }

  // Hand-rolled migrations for columns added after initial release.
  // Runs after SCHEMA_SQL so it can rely on base tables existing.
  private migrate(): void {
    const db = this.must();
    const cols = db
      .prepare<[], { name: string }>("PRAGMA table_info('chunks')")
      .all();
    const names = new Set(cols.map((c) => c.name));
    if (!names.has('vector_indexed_at')) {
      db.exec('ALTER TABLE chunks ADD COLUMN vector_indexed_at TEXT');
    }
    db.exec(
      'CREATE INDEX IF NOT EXISTS chunks_vec_pending_idx ON chunks(vector_indexed_at) WHERE vector_indexed_at IS NULL',
    );
  }

  // Populates chunks_fts from chunks when the FTS table is empty but chunks exist.
  // Handles the case where a database was created before the FTS5 index was added.
  private backfillFtsIfEmpty(): void {
    const db = this.must();
    const ftsCount = db.prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM chunks_fts').get();
    const chunkCount = db.prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM chunks').get();
    if ((ftsCount?.n ?? 0) > 0 || (chunkCount?.n ?? 0) === 0) return;

    // Load all chunks up-front: better-sqlite3 does not allow another
    // statement on the same connection while an iterator is open.
    const rows = db
      .prepare<[], { id: string; fileId: string; text: string }>(
        `SELECT id, file_id AS fileId, text FROM chunks`,
      )
      .all();
    const insert = db.prepare(
      `INSERT INTO chunks_fts (text, file_id, chunk_id) VALUES (?, ?, ?)`,
    );
    const tx = db.transaction(() => {
      for (const row of rows) insert.run(row.text, row.fileId, row.id);
    });
    tx();
  }

  close(): void {
    this.db?.close();
    this.db = null;
  }

  private must(): Db {
    if (!this.db) throw new Error('MetadataStore not initialized');
    return this.db;
  }

  // ---------- sources ----------

  upsertSource(row: SourceRow): void {
    this.must()
      .prepare(
        `INSERT INTO sources (id, kind, path, added_at, last_scan)
         VALUES (@id, @kind, @path, @addedAt, @lastScan)
         ON CONFLICT(path) DO UPDATE SET kind = excluded.kind, last_scan = excluded.last_scan`,
      )
      .run(row);
  }

  listSources(): SourceRow[] {
    return this.must()
      .prepare<[], SourceRow>(
        `SELECT id, kind, path, added_at AS addedAt, last_scan AS lastScan FROM sources ORDER BY added_at`,
      )
      .all();
  }

  deleteSource(id: string): void {
    const db = this.must();
    const tx = db.transaction((sourceId: string) => {
      // FTS is a virtual table so the files-cascade doesn't fire on it.
      // Delete FTS rows first, then let the FK cascade handle files+chunks.
      db.prepare(
        `DELETE FROM chunks_fts WHERE file_id IN (SELECT id FROM files WHERE source_id = ?)`,
      ).run(sourceId);
      // jobs has no FK to sources — wipe them manually so queued work for a
      // deleted source doesn't drain as "Connector not registered" failures.
      db.prepare('DELETE FROM jobs WHERE source_id = ?').run(sourceId);
      db.prepare('DELETE FROM sources WHERE id = ?').run(sourceId);
    });
    tx(id);
  }

  /**
   * Remove jobs whose source_id no longer references a live source row.
   * Handles legacy rows from before deleteSource cleaned up jobs itself.
   * Called once at startup.
   */
  purgeOrphanJobs(): number {
    const db = this.must();
    const result = db
      .prepare(
        `DELETE FROM jobs
         WHERE source_id IS NOT NULL
           AND source_id NOT IN (SELECT id FROM sources)`,
      )
      .run();
    return result.changes;
  }

  listFilesForSource(sourceId: string): FileRow[] {
    return this.must()
      .prepare<[string], FileRow>(
        `SELECT id, source_id AS sourceId, path, mime, size, mtime, sha256, indexed_at AS indexedAt
         FROM files WHERE source_id = ?`,
      )
      .all(sourceId);
  }

  // ---------- files ----------

  upsertFile(row: FileRow): void {
    this.must()
      .prepare(
        `INSERT INTO files (id, source_id, path, mime, size, mtime, sha256, indexed_at)
         VALUES (@id, @sourceId, @path, @mime, @size, @mtime, @sha256, @indexedAt)
         ON CONFLICT(source_id, path) DO UPDATE SET
           mime = excluded.mime,
           size = excluded.size,
           mtime = excluded.mtime,
           sha256 = excluded.sha256,
           indexed_at = excluded.indexed_at`,
      )
      .run(row);
  }

  getFileByPath(sourceId: string, path: string): FileRow | null {
    const row = this.must()
      .prepare<[string, string], FileRow>(
        `SELECT id, source_id AS sourceId, path, mime, size, mtime, sha256, indexed_at AS indexedAt
         FROM files WHERE source_id = ? AND path = ?`,
      )
      .get(sourceId, path);
    return row ?? null;
  }

  deleteFile(id: string): void {
    const db = this.must();
    const tx = db.transaction((fileId: string) => {
      db.prepare('DELETE FROM chunks_fts WHERE file_id = ?').run(fileId);
      db.prepare('DELETE FROM files WHERE id = ?').run(fileId);
      // chunks rows cascade via FK ON DELETE CASCADE
    });
    tx(id);
  }

  countFilesForSource(sourceId: string): { total: number; indexed: number } {
    const row = this.must()
      .prepare<[string], { total: number; indexed: number }>(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN indexed_at IS NOT NULL THEN 1 ELSE 0 END) AS indexed
         FROM files WHERE source_id = ?`,
      )
      .get(sourceId) ?? { total: 0, indexed: 0 };
    return { total: row.total ?? 0, indexed: row.indexed ?? 0 };
  }

  // ---------- chunks ----------

  replaceChunksForFile(fileId: string, chunks: Omit<ChunkRow, 'fileId'>[]): void {
    const db = this.must();
    const deleteStmt = db.prepare('DELETE FROM chunks WHERE file_id = ?');
    const deleteFtsStmt = db.prepare('DELETE FROM chunks_fts WHERE file_id = ?');
    const insertStmt = db.prepare(
      `INSERT INTO chunks (id, file_id, ordinal, text, token_count, byte_start, byte_end, sha256, simhash, metadata)
       VALUES (@id, @fileId, @ordinal, @text, @tokenCount, @byteStart, @byteEnd, @sha256, @simhash, @metadata)`,
    );
    const insertFtsStmt = db.prepare(
      `INSERT INTO chunks_fts (text, file_id, chunk_id) VALUES (?, ?, ?)`,
    );
    const tx = db.transaction((rows: ChunkRow[]) => {
      deleteStmt.run(fileId);
      deleteFtsStmt.run(fileId);
      for (const r of rows) {
        insertStmt.run(r);
        insertFtsStmt.run(r.text, r.fileId, r.id);
      }
    });
    tx(chunks.map((c) => ({ ...c, fileId })));
  }

  countChunks(): number {
    const row = this.must().prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM chunks').get();
    return row?.n ?? 0;
  }

  countPendingVectorChunks(): number {
    const row = this.must()
      .prepare<[], { n: number }>(
        'SELECT COUNT(*) AS n FROM chunks WHERE vector_indexed_at IS NULL',
      )
      .get();
    return row?.n ?? 0;
  }

  nextChunksToEmbed(limit: number): { id: string; fileId: string; ordinal: number; text: string }[] {
    return this.must()
      .prepare<[number], { id: string; fileId: string; ordinal: number; text: string }>(
        `SELECT id, file_id AS fileId, ordinal, text
         FROM chunks
         WHERE vector_indexed_at IS NULL
         ORDER BY rowid
         LIMIT ?`,
      )
      .all(limit);
  }

  markChunksVectorized(chunkIds: string[]): void {
    if (chunkIds.length === 0) return;
    const db = this.must();
    const now = new Date().toISOString();
    const stmt = db.prepare('UPDATE chunks SET vector_indexed_at = ? WHERE id = ?');
    const tx = db.transaction((ids: string[]) => {
      for (const id of ids) stmt.run(now, id);
    });
    tx(chunkIds);
  }

  getChunkMeta(
    chunkIds: string[],
  ): Map<string, { path: string; sourceId: string; metadata: string | null }> {
    if (chunkIds.length === 0) return new Map();
    const db = this.must();
    const placeholders = chunkIds.map(() => '?').join(',');
    const rows = db
      .prepare<
        string[],
        { chunkId: string; path: string; sourceId: string; metadata: string | null }
      >(
        `SELECT c.id AS chunkId, f.path AS path, f.source_id AS sourceId, c.metadata AS metadata
         FROM chunks c
         JOIN files f ON f.id = c.file_id
         WHERE c.id IN (${placeholders})`,
      )
      .all(...chunkIds);
    const out = new Map<string, { path: string; sourceId: string; metadata: string | null }>();
    for (const row of rows)
      out.set(row.chunkId, {
        path: row.path,
        sourceId: row.sourceId,
        metadata: row.metadata,
      });
    return out;
  }

  searchFts(query: string, limit: number, sourceIds?: string[]): SearchHitRow[] {
    const trimmed = query.trim();
    if (trimmed.length === 0) return [];
    if (sourceIds !== undefined && sourceIds.length === 0) return [];
    // Escape FTS5 special chars by quoting each term. This produces an implicit
    // AND query across terms and avoids syntax errors from user punctuation.
    const ftsQuery = trimmed
      .split(/\s+/)
      .filter((t) => t.length > 0)
      .map((t) => `"${t.replace(/"/g, '""')}"`)
      .join(' ');

    const scopeClause =
      sourceIds && sourceIds.length > 0
        ? `AND f.source_id IN (${sourceIds.map(() => '?').join(',')})`
        : '';
    const params: (string | number)[] = [ftsQuery];
    if (sourceIds) params.push(...sourceIds);
    params.push(limit);

    return this.must()
      .prepare<(string | number)[], SearchHitRow>(
        `SELECT c.id AS chunkId, c.file_id AS fileId, c.text, c.ordinal, c.byte_start AS byteStart,
                c.byte_end AS byteEnd, c.metadata,
                f.path, f.mime,
                bm25(chunks_fts) AS bm25
         FROM chunks_fts
         JOIN chunks c ON c.id = chunks_fts.chunk_id
         JOIN files  f ON f.id = c.file_id
         WHERE chunks_fts MATCH ? ${scopeClause}
         ORDER BY bm25
         LIMIT ?`,
      )
      .all(...params);
  }

  // ---------- jobs ----------

  enqueueJob(row: Omit<JobRow, 'retries' | 'status' | 'error' | 'updatedAt'>): void {
    this.must()
      .prepare(
        `INSERT INTO jobs (id, kind, path, source_id, priority, status, retries, error, created_at, updated_at)
         VALUES (@id, @kind, @path, @sourceId, @priority, 'queued', 0, NULL, @createdAt, @createdAt)`,
      )
      .run(row);
  }

  nextJob(): JobRow | null {
    const db = this.must();
    const now = new Date().toISOString();
    const row = db
      .prepare<[], JobRow>(
        `SELECT id, kind, path, source_id AS sourceId, priority, status, retries, error,
                created_at AS createdAt, updated_at AS updatedAt
         FROM jobs
         WHERE status = 'queued'
         ORDER BY priority DESC, created_at ASC
         LIMIT 1`,
      )
      .get();
    if (!row) return null;
    db.prepare(
      `UPDATE jobs SET status = 'in_flight', updated_at = ? WHERE id = ? AND status = 'queued'`,
    ).run(now, row.id);
    return row;
  }

  completeJob(id: string): void {
    const now = new Date().toISOString();
    this.must()
      .prepare(`UPDATE jobs SET status = 'done', updated_at = ? WHERE id = ?`)
      .run(now, id);
  }

  failJob(id: string, error: string): void {
    const now = new Date().toISOString();
    this.must()
      .prepare(
        `UPDATE jobs SET status = 'failed', retries = retries + 1, error = ?, updated_at = ? WHERE id = ?`,
      )
      .run(error, now, id);
  }

  queueStats(): { queued: number; inFlight: number } {
    const db = this.must();
    const queued = db
      .prepare<[], { n: number }>(`SELECT COUNT(*) AS n FROM jobs WHERE status = 'queued'`)
      .get();
    const inFlight = db
      .prepare<[], { n: number }>(`SELECT COUNT(*) AS n FROM jobs WHERE status = 'in_flight'`)
      .get();
    return { queued: queued?.n ?? 0, inFlight: inFlight?.n ?? 0 };
  }
}
