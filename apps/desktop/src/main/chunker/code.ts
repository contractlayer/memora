import { createHash } from 'node:crypto';
import { estimateTokens } from './tokens';
import { chunkText, type Chunk } from './text';

// Symbol-aware code chunking via regex patterns per language. Each top-level
// symbol (function / class / struct / impl) becomes its own chunk so search
// for "function authenticate" returns the full function, not a chopped middle.
//
// We chose regex over tree-sitter for v1: no WASM bundling in Electron, no
// per-language grammar downloads, works for ~90% of the benefit on the
// languages we care about. The parser contract is unchanged so a real
// tree-sitter upgrade is a drop-in later.

const MAX_CHUNK_TOKENS = 800;    // split large functions further via text chunker
const MIN_CHUNK_TOKENS = 30;     // merge trivial 2-line symbols up

type SymbolMatch = {
  name: string;
  byteOffset: number;
};

// Each regex captures the symbol name in group 1. Patterns are intentionally
// permissive — false positives cost little (extra chunk boundary), misses
// are worse (function spans two chunks).
const LANGUAGE_PATTERNS: Record<string, RegExp[]> = {
  typescript: [
    /^\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)/gm,
    /^\s*(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/gm,
    /^\s*(?:export\s+)?interface\s+(\w+)/gm,
    /^\s*(?:export\s+)?type\s+(\w+)\s*=/gm,
    /^\s*(?:export\s+)?const\s+(\w+)\s*(?::\s*[^=]+)?=\s*(?:async\s+)?\(/gm,
    /^\s{2,}(?:public\s+|private\s+|protected\s+|static\s+|async\s+)*(\w+)\s*\([^)]*\)\s*[:{]/gm,
  ],
  javascript: [
    /^\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)/gm,
    /^\s*(?:export\s+)?class\s+(\w+)/gm,
    /^\s*(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s+)?\(/gm,
    /^\s{2,}(?:async\s+|static\s+)*(\w+)\s*\([^)]*\)\s*\{/gm,
  ],
  python: [
    /^\s*(?:async\s+)?def\s+(\w+)/gm,
    /^\s*class\s+(\w+)/gm,
  ],
  go: [
    /^func\s+(?:\(\s*\w+\s+\*?\w+\s*\)\s+)?(\w+)/gm,
    /^type\s+(\w+)\s+(?:struct|interface)/gm,
  ],
  rust: [
    /^\s*(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/gm,
    /^\s*(?:pub\s+)?struct\s+(\w+)/gm,
    /^\s*(?:pub\s+)?enum\s+(\w+)/gm,
    /^\s*(?:pub\s+)?trait\s+(\w+)/gm,
    /^\s*impl(?:<[^>]+>)?\s+(?:\w+\s+for\s+)?(\w+)/gm,
  ],
  java: [
    /^\s*(?:public\s+|private\s+|protected\s+|static\s+|final\s+|abstract\s+)*class\s+(\w+)/gm,
    /^\s*(?:public\s+|private\s+|protected\s+|static\s+|final\s+|abstract\s+)*interface\s+(\w+)/gm,
    /^\s{2,}(?:public\s+|private\s+|protected\s+|static\s+|final\s+|abstract\s+)*[\w<>[\],\s]+\s+(\w+)\s*\([^)]*\)\s*(?:throws\s+[\w,\s]+)?\s*\{/gm,
  ],
  csharp: [
    /^\s*(?:public\s+|private\s+|protected\s+|internal\s+|static\s+|abstract\s+|sealed\s+)*class\s+(\w+)/gm,
    /^\s*(?:public\s+|private\s+|protected\s+|internal\s+)*interface\s+(\w+)/gm,
    /^\s{2,}(?:public\s+|private\s+|protected\s+|internal\s+|static\s+|async\s+|virtual\s+|override\s+)*[\w<>[\],\s]+\s+(\w+)\s*\([^)]*\)\s*\{/gm,
  ],
  cpp: [
    /^[\w<>:*&,\s]+\s+(\w+)\s*\([^)]*\)\s*(?:const\s*)?\{/gm,
    /^(?:class|struct)\s+(\w+)/gm,
  ],
  c: [
    /^[\w*&\s]+\s+(\w+)\s*\([^)]*\)\s*\{/gm,
    /^struct\s+(\w+)/gm,
  ],
  ruby: [
    /^\s*def\s+(\w+)/gm,
    /^\s*class\s+(\w+)/gm,
    /^\s*module\s+(\w+)/gm,
  ],
  php: [
    /^\s*(?:public\s+|private\s+|protected\s+|static\s+)*function\s+(\w+)/gm,
    /^\s*(?:abstract\s+|final\s+)*class\s+(\w+)/gm,
    /^\s*interface\s+(\w+)/gm,
  ],
  swift: [
    /^\s*(?:public\s+|private\s+|internal\s+|fileprivate\s+|open\s+|static\s+)*func\s+(\w+)/gm,
    /^\s*(?:public\s+|private\s+|internal\s+|open\s+|final\s+)*class\s+(\w+)/gm,
    /^\s*(?:public\s+)?struct\s+(\w+)/gm,
    /^\s*(?:public\s+)?protocol\s+(\w+)/gm,
  ],
  kotlin: [
    /^\s*(?:public\s+|private\s+|internal\s+|protected\s+|suspend\s+)*fun\s+(?:<[^>]+>\s+)?(?:\w+\.)?(\w+)/gm,
    /^\s*(?:public\s+|private\s+|internal\s+|open\s+|abstract\s+|data\s+)*class\s+(\w+)/gm,
  ],
  scala: [
    /^\s*(?:def|val|var)\s+(\w+)/gm,
    /^\s*(?:case\s+)?(?:class|object|trait)\s+(\w+)/gm,
  ],
};

export function chunkCode(input: {
  text: string;
  language: string;
  idPrefix?: string;
}): Chunk[] {
  const { text, language } = input;
  const prefix = input.idPrefix ?? 'c';
  if (text.trim().length === 0) return [];

  const patterns = LANGUAGE_PATTERNS[language];
  if (!patterns) {
    // Unknown language → fall back to generic text chunker.
    return chunkText({ text, options: { idPrefix: prefix } });
  }

  const symbols = findSymbols(text, patterns);
  if (symbols.length === 0) {
    return chunkText({ text, options: { idPrefix: prefix } });
  }

  return buildChunks(text, symbols, prefix, language);
}

function findSymbols(text: string, patterns: RegExp[]): SymbolMatch[] {
  const seen = new Set<number>();
  const out: SymbolMatch[] = [];
  for (const re of patterns) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (seen.has(m.index)) continue;
      seen.add(m.index);
      out.push({
        name: m[1] ?? '<anon>',
        byteOffset: m.index,
      });
    }
  }
  return out.sort((a, b) => a.byteOffset - b.byteOffset);
}

