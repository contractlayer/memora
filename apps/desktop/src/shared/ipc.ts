export const IPC = {
  Query: {
    Ask: 'query:ask',
    StreamStart: 'query:stream-start',
    StreamEvent: 'query:stream-event',
    StreamAbort: 'query:stream-abort',
  },
  Sources: {
    List: 'sources:list',
    AddFolder: 'sources:add-folder',
    AddFiles: 'sources:add-files',
    AddByPath: 'sources:add-by-path',
    Remove: 'sources:remove',
  },
  Index: {
    Status: 'index:status',
    Progress: 'index:progress',
  },
  Embedder: {
    Status: 'embedder:status',
  },
  Settings: {
    GetLlm: 'settings:get-llm',
    SetLlm: 'settings:set-llm',
    HasApiKey: 'settings:has-api-key',
    SetApiKey: 'settings:set-api-key',
    TestLlm: 'settings:test-llm',
    ListModels: 'settings:list-models',
  },
  App: {
    OpenCitation: 'app:open-citation',
    OpenSettings: 'app:open-settings',
  },
  Onboarding: {
    Status: 'onboarding:status',
    ScanCandidates: 'onboarding:scan-candidates',
    MarkDone: 'onboarding:mark-done',
  },
  Locale: {
    Get: 'locale:get',
    Set: 'locale:set',
    Changed: 'locale:changed',
  },
  Conversations: {
    List: 'conversations:list',
    Get: 'conversations:get',
    Save: 'conversations:save',
    Rename: 'conversations:rename',
    Delete: 'conversations:delete',
  },
} as const;

export type ConversationSummary = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export type ConversationFull = ConversationSummary & {
  turns: Array<
    | { role: 'user'; content: string }
    | { role: 'assistant'; content: string; citations: Citation[] }
  >;
};

export type OnboardingCandidate = {
  path: string;
  label: string;
  exists: boolean;
  fileCount: number;
  totalBytes: number;
  truncated: boolean;
  recommended: boolean;
};

export type OnboardingStatus = { onboarded: boolean };

export type ChatTurn = {
  role: 'user' | 'assistant';
  content: string;
};

export type QueryAskRequest = {
  question: string;
  history?: ChatTurn[];
  /** Restrict retrieval to these source ids. Empty/undefined = all sources. */
  sourceIds?: string[];
};

export type ChunkLocation = {
  /** PDF page, or page-equivalent for paged documents. */
  pageStart?: number;
  pageEnd?: number;
  /** 1-indexed line numbers — text / markdown / code files. */
  lineStart?: number;
  lineEnd?: number;
  /** XLSX sheet name (chunks can span sheets; first sheet name wins). */
  sheet?: string;
  /** PPTX slide number (1-indexed). */
  slide?: number;
  /** Code symbol name from symbol-aware chunker. */
  symbol?: string;
};

export type Citation = {
  chunkId: string;
  sourceId: string;
  path: string;
  snippet: string;
  score: number;
  location?: ChunkLocation;
};

export type QueryAskResponse = {
  answer: string;
  citations: Citation[];
};

/**
 * Events emitted while streaming a query answer. Order:
 *   1. 'citations' — exactly once, carries the full citation list up front.
 *   2. 'text'      — zero or more, each a delta (not cumulative).
 *   3. 'done'      — exactly once, closes the stream.
 *   'error'        — instead of 'done' when the stream fails.
 */
export type QueryStreamEvent =
  | { type: 'citations'; citations: Citation[] }
  | { type: 'text'; delta: string }
  | { type: 'done'; truncated: boolean }
  | { type: 'error'; error: string };

export type QueryStreamStartRequest = QueryAskRequest & { streamId: string };

export type SourceKind = 'folder' | 'file';

export type SourceFolder = {
  id: string;
  kind: SourceKind;
  path: string;
  addedAt: string;
  fileCount: number;
  indexedCount: number;
};

export type IndexStatus = {
  queued: number;
  inFlight: number;
  completedToday: number;
  totalChunks: number;
  /** Total file rows tracked by the indexer, across every source. */
  totalFiles: number;
  /** Subset of totalFiles that have been fully indexed. */
  indexedFiles: number;
  /** Count of source folders/files registered. Duplicates sources.list length
   *  but avoids a second round-trip in status polling. */
  totalSources: number;
  /** ISO timestamp of the most recent indexed file, or null if none yet. */
  lastIndexedAt: string | null;
  /** Path of the file currently being parsed, if any. */
  currentFile: string | null;
};

export type EmbedderStatus = {
  model: string;
  ready: boolean;
  totalVectors: number;
  pendingChunks: number;
  /** Path of the file whose chunks are currently being embedded, if any. */
  currentFile: string | null;
};

export type LlmProvider = 'none' | 'ollama' | 'openai' | 'anthropic' | 'gemini';

export type LlmSettings = {
  provider: LlmProvider;
  model: string;
  baseUrl?: string;
};

export type LlmTestResult = { ok: true } | { ok: false; error: string };
