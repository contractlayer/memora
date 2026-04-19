import type { ParsedPage } from '@main/parsers/registry';
import type { ChunkLocation } from '@shared/ipc';

/**
 * Precomputed line-break byte offsets so we can binary-search a byte offset
 * back to a 1-indexed line number in O(log n) per lookup.
 */
export type LineIndex = number[];

/**
 * Build an index of byte offsets where each line starts. Line 1 starts at
 * byte 0. If text is empty, returns [0].
 */
export function buildLineIndex(text: string): LineIndex {
  const enc = new TextEncoder();
  const starts: number[] = [0];
  let byteCursor = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    byteCursor += enc.encode(ch).length;
    if (ch === '\n') starts.push(byteCursor);
  }
  return starts;
}

/** 1-indexed line containing the given byte offset. */
export function lineOfByte(lineIndex: LineIndex, byteOffset: number): number {
  let lo = 0;
  let hi = lineIndex.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineIndex[mid]! <= byteOffset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

/**
 * Derive location metadata for a chunk given its byte range in the parent
 * document. Returns undefined when nothing useful can be attached (e.g. DOCX
 * with no page info and we're not tracking lines for that MIME).
 */
export function computeLocation(args: {
  mime: string;
  byteStart: number;
  byteEnd: number;
  pages?: ParsedPage[];
  lineIndex?: LineIndex;
  symbol?: string;
}): ChunkLocation | undefined {
  const { mime, byteStart, byteEnd, pages, lineIndex, symbol } = args;
  const loc: ChunkLocation = {};

  if (pages && pages.length > 0) {
    const first = findPage(pages, byteStart);
    const last = findPage(pages, Math.max(byteStart, byteEnd - 1));
    if (first) {
      loc.pageStart = first.page;
      if (last && last.page !== first.page) loc.pageEnd = last.page;

      if (mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
          mime === 'application/vnd.ms-excel') {
        if (first.label) loc.sheet = first.label;
      } else if (
        mime === 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
      ) {
        loc.slide = first.page;
      }
    }
  }

  if (lineIndex) {
    loc.lineStart = lineOfByte(lineIndex, byteStart);
    loc.lineEnd = lineOfByte(lineIndex, Math.max(byteStart, byteEnd - 1));
  }

  if (symbol) loc.symbol = symbol;

  return Object.keys(loc).length > 0 ? loc : undefined;
}

function findPage(pages: ParsedPage[], byteOffset: number): ParsedPage | undefined {
  // Linear scan is fine — most files have few pages; PDFs capped at 500.
  // If this ever shows up in a profile, switch to binary search.
  for (const p of pages) {
    if (byteOffset >= p.byteStart && byteOffset < p.byteEnd) return p;
  }
  return pages[pages.length - 1];
}

/** Which MIME types benefit from line-number metadata. */
export function needsLineIndex(mime: string): boolean {
  return (
    mime === 'text/plain' ||
    mime === 'text/markdown' ||
    mime === 'text/x-source'
  );
}
