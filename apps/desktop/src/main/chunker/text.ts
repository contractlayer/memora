import { createHash } from 'node:crypto';
import { estimateTokens } from './tokens';

export type Chunk = {
  id: string;
  text: string;
  tokenCount: number;
  byteStart: number;
  byteEnd: number;
  sha256: string;
  metadata: Record<string, unknown>;
};

export type ChunkOptions = {
  targetTokens?: number;
  overlapTokens?: number;
  minTokens?: number;
  idPrefix?: string;
};

const DEFAULT_TARGET = 500;
const DEFAULT_OVERLAP = 50;
const DEFAULT_MIN = 40;

// Recursive splitter: try progressively finer separators until a block fits.
// Order matters — keeps paragraph > sentence > line > word > char.
const SEPARATORS = ['\n\n', '\n', '. ', '? ', '! ', '; ', ', ', ' '] as const;

export function chunkText(input: { text: string; options?: ChunkOptions }): Chunk[] {
  const { text } = input;
  const opts = {
    target: input.options?.targetTokens ?? DEFAULT_TARGET,
    overlap: input.options?.overlapTokens ?? DEFAULT_OVERLAP,
    min: input.options?.minTokens ?? DEFAULT_MIN,
    prefix: input.options?.idPrefix ?? 'c',
  };

  if (text.trim().length === 0) return [];

  const pieces = split(text, opts.target);

  // Walk pieces with byte offsets, group into chunks ~target tokens, with overlap.
  const chunks: Chunk[] = [];
  let buffer: { text: string; start: number; end: number; tokens: number }[] = [];
  let bufferTokens = 0;
  let ordinal = 0;
  let cursor = 0;

  const enc = new TextEncoder();

  for (const piece of pieces) {
    const byteStart = cursor;
    const byteEnd = cursor + enc.encode(piece).byteLength;
    cursor = byteEnd;
    const t = estimateTokens(piece);

    if (bufferTokens + t > opts.target && bufferTokens >= opts.min) {
      chunks.push(flush(buffer, ordinal++, opts.prefix));
      // Keep tail for overlap.
      buffer = takeOverlap(buffer, opts.overlap);
      bufferTokens = buffer.reduce((sum, p) => sum + p.tokens, 0);
    }

    buffer.push({ text: piece, start: byteStart, end: byteEnd, tokens: t });
    bufferTokens += t;
  }

  if (buffer.length > 0 && bufferTokens >= 1) {
    chunks.push(flush(buffer, ordinal++, opts.prefix));
  }

  return chunks;
}

function flush(
  buffer: { text: string; start: number; end: number; tokens: number }[],
  ordinal: number,
  prefix: string,
): Chunk {
  const first = buffer[0]!;
  const last = buffer[buffer.length - 1]!;
  const text = buffer.map((p) => p.text).join('');
  const tokens = buffer.reduce((sum, p) => sum + p.tokens, 0);
  const sha = createHash('sha256').update(text).digest('hex');
  return {
    id: `${prefix}-${ordinal}-${sha.slice(0, 10)}`,
    text,
    tokenCount: tokens,
    byteStart: first.start,
    byteEnd: last.end,
    sha256: sha,
    metadata: {},
  };
}

function takeOverlap(
  buffer: { text: string; start: number; end: number; tokens: number }[],
  overlap: number,
): { text: string; start: number; end: number; tokens: number }[] {
  if (overlap <= 0) return [];
  const out: typeof buffer = [];
  let acc = 0;
  for (let i = buffer.length - 1; i >= 0; i--) {
    const p = buffer[i]!;
    out.unshift(p);
    acc += p.tokens;
    if (acc >= overlap) break;
  }
  return out;
}

// Recursive splitter: returns pieces whose individual token count is ≤ targetTokens.
// Each piece retains its original separator so joining them reproduces the source text.
function split(text: string, targetTokens: number, depth = 0): string[] {
  if (estimateTokens(text) <= targetTokens) return [text];
  if (depth >= SEPARATORS.length) {
    // Hard fallback: split by fixed char window sized to target tokens.
    const approxCharsPerToken = 4;
    const window = Math.max(1, targetTokens * approxCharsPerToken);
    const out: string[] = [];
    for (let i = 0; i < text.length; i += window) {
      out.push(text.slice(i, i + window));
    }
    return out;
  }

  const sep = SEPARATORS[depth]!;
  const parts = splitKeepSeparator(text, sep);
  const out: string[] = [];
  for (const part of parts) {
    if (estimateTokens(part) <= targetTokens) {
      out.push(part);
    } else {
      out.push(...split(part, targetTokens, depth + 1));
    }
  }
  return out;
}

function splitKeepSeparator(text: string, sep: string): string[] {
  if (sep.length === 0 || !text.includes(sep)) return [text];
  const out: string[] = [];
  let start = 0;
  let idx = text.indexOf(sep, start);
  while (idx !== -1) {
    out.push(text.slice(start, idx + sep.length));
    start = idx + sep.length;
    idx = text.indexOf(sep, start);
  }
  if (start < text.length) out.push(text.slice(start));
  return out;
}
