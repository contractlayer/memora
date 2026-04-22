import type {
  ChatTurn,
  QueryAskRequest,
  QueryAskResponse,
  QueryStreamEvent,
  Citation,
  ChunkLocation,
} from '@shared/ipc';
import type { SqliteMetadataStore, SearchHitRow } from '@main/storage/metadata';
import type { Embedder } from '@main/services/embedder';
import type { LanceVectorStore, VectorSearchHit } from '@main/services/vector-store';
import type { LlmRouter } from '@main/services/llm-router';
import type { Reranker } from '@main/services/reranker';
import { QueryParser, type ParsedQuery } from '@main/services/query-parser';

// Pull more candidates than we show so RRF fusion has room to rank.
const BM25_TOP_K = 30;
const VECTOR_TOP_K = 30;
const RERANK_INPUT_K = 20; // Top-N from RRF handed to the cross-encoder reranker.
const FINAL_TOP_K = 5;     // After rerank. This is what user sees + LLM sees.
const RRF_K = 60;          // Standard reciprocal rank fusion constant.
const SNIPPET_CONTEXT_CHARS = 140;

type CandidatePool = Map<
  string,
  {
    chunkId: string;
    fileId: string;
    text: string;
    path: string;
    sourceId: string;
    /** ISO timestamp of the file's mtime — used for date-range filtering. */
    mtime: string;
    location?: ChunkLocation;
    bm25Rank?: number;
    vectorRank?: number;
    vectorDistance?: number;
    bm25Score?: number;
  }
>;

export class QueryOrchestrator {
  private readonly queryParser: QueryParser;

  constructor(
    private readonly store: SqliteMetadataStore,
    private readonly embedder: Embedder,
    private readonly vectors: LanceVectorStore,
    private readonly llmRouter: LlmRouter,
    private readonly reranker: Reranker,
  ) {
    this.queryParser = new QueryParser(llmRouter);
  }

  async ask(req: QueryAskRequest): Promise<QueryAskResponse> {
    const retrieved = await this.retrieve(req);
    if (!retrieved) {
      return {
        answer:
          'No matches yet. Add a folder with text/PDF/DOCX/code files, wait for indexing, then try again.',
        citations: [],
      };
    }
    if (retrieved === 'empty-question') {
      return { answer: 'Ask a question about your indexed files.', citations: [] };
    }
    const { ranked, citations } = retrieved;
    const answer = await this.synthesizeOrFallback(
      req.question,
      ranked,
      citations,
      req.history ?? [],
    );
    return { answer, citations };
  }

  /**
   * Streaming variant — yields citations first, then text deltas, then done.
   * Lets the renderer show partial answer as the LLM produces it.
   */
  async *askStream(req: QueryAskRequest): AsyncGenerator<QueryStreamEvent> {
    const retrieved = await this.retrieve(req);
    if (retrieved === 'empty-question') {
      yield { type: 'citations', citations: [] };
      yield { type: 'text', delta: 'Ask a question about your indexed files.' };
      yield { type: 'done', truncated: false };
      return;
    }
    if (!retrieved) {
      yield { type: 'citations', citations: [] };
      yield {
        type: 'text',
        delta:
          'No matches yet. Add a folder with text/PDF/DOCX/code files, wait for indexing, then try again.',
      };
      yield { type: 'done', truncated: false };
      return;
    }
    const { ranked, citations } = retrieved;
    yield { type: 'citations', citations };

    const client = await this.llmRouter.resolve();
    if (!client) {
      // No LLM → fall back to top snippet (same UX as non-streaming).
      yield { type: 'text', delta: topSnippet(citations) };
      yield { type: 'done', truncated: false };
      return;
    }

    const { system, user } = buildSynthesisPrompt(req.question, ranked);
    try {
      let truncated = false;
      const stream = client.chatStream(
        [
          { role: 'system', content: system },
          ...(req.history ?? []).map((t) => ({ role: t.role, content: t.content })),
          { role: 'user', content: user },
        ],
        { temperature: 0.2, maxTokens: 4096 },
      );
      for await (const chunk of stream) {
        if (chunk.type === 'text') yield chunk;
        else if (chunk.type === 'done') truncated = chunk.truncated;
      }
      if (truncated) {
        yield {
          type: 'text',
          delta: '\n\n*…answer truncated at maxTokens limit — ask a follow-up to continue.*',
        };
      }
      yield { type: 'done', truncated };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('LLM stream failed, falling back:', err);
      yield { type: 'text', delta: `[LLM error: ${msg}] ${topSnippet(citations)}` };
      yield { type: 'done', truncated: false };
    }
  }

