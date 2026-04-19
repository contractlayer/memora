import { describe, it, expect } from 'vitest';
import { chunkText } from './text';
import { estimateTokens } from './tokens';

describe('chunkText', () => {
  it('returns empty array for empty input', () => {
    expect(chunkText({ text: '' })).toEqual([]);
    expect(chunkText({ text: '   \n  ' })).toEqual([]);
  });

  it('produces one chunk for short text', () => {
    const result = chunkText({ text: 'Hello world. This is short.' });
    expect(result).toHaveLength(1);
    expect(result[0]!.text).toBe('Hello world. This is short.');
    expect(result[0]!.byteStart).toBe(0);
  });

  it('splits long text into multiple chunks under the token target', () => {
    const paragraph =
      'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(50);
    const result = chunkText({
      text: paragraph,
      options: { targetTokens: 100, overlapTokens: 10 },
    });
    expect(result.length).toBeGreaterThan(1);
    for (const chunk of result) {
      expect(chunk.tokenCount).toBeLessThanOrEqual(150); // allow some slack from overlap+trailing piece
    }
  });

  it('assigns stable deterministic chunk ids based on content hash', () => {
    const text = 'The quick brown fox jumps over the lazy dog. '.repeat(100);
    const a = chunkText({ text, options: { targetTokens: 50 } });
    const b = chunkText({ text, options: { targetTokens: 50 } });
    expect(a.map((c) => c.id)).toEqual(b.map((c) => c.id));
    expect(a.map((c) => c.sha256)).toEqual(b.map((c) => c.sha256));
  });

  it('preserves byte ranges that cover the full text', () => {
    const text = 'Paragraph one.\n\nParagraph two is a bit longer than the first.';
    const chunks = chunkText({ text, options: { targetTokens: 20, overlapTokens: 0 } });
    // Without overlap, chunk byte ranges should collectively span the original bytes.
    const enc = new TextEncoder();
    const totalBytes = enc.encode(text).byteLength;
    const lastEnd = chunks[chunks.length - 1]!.byteEnd;
    expect(lastEnd).toBe(totalBytes);
    expect(chunks[0]!.byteStart).toBe(0);
  });
});

describe('estimateTokens', () => {
  it('returns 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('uses higher density for CJK / wide chars', () => {
    const englishTokens = estimateTokens('a'.repeat(100));
    const vietnameseTokens = estimateTokens('ế'.repeat(100));
    expect(vietnameseTokens).toBeGreaterThan(englishTokens);
  });

  it('increases monotonically with length', () => {
    expect(estimateTokens('a'.repeat(200))).toBeGreaterThan(estimateTokens('a'.repeat(100)));
  });
});
