import { describe, it, expect } from 'vitest';
import { buildParserRegistry } from './index';

describe('buildParserRegistry', () => {
  const registry = buildParserRegistry();

  it.each([
    ['note.txt', 'TextParser'],
    ['README.md', 'TextParser'],
    ['spec.markdown', 'TextParser'],
    ['report.pdf', 'PdfParser'],
    ['letter.docx', 'DocxParser'],
    ['app.ts', 'CodeParser'],
    ['handler.py', 'CodeParser'],
    ['config.yaml', 'CodeParser'],
  ])('resolves %s to a parser', (filename) => {
    const parser = registry.resolve(filename);
    expect(parser).not.toBeNull();
  });

  it('returns null for unsupported extensions', () => {
    expect(registry.resolve('video.mp4')).toBeNull();
    expect(registry.resolve('image.png')).toBeNull();
    expect(registry.resolve('unknown')).toBeNull();
  });

  it('is case-insensitive on extension', () => {
    expect(registry.resolve('Notes.TXT')).not.toBeNull();
    expect(registry.resolve('REPORT.PDF')).not.toBeNull();
  });
});
