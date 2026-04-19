export type Chunk = {
  id: string;
  text: string;
  tokenCount: number;
  metadata: Record<string, unknown>;
};

export function chunkText(_input: {
  text: string;
  targetTokens?: number;
  overlapTokens?: number;
}): Chunk[] {
  // TODO(Phase 1): recursive splitter with 500-token chunks, 50-token overlap.
  // Respect paragraph/sentence boundaries. Return chunk metadata with byte offset.
  return [];
}
