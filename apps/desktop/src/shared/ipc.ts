export const IPC = {
  Query: {
    Ask: 'query:ask',
    Stream: 'query:stream',
  },
  Sources: {
    List: 'sources:list',
    Add: 'sources:add',
    Remove: 'sources:remove',
  },
  Index: {
    Status: 'index:status',
    Progress: 'index:progress',
  },
  App: {
    OpenCitation: 'app:open-citation',
  },
} as const;

export type QueryAskRequest = {
  question: string;
};

export type Citation = {
  chunkId: string;
  sourceId: string;
  path: string;
  snippet: string;
  score: number;
  page?: number;
};

export type QueryAskResponse = {
  answer: string;
  citations: Citation[];
};

export type SourceFolder = {
  id: string;
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