  /**
   * Shared retrieval path: BM25 + vector → RRF → rerank → citations.
   * Returns:
   *   - 'empty-question' when the question is blank,
   *   - null when no candidates match,
   *   - {ranked, citations} otherwise.
   */
  private async retrieve(
    req: QueryAskRequest,
  ): Promise<
    | { ranked: Awaited<ReturnType<QueryOrchestrator['rerankOrFallback']>>; citations: Citation[] }
    | null
    | 'empty-question'
  > {
    const q = req.question.trim();
    if (q.length === 0) return 'empty-question';

    const scope = req.sourceIds;
    // Parse date intent in parallel with search — zero extra latency when the
    // question has no time keywords (hasTimeIntent returns false fast).
    const [bm25Hits, vectorHits, parsed] = await Promise.all([
      Promise.resolve(this.store.searchFts(q, BM25_TOP_K, scope)),
      this.vectorSearchOrEmpty(q),
      this.queryParser.parse(q),
    ]);

    const pool = this.fuse(bm25Hits, vectorHits, scope);
    if (pool.size === 0) return null;

    applyDateFilter(pool, parsed);
    if (pool.size === 0) {
      console.warn('[query] date filter removed all candidates — ignoring filter');
      // Re-run fuse unfiltered so the user gets SOMETHING back. Cheap because
      // BM25/vector results are already in memory.
      const fallback = this.fuse(bm25Hits, vectorHits, scope);
      fallback.forEach((v, k) => pool.set(k, v));
    } else if (parsed.dateAfter || parsed.dateBefore) {
      console.log(
        `[query] date filter applied: after=${parsed.dateAfter ?? '—'} before=${parsed.dateBefore ?? '—'} → ${pool.size} candidates`,
      );
    }

    const rrfRanked = [...pool.values()]
      .map((c) => {
        const bm = c.bm25Rank !== undefined ? 1 / (RRF_K + c.bm25Rank) : 0;
        const vec = c.vectorRank !== undefined ? 1 / (RRF_K + c.vectorRank) : 0;
        return { ...c, rrfScore: bm + vec };
      })
      .sort((a, b) => b.rrfScore - a.rrfScore)
      .slice(0, RERANK_INPUT_K);

    const ranked = await this.rerankOrFallback(q, rrfRanked);
    const citations: Citation[] = ranked.map((c) => ({
      chunkId: c.chunkId,
      sourceId: c.fileId,
      path: c.path,
      snippet: makeSnippet(c.text, q, SNIPPET_CONTEXT_CHARS),
      score: c.rrfScore,
      location: c.location,
    }));
    return { ranked, citations };
  }

  /**
   * Run the cross-encoder reranker over the RRF pool, keep the top FINAL_TOP_K.
   * Falls back to RRF-only ranking if the reranker fails to load or infer.
   */
  private async rerankOrFallback<T extends { chunkId: string; text: string; path: string }>(
    query: string,
    rrfRanked: T[],
  ): Promise<T[]> {
    if (rrfRanked.length === 0) return [];
    try {
      const start = Date.now();
      const scored = await this.reranker.rerank(
        query,
        rrfRanked.map((c) => ({ chunkId: c.chunkId, text: c.text })),
      );
      const scoreMap = new Map(scored.map((s) => [s.chunkId, s.score]));
      const reordered = [...rrfRanked]
        .sort(
          (a, b) => (scoreMap.get(b.chunkId) ?? 0) - (scoreMap.get(a.chunkId) ?? 0),
        )
        .slice(0, FINAL_TOP_K);
      console.log(
        `[rerank] ${rrfRanked.length} → ${reordered.length} in ${Date.now() - start}ms`,
      );
      return reordered;
    } catch (err) {
      console.warn('[rerank] failed, falling back to RRF top-K:', err);
      return rrfRanked.slice(0, FINAL_TOP_K);
    }
  }

  private async synthesizeOrFallback(
    question: string,
    ranked: { text: string; path: string }[],
    citations: Citation[],
    history: ChatTurn[],
  ): Promise<string> {
    const client = await this.llmRouter.resolve();
    if (!client) {
      // No LLM configured — fall back to showing the top snippet as the
      // "answer". User still sees citations so they can dig in.
      return topSnippet(citations);
    }
    try {
      const { system, user } = buildSynthesisPrompt(question, ranked);
      return await client.chat(
        [
          { role: 'system', content: system },
          ...history.map((t) => ({ role: t.role, content: t.content })),
          { role: 'user', content: user },
        ],
        { temperature: 0.2, maxTokens: 4096 },
      );
    } catch (err) {
      console.error('LLM synthesis failed, falling back to top snippet:', err);
      return `[LLM error: ${(err as Error).message}] ${topSnippet(citations)}`;
    }
  }

  private async vectorSearchOrEmpty(q: string): Promise<VectorSearchHit[]> {
    if (!this.embedder.isReady()) return [];
    try {
      const vec = await this.embedder.embedQuery(q);
      return await this.vectors.searchVector(vec, VECTOR_TOP_K);
    } catch (err) {
      console.error('Vector search failed, falling back to BM25 only:', err);
      return [];
    }
  }

