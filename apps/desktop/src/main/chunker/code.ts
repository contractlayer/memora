import type { Chunk } from './text';

export function chunkCode(_input: { text: string; symbols: unknown[] }): Chunk[] {
  // TODO(Phase 1): tree-sitter symbol-aware chunking.
  // Each chunk = 1 function/class/module, with metadata.symbolName + range.
  return [];
}
