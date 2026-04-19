import type {
  ChatTurn,
  QueryAskRequest,
  QueryAskResponse,
  Citation,
  ChunkLocation,
} from '@shared/ipc';
import type { SqliteMetadataStore, SearchHitRow } from '@main/storage/metadata';
import type { Embedder } from '@main/services/embedder';
import type { LanceVectorStore, VectorSearchHit } from '@main/services/vector-store';
import type { LlmRouter } from '@main/services/llm-router';

// Pull more candidates than we show so RRF fusion has room to rank.
const BM25_TOP_K = 30;
const VECTOR_TOP_K = 30;
const FINAL_TOP_K = 10;
const SYNTHESIS_TOP_K = 5; // Chunks fed into the LLM for answer synthesis.
const RRF_K = 60; // Standard reciprocal rank fusion constant.
const SNIPPET_CONTEXT_CHARS = 140;

type CandidatePool = Map<
  string,
  {
    chunkId: string;
    fileId: string;
    text: string;
    path: string;
    sourceId: string;
    location?: ChunkLocation;
    bm25Rank?: number;
    vectorRank?: number;
    vectorDistance?: number;
    bm25Score?: number;
  }
>;

export class QueryOrchestrator {
  constructor(
    private readonly store: SqliteMetadataStore,
    private readonly embedder: Embedder,
    private readonly vectors: LanceVectorStore,
    private readonly llmRouter: LlmRouter,
  ) {}

  async ask(req: QueryAskRequest): Promise<QueryAskResponse> {
    const q = req.question.trim();
    if (q.length === 0) {
      return { answer: 'Ask a question about your indexed files.', citations: [] };
    }

    // undefined → no filter, [] → no sources selected (empty result)
    const scope = req.sourceIds;

    const [bm25Hits, vectorHits] = await Promise.all([
      Promise.resolve(this.store.searchFts(q, BM25_TOP_K, scope)),
      this.vectorSearchOrEmpty(q),
    ]);

    const pool = this.fuse(bm25Hits, vectorHits, scope);
    if (pool.size === 0) {
      return {
        answer:
          'No matches yet. Add a folder with text/PDF/DOCX/code files, wait for indexing, then try again.',
        citations: [],
      };
    }

    // RRF score for each candidate, higher = better.
    const ranked = [...pool.values()]
      .map((c) => {
        const bm = c.bm25Rank !== undefined ? 1 / (RRF_K + c.bm25Rank) : 0;
        const vec = c.vectorRank !== undefined ? 1 / (RRF_K + c.vectorRank) : 0;
        return { ...c, rrfScore: bm + vec };
      })
      .sort((a, b) => b.rrfScore - a.rrfScore)
      .slice(0, FINAL_TOP_K);

    const citations: Citation[] = ranked.map((c) => ({
      chunkId: c.chunkId,
      sourceId: c.fileId,
      path: c.path,
      snippet: makeSnippet(c.text, q, SNIPPET_CONTEXT_CHARS),
      score: c.rrfScore,
      location: c.location,
    }));

    const answer = await this.synthesizeOrFallback(q, ranked, citations, req.history ?? []);
    return { answer, citations };
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
      return citations[0]!.snippet;
    }
    try {
      const context = ranked
        .slice(0, SYNTHESIS_TOP_K)
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
      return `[LLM error: ${(err as Error).message}] ${citations[0]!.snippet}`;
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
        location: parseLocation(meta.metadata),
        vectorRank: i,
        vectorDistance: hit.distance,
      });
    });

    return pool;
  }
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
