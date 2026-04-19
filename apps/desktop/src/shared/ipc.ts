export const IPC = {
  Query: {
    Ask: 'query:ask',
    Stream: 'query:stream',
  },
  Sources: {
    List: 'sources:list',
    AddFolder: 'sources:add-folder',
    AddFiles: 'sources:add-files',
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
  },
} as const;

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
};

export type EmbedderStatus = {
  model: string;
  ready: boolean;
  totalVectors: number;
  pendingChunks: number;
};

export type LlmProvider = 'none' | 'ollama' | 'openai' | 'anthropic' | 'gemini';

export type LlmSettings = {
  provider: LlmProvider;
  model: string;
  baseUrl?: string;
};

export type LlmTestResult = { ok: true } | { ok: false; error: string };
