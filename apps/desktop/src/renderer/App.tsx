import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Api } from '../preload';
import type {
  Citation,
  ChunkLocation,
  ConversationSummary,
  EmbedderStatus,
  IndexStatus,
  SourceFolder,
} from '../shared/ipc';
import { SettingsModal } from './Settings';
import { OnboardingModal } from './Onboarding';
import { SourcesModal } from './Sources';
import { Logo } from './Logo';
import { useTranslation } from './i18n';

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
  const { t } = useTranslation();
  const [question, setQuestion] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [loading, setLoading] = useState(false);
  const [sources, setSources] = useState<SourceFolder[]>([]);
  const [status, setStatus] = useState<IndexStatus | null>(null);
  const [embedder, setEmbedder] = useState<EmbedderStatus | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [sourcesModalOpen, setSourcesModalOpen] = useState(false);
  // Ids currently checked for query scope. Populated with all sources the
  // first time they load; user can uncheck individually. Empty set means
  // "no source selected" (backend returns no results, which is correct).
  const [selectedSourceIds, setSelectedSourceIds] = useState<Set<string>>(new Set());
  const [scopeInitialized, setScopeInitialized] = useState(false);
  // Conversation history
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  // Stable id for the *pending* conversation (one the user is currently
  // composing). We only persist it after the first assistant response comes
  // back, so empty sessions don't litter the history list.
  const pendingConvIdRef = useRef<string>(makeConversationId());
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void refresh();
    const interval = setInterval(refresh, 2000);
    return () => clearInterval(interval);
  }, []);

  // Show the onboarding modal on first run (no sources + not yet dismissed).
  useEffect(() => {
    void (async () => {
      const status = await window.api.onboarding.status();
      if (!status.onboarded) setOnboardingOpen(true);
    })();
  }, []);

  // Open Settings when the native OS menu emits the request.
  useEffect(() => {
    const unsub = window.api.app.onOpenSettings(() => setSettingsOpen(true));
    return unsub;
  }, []);

  // Load conversation history on mount + periodically while idle so newly
  // saved sessions on other windows (future) show up.
  const refreshConversations = useCallback(async () => {
    try {
      const items = await window.api.conversations.list();
      setConversations(items);
    } catch (err) {
      console.warn('conversations.list failed', err);
    }
  }, []);

  useEffect(() => {
    void refreshConversations();
  }, [refreshConversations]);

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
    if (sources.length === 0) return t('sources.emptyShort');
    if (selectedSourceIds.size === 0) return t('sources.scopeNone');
    if (scope === undefined) return t('sources.scopeAll', { count: sources.length });
    return t('sources.scopeSome', { count: scope.length, total: sources.length });
  }, [scope, sources.length, selectedSourceIds.size, t]);

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
    const userTurn: UserTurn = { role: 'user', content: q };
    // Seed an empty assistant turn that we mutate in place as text streams in.
    const assistantTurn: AssistantTurn = { role: 'assistant', content: '', citations: [] };
    const baseTurns: Turn[] = [...turns, userTurn, assistantTurn];
    const assistantIdx = baseTurns.length - 1;

    setTurns(baseTurns);
    setQuestion('');
    setLoading(true);

    const stream = window.api.query.askStream(
      {
        question: q,
        history: turns.map((t) => ({ role: t.role, content: t.content })),
        sourceIds: scope,
      },
      (evt) => {
        if (evt.type === 'citations') {
          setTurns((prev) => {
            const next = [...prev];
            const current = next[assistantIdx];
            if (current && current.role === 'assistant') {
              next[assistantIdx] = { ...current, citations: evt.citations };
            }
            return next;
          });
        } else if (evt.type === 'text') {
          setTurns((prev) => {
            const next = [...prev];
            const current = next[assistantIdx];
            if (current && current.role === 'assistant') {
              next[assistantIdx] = { ...current, content: current.content + evt.delta };
            }
            return next;
          });
        } else if (evt.type === 'error') {
          setTurns((prev) => {
            const next = [...prev];
            const current = next[assistantIdx];
            if (current && current.role === 'assistant') {
              next[assistantIdx] = {
                ...current,
                content: current.content
                  ? `${current.content}\n\n[error: ${evt.error}]`
                  : `Error: ${evt.error}`,
              };
            }
            return next;
          });
        }
      },
    );

    try {
      await stream.done;
    } catch (err) {
      console.error('stream failed:', err);
    } finally {
      setLoading(false);
      // Persist after the stream finishes. Use the ref value to capture the
      // id even if another "New chat" click changes it mid-stream.
      const convId = activeConversationId ?? pendingConvIdRef.current;
      try {
        // Grab the latest turns via functional setter so we save what the
        // user actually sees (including streamed deltas).
        setTurns((latest) => {
          const title = deriveTitle(latest);
          void window.api.conversations
            .save({ id: convId, title, turns: latest as never })
            .then(() => {
              if (!activeConversationId) setActiveConversationId(convId);
              void refreshConversations();
            })
            .catch((err) => console.warn('conversations.save failed', err));
          return latest;
        });
      } catch (err) {
        console.warn('persist failed', err);
      }
    }
  }

  function onNewChat() {
    setTurns([]);
    setQuestion('');
    setActiveConversationId(null);
    pendingConvIdRef.current = makeConversationId();
  }

  async function loadConversation(id: string) {
    const full = await window.api.conversations.get(id);
    if (!full) return;
    setTurns(full.turns as Turn[]);
    setActiveConversationId(id);
    setQuestion('');
  }

  async function deleteConversation(id: string) {
    await window.api.conversations.delete(id);
    if (activeConversationId === id) {
      setTurns([]);
      setActiveConversationId(null);
      pendingConvIdRef.current = makeConversationId();
    }
    await refreshConversations();
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

  const lastTurn = turns[turns.length - 1];
  const showThinking =
    loading &&
    lastTurn?.role === 'assistant' &&
    (lastTurn as AssistantTurn).content.length === 0;

  return (
    <div className="app">
      <header className="app__drag" />

      <div className="app__body">
      <aside className="sidebar">
        <div className="sidebar__brand">
          <Logo size={22} />
          <span className="sidebar__brand-name">Memora</span>
        </div>

        <button
          type="button"
          className="sidebar__new-chat"
          onClick={onNewChat}
          disabled={turns.length === 0 && !activeConversationId}
        >
          <span aria-hidden className="sidebar__plus">+</span>
          {t('app.newChat')}
        </button>

        <nav className="sidebar__scroll">
          <header className="sidebar__section-head">
            <span className="sidebar__section-title">{t('history.title')}</span>
            {conversations.length > 0 && (
              <span className="sidebar__section-count">{conversations.length}</span>
            )}
          </header>

          {conversations.length === 0 && turns.length === 0 ? (
            <p className="sidebar__empty">{t('history.empty')}</p>
          ) : (
            <ul className="sidebar__history">
              {conversations.map((c) => {
                const isActive = c.id === activeConversationId;
                return (
                  <li
                    key={c.id}
                    className={`sidebar__history-item${isActive ? ' is-active' : ''}`}
                    onClick={() => void loadConversation(c.id)}
                  >
                    <div className="sidebar__history-title" title={c.title}>
                      {c.title}
                    </div>
                    <div className="sidebar__history-meta">{relativeTime(c.updatedAt)}</div>
                    <button
                      type="button"
                      className="sidebar__history-del"
                      onClick={(e) => {
                        e.stopPropagation();
                        void deleteConversation(c.id);
                      }}
                      aria-label={t('history.delete')}
                      title={t('history.delete')}
                    >
                      ×
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </nav>

        <footer className="sidebar__foot">
          <button
            type="button"
            className="sidebar__foot-btn"
            onClick={() => setSourcesModalOpen(true)}
          >
            <span aria-hidden className="sidebar__foot-icon">▸</span>
            <span className="sidebar__foot-label">{t('sources.title')}</span>
            {sources.length > 0 && (
              <span className="sidebar__foot-badge">{sources.length}</span>
            )}
          </button>

          <button
            type="button"
            className="sidebar__foot-btn"
            onClick={() => setSettingsOpen(true)}
          >
            <span aria-hidden className="sidebar__foot-icon">⚙</span>
            <span className="sidebar__foot-label">{t('app.settings')}</span>
          </button>
        </footer>
      </aside>

      <SourcesModal
        open={sourcesModalOpen}
        onClose={() => setSourcesModalOpen(false)}
        sources={sources}
        selectedSourceIds={selectedSourceIds}
        onToggle={toggleSource}
        onSelectAll={selectAll}
        onSelectNone={selectNone}
        onAddFolder={() => void onAddFolder()}
        onAddFiles={() => void onAddFiles()}
        onRemove={(id) => void onRemove(id)}
        scopeLabel={scopeLabel}
      />

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <OnboardingModal
        open={onboardingOpen}
        onClose={() => setOnboardingOpen(false)}
        onFinished={refresh}
      />

      <main className="content">
        <div className="content__body">
          {turns.length === 0 ? (
            <EmptyState
              subtitle={t('app.subtitle')}
              hint={t('chat.scopeHint', { scope: scopeLabel.toLowerCase() })}
            />
          ) : (
            <section className="chat">
              {turns.map((t, i) =>
                t.role === 'user' ? (
                  <UserMessage key={i} content={t.content} />
                ) : (
                  <AssistantMessage key={i} turn={t} onOpen={onOpenCitation} />
                ),
              )}
              {showThinking && <ThinkingIndicator />}
              <div ref={bottomRef} />
            </section>
          )}
        </div>

        <div className="composer">
          <div className="composer__inner">
            {turns.length > 0 && (
              <div className="composer__scope">
                {t('chat.scopeHint', { scope: scopeLabel.toLowerCase() })}
              </div>
            )}
            <div className="composer__row">
              <input
                className="composer__input"
                type="text"
                placeholder={
                  turns.length === 0 ? t('chat.placeholder') : t('chat.placeholderFollowup')
                }
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && onAsk()}
                disabled={loading}
              />
              <button
                className="composer__send"
                onClick={onAsk}
                disabled={loading || question.trim().length === 0}
                aria-label={t('chat.ask')}
              >
                {loading ? '...' : '↵'}
              </button>
            </div>
          </div>
        </div>
      </main>
      </div>

      <StatusBar status={status} embedder={embedder} sourcesCount={sources.length} />
    </div>
  );
}

function EmptyState({ subtitle, hint }: { subtitle: string; hint: string }) {
  return (
    <div className="empty">
      <div className="empty__mark">
        <Logo size={64} />
      </div>
      <h1 className="empty__title">Memora</h1>
      <p className="empty__subtitle">{subtitle}</p>
      <p className="empty__hint">{hint}</p>
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
  const { t } = useTranslation();
  return (
    <div className="msg msg--assistant">
      {turn.content.length > 0 && (
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
      )}
      {turn.citations.length > 0 && (
        <details className="msg__citations">
          <summary>{t('chat.sources', { count: turn.citations.length })}</summary>
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
                      title={t('chat.copy')}
                    >
                      {t('chat.copy')}
                    </button>
                    <button className="button button--ghost" onClick={() => onOpen(c.path)}>
                      {t('chat.open')}
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

function shortPath(path: string): string {
  // Keep the last 3 path segments — enough to identify the file in a deep tree
  // without blowing up the status line.
  const parts = path.split('/');
  if (parts.length <= 3) return path;
  return '…/' + parts.slice(-3).join('/');
}

function makeConversationId(): string {
  return `c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** First user message, truncated — simple and predictable title. */
function deriveTitle(turns: Turn[]): string {
  const first = turns.find((t) => t.role === 'user');
  const text = first?.content.trim() ?? 'Untitled';
  return text.length > 60 ? text.slice(0, 57) + '…' : text;
}

function relativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const diffMs = now.getTime() - then.getTime();
  const day = 24 * 60 * 60 * 1000;
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const thenStart = new Date(then.getFullYear(), then.getMonth(), then.getDate()).getTime();
  const daysAgo = Math.round((startOfToday - thenStart) / day);
  if (diffMs < 60 * 1000) return 'just now';
  if (daysAgo === 0) {
    const h = then.getHours().toString().padStart(2, '0');
    const m = then.getMinutes().toString().padStart(2, '0');
    return `${h}:${m}`;
  }
  if (daysAgo === 1) return 'yesterday';
  if (daysAgo < 7) return `${daysAgo}d ago`;
  return then.toISOString().slice(0, 10);
}

function StatusBar({
  status,
  embedder,
  sourcesCount,
}: {
  status: IndexStatus | null;
  embedder: EmbedderStatus | null;
  sourcesCount: number;
}) {
  const { t } = useTranslation();
  if (!status) return <footer className="statusbar statusbar--placeholder" aria-hidden />;

  const pending = embedder?.pendingChunks ?? 0;
  const isActive = Boolean(status.currentFile || embedder?.currentFile);
  const activityPath = status.currentFile ?? embedder?.currentFile ?? null;
  const activityKind = status.currentFile ? 'is-parsing' : 'is-embedding';

  return (
    <footer className="statusbar" role="status">
      <div className="statusbar__stats">
        <StatItem label={t('status.sources')} value={sourcesCount.toLocaleString()} />
        <StatItem
          label={t('status.documents')}
          value={
            status.indexedFiles < status.totalFiles
              ? `${status.indexedFiles.toLocaleString()} / ${status.totalFiles.toLocaleString()}`
              : status.totalFiles.toLocaleString()
          }
          tone={status.indexedFiles < status.totalFiles ? 'working' : undefined}
        />
        <StatItem label={t('status.chunks')} value={status.totalChunks.toLocaleString()} />
        <StatItem
          label={t('status.vectorsLabel')}
          value={(embedder?.totalVectors ?? 0).toLocaleString()}
        />
        {status.queued > 0 && (
          <StatItem
            label={t('status.queued')}
            value={status.queued.toLocaleString()}
            tone="working"
          />
        )}
        {pending > 0 && (
          <StatItem
            label={t('status.pendingLabel')}
            value={pending.toLocaleString()}
            tone="working"
          />
        )}
        <StatItem
          label={t('status.updated')}
          value={status.lastIndexedAt ? relativeTime(status.lastIndexedAt) : t('status.updatedNever')}
        />
      </div>

      <div className="statusbar__spacer" />

      <div className="statusbar__activity">
        {embedder && !embedder.ready && (
          <span className="statusbar__model is-loading">
            {t('status.modelLoading', { model: embedder.model })}
          </span>
        )}
        {isActive && activityPath ? (
          <span
            className={`statusbar__ticker ${activityKind}`}
            title={activityPath}
          >
            <span className="statusbar__ticker-dot" aria-hidden />
            <span className="statusbar__ticker-text">
              {status.currentFile
                ? t('status.indexing', { path: shortPath(activityPath) })
                : t('status.embedding', { path: shortPath(activityPath) })}
            </span>
            <span className="typing-dots" aria-hidden>
              <span />
              <span />
              <span />
            </span>
          </span>
        ) : (
          embedder?.ready && <span className="statusbar__idle">{t('status.idle')}</span>
        )}
      </div>
    </footer>
  );
}

function StatItem({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'working';
}) {
  return (
    <div className={`statusbar__stat${tone === 'working' ? ' is-working' : ''}`}>
      <span className="statusbar__stat-label">{label}</span>
      <span className="statusbar__stat-value">{value}</span>
    </div>
  );
}

function ThinkingIndicator() {
  const { t } = useTranslation();
  return (
    <div className="msg msg--assistant msg--thinking">
      <div className="msg__body">{t('chat.thinking')}</div>
    </div>
  );
}
