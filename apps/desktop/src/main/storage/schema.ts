// Inlined SQL schema. Kept in sync with storage/schema.sql. Inlining avoids
// bundling/path resolution issues when Electron packages the main process.

export const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA synchronous = NORMAL;

CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS sources (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL,
  path        TEXT NOT NULL UNIQUE,
  added_at    TEXT NOT NULL,
  last_scan   TEXT
);

CREATE TABLE IF NOT EXISTS files (
  id          TEXT PRIMARY KEY,
  source_id   TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  path        TEXT NOT NULL,
  mime        TEXT NOT NULL,
  size        INTEGER NOT NULL,
  mtime       TEXT NOT NULL,
  sha256      TEXT NOT NULL,
  indexed_at  TEXT,
  UNIQUE (source_id, path)
);

CREATE INDEX IF NOT EXISTS files_sha_idx ON files(sha256);
CREATE INDEX IF NOT EXISTS files_indexed_idx ON files(indexed_at);

CREATE TABLE IF NOT EXISTS chunks (
  id                 TEXT PRIMARY KEY,
  file_id            TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  ordinal            INTEGER NOT NULL,
  text               TEXT NOT NULL,
  token_count        INTEGER NOT NULL,
  byte_start         INTEGER NOT NULL,
  byte_end           INTEGER NOT NULL,
  sha256             TEXT NOT NULL,
  simhash            INTEGER,
  metadata           TEXT,
  vector_indexed_at  TEXT
);

CREATE INDEX IF NOT EXISTS chunks_file_idx ON chunks(file_id);
CREATE INDEX IF NOT EXISTS chunks_sha_idx ON chunks(sha256);
-- chunks_vec_pending_idx is created in MetadataStore.migrate() after ensuring
-- the vector_indexed_at column exists on older databases.

-- FTS5 index for BM25 keyword search over chunk text.
-- tokenize: unicode61 strips Vietnamese diacritics so "cà phê" matches "ca phe".
-- Contentless (content='') — we maintain it in lockstep with chunks via code.
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  text,
  file_id UNINDEXED,
  chunk_id UNINDEXED,
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TABLE IF NOT EXISTS jobs (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL,
  path        TEXT NOT NULL,
  source_id   TEXT,
  priority    INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'queued',
  retries     INTEGER NOT NULL DEFAULT 0,
  error       TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS jobs_status_idx ON jobs(status, priority DESC, created_at);
`;
