import type { DataSource, DocumentRecord, ChangeEvent } from './types';

export class LocalFileConnector implements DataSource {
  readonly id = 'local-fs';

  constructor(private readonly roots: string[]) {}

  async connect(): Promise<void> {
    // TODO(Phase 1): verify paths exist, handle permissions on macOS/Windows.
  }

  async *listDocuments(): AsyncIterable<DocumentRecord> {
    // TODO(Phase 1): walk roots, yield DocumentRecord per supported file.
    void this.roots;
    return;
  }

  async getDocument(_id: string): Promise<DocumentRecord | null> {
    // TODO(Phase 1)
    return null;
  }

  watchChanges(_onEvent: (e: ChangeEvent) => void): () => void {
    // TODO(Phase 1): chokidar watcher, emit add/change/unlink.
    return () => {};
  }
}