function buildChunks(
  text: string,
  symbols: SymbolMatch[],
  prefix: string,
  language: string,
): Chunk[] {
  const chunks: Chunk[] = [];
  const enc = new TextEncoder();
  let ordinal = 0;

  // Prepend any pre-symbol preamble (imports, license, top-level statements)
  // as the first chunk so nothing gets lost.
  if (symbols[0]!.byteOffset > 0) {
    const preamble = text.slice(0, symbols[0]!.byteOffset);
    if (preamble.trim().length > 0) {
      chunks.push(
        ...splitOrEmit(
          preamble,
          0,
          enc.encode(preamble).byteLength,
          '<preamble>',
          ordinal,
          prefix,
          language,
        ),
      );
      ordinal = chunks.length;
    }
  }

  for (let i = 0; i < symbols.length; i++) {
    const start = symbols[i]!.byteOffset;
    const end = i + 1 < symbols.length ? symbols[i + 1]!.byteOffset : text.length;
    const body = text.slice(start, end);
    if (body.trim().length === 0) continue;

    // Merge tiny symbols (e.g. one-line getters) into the previous chunk to
    // avoid embedding dozens of 5-token fragments.
    const tokens = estimateTokens(body);
    const prev = chunks[chunks.length - 1];
    if (tokens < MIN_CHUNK_TOKENS && prev && estimateTokens(prev.text) + tokens <= MAX_CHUNK_TOKENS) {
      prev.text = prev.text + body;
      prev.tokenCount = estimateTokens(prev.text);
      prev.byteEnd = prev.byteStart + enc.encode(prev.text).byteLength;
      prev.sha256 = createHash('sha256').update(prev.text).digest('hex');
      prev.id = `${prefix}-${chunks.length - 1}-${prev.sha256.slice(0, 10)}`;
      (prev.metadata as { symbols?: string[] }).symbols = [
        ...(((prev.metadata as { symbols?: string[] }).symbols) ?? []),
        symbols[i]!.name,
      ];
      continue;
    }

    chunks.push(
      ...splitOrEmit(body, start, start + enc.encode(body).byteLength, symbols[i]!.name, ordinal, prefix, language),
    );
    ordinal = chunks.length;
  }

  return chunks;
}

function splitOrEmit(
  text: string,
  byteStart: number,
  byteEnd: number,
  symbol: string,
  startOrdinal: number,
  prefix: string,
  language: string,
): Chunk[] {
  const tokens = estimateTokens(text);
  if (tokens <= MAX_CHUNK_TOKENS) {
    const sha = createHash('sha256').update(text).digest('hex');
    return [
      {
        id: `${prefix}-${startOrdinal}-${sha.slice(0, 10)}`,
        text,
        tokenCount: tokens,
        byteStart,
        byteEnd,
        sha256: sha,
        metadata: { symbols: [symbol], language },
      },
    ];
  }
  // Large symbol → fall back to text splitting, but tag all pieces with
  // the symbol name so citations still point at the right function.
  const pieces = chunkText({
    text,
    options: { idPrefix: prefix, targetTokens: MAX_CHUNK_TOKENS },
  });
  return pieces.map((p, i) => ({
    ...p,
    id: `${prefix}-${startOrdinal + i}-${p.sha256.slice(0, 10)}`,
    byteStart: byteStart + p.byteStart,
    byteEnd: byteStart + p.byteEnd,
    metadata: { ...p.metadata, symbols: [symbol], language, split: true },
  }));
}
