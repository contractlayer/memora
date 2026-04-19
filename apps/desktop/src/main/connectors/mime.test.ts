import { describe, it, expect } from 'vitest';
import { isJunkFile, isSupported, mimeFromPath } from './mime';

describe('isJunkFile', () => {
  it('matches macOS AppleDouble files', () => {
    expect(isJunkFile('/folder/._Banner.php')).toBe(true);
    expect(isJunkFile('/x/y/._index.ts')).toBe(true);
    expect(isJunkFile('._README.md')).toBe(true);
  });

  it('matches macOS + Windows metadata', () => {
    expect(isJunkFile('/x/.DS_Store')).toBe(true);
    expect(isJunkFile('/x/Thumbs.db')).toBe(true);
    expect(isJunkFile('/x/thumbs.DB')).toBe(true);
    expect(isJunkFile('/x/desktop.ini')).toBe(true);
    expect(isJunkFile('/x/.localized')).toBe(true);
  });

  it('does not match real files that share an extension with AppleDouble junk', () => {
    expect(isJunkFile('/x/Banner.php')).toBe(false);
    expect(isJunkFile('/x/index.ts')).toBe(false);
    expect(isJunkFile('/x/notes.md')).toBe(false);
  });
});

describe('isSupported respects junk filter', () => {
  it('rejects AppleDouble even when the extension is supported', () => {
    expect(isSupported('/x/._Banner.php')).toBe(false);
    expect(isSupported('/x/Banner.php')).toBe(true);
  });

  it('returns null mime for junk', () => {
    expect(mimeFromPath('/x/._report.pdf')).toBeNull();
    expect(mimeFromPath('/x/report.pdf')).toBe('application/pdf');
  });
});
