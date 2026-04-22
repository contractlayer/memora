import { app } from 'electron';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { SqliteMetadataStore } from './storage/metadata';
import { IndexerService } from './services/indexer';
import { LocalFileConnector } from './connectors/local-fs';
import { buildParserRegistry, type ParserRegistry } from './parsers';
import { TransformersEmbedder, type Embedder, DEFAULT_EMBEDDING_DIMS } from './services/embedder';
import { LanceVectorStore } from './services/vector-store';
import { EmbedWorker } from './services/embed-worker';
import { SettingsStore } from './services/settings';
import { LlmRouter } from './services/llm-router';
import { TransformersReranker, type Reranker } from './services/reranker';

export type AppContext = {
  store: SqliteMetadataStore;
  indexer: IndexerService;
  parsers: ParserRegistry;
  embedder: Embedder;
  reranker: Reranker;
  vectors: LanceVectorStore;
  embedWorker: EmbedWorker;
  settings: SettingsStore;
  llmRouter: LlmRouter;
  connectors: Map<string, LocalFileConnector>;
  userDataDir: string;
  dataDir: string;
};

let context: AppContext | null = null;

export async function initAppContext(): Promise<AppContext> {
  if (context) return context;
  console.log('[init] starting');

  const userDataDir = app.getPath('userData');
  const dataDir = join(userDataDir, 'data');
  await mkdir(dataDir, { recursive: true });
  console.log('[init] dataDir ready:', dataDir);

  const store = new SqliteMetadataStore();
  console.log('[init] opening SQLite at', join(dataDir, 'metadata.db'));
  store.init(join(dataDir, 'metadata.db'));
  console.log('[init] SQLite ready');

  const parsers = buildParserRegistry();
  console.log('[init] parsers registered');

  const embedder = new TransformersEmbedder();
  const reranker = new TransformersReranker();
  // Load in parallel at startup — blocking here is fine because the UI
  // shows a splash until initAppContext resolves, and loading in the
  // background meant early queries silently fell back to BM25-only /
  // RRF-only paths. Failures are logged but don't abort boot.
  await Promise.all([
    embedder.load().catch((err: unknown) => {
      console.error('[init] embedder load failed:', err);
    }),
    reranker.load().catch((err: unknown) => {
      console.error('[init] reranker load failed:', err);
    }),
  ]);

  console.log('[init] opening LanceDB');
  const vectors = new LanceVectorStore(join(dataDir, 'lancedb'), DEFAULT_EMBEDDING_DIMS);
  await vectors.init();
  console.log('[init] LanceDB ready');

  const indexer = new IndexerService(store, parsers, vectors);

  const embedWorker = new EmbedWorker(store, embedder, vectors);

  const settings = new SettingsStore();
  await settings.init();
  const llmRouter = new LlmRouter(settings);
  console.log('[init] settings ready');

  const connectors = new Map<string, LocalFileConnector>();

  // Restore sources from previous session BEFORE starting the indexer loop,
  // otherwise any queued jobs drain with "Connector not registered" failures.
  const rows = store.listSources();
  for (const row of rows) {
    if (row.kind !== 'local-fs') continue;
    const connector = new LocalFileConnector(row.id, [row.path]);
    try {
      await connector.connect();
    } catch {
      // Path may have moved or been unmounted. Skip; leave source row in place.
      continue;
    }
    connector.watchChanges((event) => {
      if (event.type === 'add' || event.type === 'change') {
        indexer.enqueueChange(row.id, event.path, 'parse');
      } else if (event.type === 'unlink') {
        indexer.enqueueChange(row.id, event.path, 'delete');
      }
    });
    indexer.registerConnector(connector);
    connectors.set(row.id, connector);
    // Catch files added/modified while the app was closed — the watcher's
    // ignoreInitial means it won't emit them on start. Unchanged files are
    // filtered by sha256 in processParseJob, so this is cheap to re-run.
    void indexer.enqueueScan(connector);
  }

  await indexer.start();
  console.log('[init] indexer started');

  embedWorker.start();
  console.log('[init] embedWorker started');

  context = {
    store,
    indexer,
    parsers,
    embedder,
    reranker,
    vectors,
    embedWorker,
    settings,
    llmRouter,
    connectors,
    userDataDir,
    dataDir,
  };
  return context;
}

export function getAppContext(): AppContext {
  if (!context) throw new Error('App context not initialized');
  return context;
}

export async function shutdownAppContext(): Promise<void> {
  if (!context) return;
  await context.indexer.stop();
  await context.embedWorker.stop();
  for (const connector of context.connectors.values()) {
    await connector.disconnect();
  }
  context.store.close();
  context = null;
}
