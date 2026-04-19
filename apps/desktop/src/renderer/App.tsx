import { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Api } from '../preload';
import type {
  Citation,
  ChunkLocation,
  EmbedderStatus,
  IndexStatus,
  SourceFolder,
} from '../shared/ipc';
import { SettingsModal } from './Settings';
import { Logo } from './Logo';

declare global {
  interface Window {
    api: Api;
  }
}

type AssistantTurn = {
  role: 'assistant';
  content: string;
  citations: Citation[];
};
type UserTurn = { role: 'user'; content: string };
type Turn = UserTurn | AssistantTurn;

export function App() {
  const [question, setQuestion] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [loading, setLoading] = useState(false);
  const [sources, setSources] = useState<SourceFolder[]>([]);
  const [status, setStatus] = useState<IndexStatus | null>(null);
  const [embedder, setEmbedder] = useState<EmbedderStatus | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  // Ids currently checked for query scope. Populated with all sources the
  // first time they load; user can uncheck individually. Empty set means
  // "no source selected" (backend returns no results, which is correct).
  const [selectedSourceIds, setSelectedSourceIds] = useState<Set<string>>(new Set());
  const [scopeInitialized, setScopeInitialized] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void refresh();
    const interval = setInterval(refresh, 2000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [turns, loading]);

  async function refresh() {
    const [srcs, st, em] = await Promise.all([
      window.api.sources.list(),
      window.api.index.status(),
      window.api.embedder.status(),
    ]);
    setSources(srcs);
    setStatus(st);
    setEmbedder(em);
    // On first load, select all. After that, auto-include newly-added sources
    // and drop removed ones — but don't re-check what the user unchecked.
    setSelectedSourceIds((prev) => {
      if (!scopeInitialized) {
        setScopeInitialized(true);
        return new Set(srcs.map((s) => s.id));
      }
      const currentIds = new Set(srcs.map((s) => s.id));
      const next = new Set<string>();
      prev.forEach((id) => currentIds.has(id) && next.add(id));
      // Auto-select newly-added sources (user expectation: add = enabled).
      srcs.forEach((s) => {
        if (!prev.has(s.id) && ![...prev].some((pid) => pid === s.id)) next.add(s.id);
      });
      return next;
    });
  }

  const scope = useMemo(() => {
    if (sources.length === 0) return undefined;
    // If all are selected, send undefined → backend skips WHERE clause (faster).
    if (selectedSourceIds.size === sources.length) return undefined;
    return Array.from(selectedSourceIds);
  }, [selectedSourceIds, sources]);

  const scopeLabel = useMemo(() => {
    if (sources.length === 0) return 'No sources yet';
    if (selectedSourceIds.size === 0) return 'No sources selected';
    if (scope === undefined) return `All ${sources.length} sources`;
    return `${scope.length} of ${sources.length} sources`;
  }, [scope, sources.length, selectedSourceIds.size]);

  function toggleSource(id: string) {
    setSelectedSourceIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    setSelectedSourceIds(new Set(sources.map((s) => s.id)));
  }
  function selectNone() {
    setSelectedSourceIds(new Set());
  }

  async function onAsk() {
    const q = question.trim();
    if (!q || loading) return;
    const nextTurns: Turn[] = [...turns, { role: 'user', content: q }];
    setTurns(nextTurns);
    setQuestion('');
    setLoading(true);
    try {
      const res = await window.api.query.ask({
        question: q,
        history: turns.map((t) => ({ role: t.role, content: t.content })),
        sourceIds: scope,
      });
      setTurns([
        ...nextTurns,
        { role: 'assistant', content: res.answer, citations: res.citations },
      ]);
    } catch (err) {
      setTurns([
        ...nextTurns,
        {
          role: 'assistant',
          content: `Error: ${(err as Error).message}`,
          citations: [],
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function onNewChat() {
    setTurns([]);
    setQuestion('');
  }

  async function onOpenCitation(path: string) {
    await window.api.app.openCitation(path);
  }

  async function onAddFolder() {
    const added = await window.api.sources.addFolder();
    if (added) await refresh();
  }

  async function onAddFiles() {
    const added = await window.api.sources.addFiles();
    if (added.length > 0) await refresh();
  }

  async function onRemove(id: string) {
    await window.api.sources.remove(id);
    await refresh();
  }

  return (
    <div className="app">
      <header className="app__header" />

      <main className="app__main">
        <div className="app__title">
          <Logo size={40} />
          <div className="app__title-text">
            <h1>Memora</h1>
            <span className="app__subtitle">Ask anything about your data.</span>
          </div>
          <div className="app__title-actions">
            {turns.length > 0 && (
              <button className="button button--ghost" onClick={onNewChat}>
                New chat
              </button>
            )}
            <button className="button button--ghost" onClick={() => setSettingsOpen(true)}>
              Settings
            </button>
          </div>
        </div>

        <details className="sources" open={sourcesOpen} onToggle={(e) => setSourcesOpen(e.currentTarget.open)}>
          <summary className="sources__summary">
            <span className="sources__summary-label">Sources</span>
            <span className="sources__summary-count">{sources.length}</span>
            <span className="sources__summary-scope">{scopeLabel}</span>
            <span className="sources__summary-spacer" />
            <div className="sources__summary-actions">
              <button
                className="button button--ghost"
                onClick={(e) => {
                  e.preventDefault();
                  void onAddFolder();
                }}
              >
                + Folder
              </button>
              <button
                className="button button--ghost"
                onClick={(e) => {
                  e.preventDefault();
                  void onAddFiles();
                }}
              >
                + Files
              </button>
            </div>
          </summary>

          {sources.length === 0 ? (
            <p className="sources__empty">No sources yet. Add a folder or files to start.</p>
          ) : (
            <>
              <div className="sources__toolbar">
                <button
                  className="link"
                  onClick={selectAll}
                  disabled={selectedSourceIds.size === sources.length}
                >
                  Select all
                </button>
                <span className="sources__toolbar-sep">·</span>
                <button
                  className="link"
                  onClick={selectNone}
                  disabled={selectedSourceIds.size === 0}
                >
                  Select none
                </button>
              </div>
              <ul className="sources__list">
                {sources.map((s) => {
                  const checked = selectedSourceIds.has(s.id);
                  return (
                    <li key={s.id} className="sources__item">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSource(s.id)}
                      />
                      <span className="sources__kind" title={s.kind}>
                        {s.kind === 'file' ? '📄' : '📁'}
                      </span>
                      <div className="sources__path" title={s.path}>
                        {s.path}
                      </div>
                      <div className="sources__meta">
                        {s.indexedCount}/{s.fileCount}
                      </div>
                      <button className="button button--ghost" onClick={() => onRemove(s.id)}>
                        Remove
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}

          {status && (
            <div className="sources__status">
              Text index: queue {status.queued} · in-flight {status.inFlight} · chunks{' '}
              {status.totalChunks}
              {embedder && (
                <>
                  <br />
                  Semantic:{' '}
                  <span className={embedder.ready ? 'embedder--ready' : 'embedder--loading'}>
                    {embedder.ready ? 'model ready' : `loading ${embedder.model}…`}
                  </span>{' '}
                  · {embedder.totalVectors} vectors
                  {embedder.pendingChunks > 0 && ` · ${embedder.pendingChunks} pending`}
                </>
              )}
            </div>
          )}
        </details>

        <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />

        {turns.length > 0 && (
          <section className="chat">
            {turns.map((t, i) =>
              t.role === 'user' ? (
                <UserMessage key={i} content={t.content} />
              ) : (
                <AssistantMessage key={i} turn={t} onOpen={onOpenCitation} />
              ),
            )}
            {loading && <ThinkingIndicator />}
            <div ref={bottomRef} />
          </section>
        )}

        <div className="search">
          <div className="search__scope-hint">
            Asking against <strong>{scopeLabel.toLowerCase()}</strong>
          </div>
          <div className="search__row">
            <input
              className="search__input"
              type="text"
              placeholder={
                turns.length === 0
                  ? 'Ask anything about your files…'
                  : 'Follow up (same context)…'
              }
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && onAsk()}
              disabled={loading}
            />
            <button className="button button--primary" onClick={onAsk} disabled={loading}>
              {loading ? '...' : 'Ask'}
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}

function UserMessage({ content }: { content: string }) {
  return (
    <div className="msg msg--user">
      <div className="msg__bubble">{content}</div>
    </div>
  );
}

function AssistantMessage({
  turn,
  onOpen,
}: {
  turn: AssistantTurn;
  onOpen: (path: string) => void;
}) {
  return (
    <div className="msg msg--assistant">
      <div className="msg__body markdown">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            // Open external links in default browser via Electron shell
            a: ({ href, children }) => (
              <a
                href={href}
                onClick={(e) => {
                  if (href?.startsWith('http')) {
                    e.preventDefault();
                    void window.api.app.openCitation(href);
                  }
                }}
              >
                {children}
              </a>
            ),
          }}
        >
          {turn.content}
        </ReactMarkdown>
      </div>
      {turn.citations.length > 0 && (
        <details className="msg__citations">
          <summary>Sources ({turn.citations.length})</summary>
          <ul className="citations__list">
            {turn.citations.map((c, i) => {
              const locLabel = formatLocation(c.location);
              return (
                <li key={c.chunkId} className="citations__item">
                  <div className="citations__rank">{i + 1}</div>
                  <div className="citations__body">
                    <div className="citations__path" title={c.path}>
                      {c.path.split('/').slice(-2).join('/')}
                      {locLabel && <span className="citations__location">{locLabel}</span>}
                    </div>
                    <div className="citations__snippet">{c.snippet}</div>
                  </div>
                  <div className="citations__actions">
                    <button
                      className="button button--ghost"
                      onClick={() => void copySnippet(c.snippet)}
                      title="Copy snippet to clipboard"
                    >
                      Copy
                    </button>
                    <button className="button button--ghost" onClick={() => onOpen(c.path)}>
                      Open
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </details>
      )}
    </div>
  );
}

function formatLocation(loc?: ChunkLocation): string | null {
  if (!loc) return null;
  const parts: string[] = [];
  if (loc.slide !== undefined) {
    parts.push(`Slide ${loc.slide}`);
  } else if (loc.sheet) {
    parts.push(`Sheet: ${loc.sheet}`);
  } else if (loc.pageStart !== undefined) {
    parts.push(
      loc.pageEnd && loc.pageEnd !== loc.pageStart
        ? `Page ${loc.pageStart}–${loc.pageEnd}`
        : `Page ${loc.pageStart}`,
    );
  }
  if (loc.lineStart !== undefined) {
    parts.push(
      loc.lineEnd && loc.lineEnd !== loc.lineStart
        ? `Line ${loc.lineStart}–${loc.lineEnd}`
        : `Line ${loc.lineStart}`,
    );
  }
  if (loc.symbol) parts.push(loc.symbol);
  return parts.length > 0 ? parts.join(' · ') : null;
}

async function copySnippet(snippet: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(snippet);
  } catch (err) {
    console.warn('copy failed', err);
  }
}

function ThinkingIndicator() {
  return (
    <div className="msg msg--assistant msg--thinking">
      <div className="msg__body">Thinking…</div>
    </div>
  );
}
