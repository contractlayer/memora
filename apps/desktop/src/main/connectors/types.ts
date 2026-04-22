export type DocumentRecord = {
  id: string;
  source: string;
  path: string;
  title: string;
  content: string;
  mime: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type ChangeEvent =
  | { type: 'add'; path: string }
  | { type: 'change'; path: string }
  | { type: 'unlink'; path: string }
  | { type: 'rename'; from: string; to: string };

export interface DataSource {
  readonly id: string;
  connect(): Promise<void>;
  listDocuments(): AsyncIterable<DocumentRecord>;
  getDocument(id: string): Promise<DocumentRecord | null>;
  watchChanges(onEvent: (e: ChangeEvent) => void): () => void;
  statFile(path: string): Promise<{ size: number; mtime: Date }>;
}
