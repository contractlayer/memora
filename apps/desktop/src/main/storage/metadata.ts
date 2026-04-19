export interface MetadataStore {
  init(): Promise<void>;
  close(): Promise<void>;
}

export class SqliteMetadataStore implements MetadataStore {
  async init(): Promise<void> {
    // TODO(Phase 1): open better-sqlite3 database at app.getPath('userData').
    // Encrypted via OS keychain key. Schema: files, chunks, jobs, sources tables.
  }
  async close(): Promise<void> {
    // TODO(Phase 1)
  }
}