  private fuse(
    bm25Hits: SearchHitRow[],
    vectorHits: VectorSearchHit[],
    scope: string[] | undefined,
  ): CandidatePool {
    const pool: CandidatePool = new Map();

    // BM25 hits already carry f.source_id filter via searchFts. Look up
    // source_id for each so we can apply the same scope filter to vectors.
    const bmChunkIds = bm25Hits.map((h) => h.chunkId);
    const bmMeta = this.store.getChunkMeta(bmChunkIds);

    bm25Hits.forEach((hit, i) => {
      const meta = bmMeta.get(hit.chunkId);
      if (!meta) return;
      pool.set(hit.chunkId, {
        chunkId: hit.chunkId,
        fileId: hit.fileId,
        text: hit.text,
        path: hit.path,
        sourceId: meta.sourceId,
        mtime: hit.mtime,
        location: parseLocation(meta.metadata),
        bm25Rank: i,
        bm25Score: hit.bm25,
      });
    });

    // Enrich vector hits with path + sourceId. Drop any whose sourceId
    // falls outside the scope — vector search has no native filter.
    const vecChunkIds = vectorHits.map((h) => h.chunkId);
    const vecMeta = this.store.getChunkMeta(vecChunkIds);

    vectorHits.forEach((hit, i) => {
      const existing = pool.get(hit.chunkId);
      if (existing) {
        existing.vectorRank = i;
        existing.vectorDistance = hit.distance;
        return;
      }
      const meta = vecMeta.get(hit.chunkId);
      if (!meta) return; // chunk purged since embed; skip
      if (scope !== undefined && !scope.includes(meta.sourceId)) return;
      pool.set(hit.chunkId, {
        chunkId: hit.chunkId,
        fileId: hit.fileId,
        text: hit.text,
        path: meta.path,
        sourceId: meta.sourceId,
        mtime: meta.mtime,
        location: parseLocation(meta.metadata),
        vectorRank: i,
        vectorDistance: hit.distance,
      });
    });

    return pool;
  }
}

function applyDateFilter(pool: CandidatePool, parsed: ParsedQuery): void {
  if (!parsed.dateAfter && !parsed.dateBefore) return;
  // dateAfter is treated as "on or after midnight"; dateBefore as "before
  // midnight of the next day" so 'before: 2024-03-01' includes 2024-03-01.
  const after = parsed.dateAfter ? Date.parse(`${parsed.dateAfter}T00:00:00Z`) : -Infinity;
  const before = parsed.dateBefore ? Date.parse(`${parsed.dateBefore}T23:59:59Z`) : Infinity;
  const toDelete: string[] = [];
  pool.forEach((c, key) => {
    const ts = Date.parse(c.mtime);
    if (Number.isNaN(ts)) return; // keep — don't filter out bad timestamps
    if (ts < after || ts > before) toDelete.push(key);
  });
  for (const key of toDelete) pool.delete(key);
}

function buildSynthesisPrompt(
  question: string,
  ranked: { text: string; path: string }[],
): { system: string; user: string } {
  const context = ranked
    .map(
      (c, i) =>
        `[${i + 1}] ${c.path}\n${c.text.replace(/\s+/g, ' ').trim().slice(0, 1200)}`,
    )
    .join('\n\n---\n\n');
  const system =
    'You answer questions using the provided file excerpts as primary context, ' +
    'plus any prior turns of this conversation. ' +
    'Cite sources inline as [1], [2], ... matching the excerpt numbers for the CURRENT turn. ' +
    'If the excerpts do not contain the answer, say so plainly — do not speculate. ' +
    'Match the language of the user question.';
  const user = `Question: ${question}\n\nExcerpts:\n${context}`;
  return { system, user };
}

function topSnippet(citations: Citation[]): string {
  return citations[0]?.snippet ?? 'No relevant excerpt found.';
}

function parseLocation(metadataJson: string | null): ChunkLocation | undefined {
  if (!metadataJson) return undefined;
  try {
    const parsed = JSON.parse(metadataJson) as { location?: ChunkLocation };
    return parsed.location;
  } catch {
    return undefined;
  }
}

function makeSnippet(text: string, query: string, context: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  const needle = query
    .split(/\s+/)
    .filter((t) => t.length > 2)
    .map((t) => t.toLowerCase())
    .find((t) => clean.toLowerCase().includes(t));

  if (!needle) {
    return clean.slice(0, context * 2).trim() + (clean.length > context * 2 ? '…' : '');
  }

  const idx = clean.toLowerCase().indexOf(needle);
  const start = Math.max(0, idx - context);
  const end = Math.min(clean.length, idx + needle.length + context);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < clean.length ? '…' : '';
  return prefix + clean.slice(start, end).trim() + suffix;
}
