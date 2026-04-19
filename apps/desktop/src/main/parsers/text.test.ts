import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TextParser } from './text';
import { CodeParser } from './code';

describe('TextParser', () => {
  let dir: string;
  let filePath: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ai-search-text-'));
    filePath = join(dir, 'hello.md');
    await writeFile(filePath, '# Hello\n\nSome *markdown* body.\n', 'utf-8');
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('reads utf-8 file contents', async () => {
    const parsed = await new TextParser().parse(filePath);
    expect(parsed.text).toContain('# Hello');
    expect(parsed.text).toContain('markdown');
  });
});

describe('CodeParser', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ai-search-code-'));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('tags TypeScript files with language=typescript', async () => {
    const path = join(dir, 'sample.ts');
    await writeFile(path, 'export const x = 1;\n', 'utf-8');
    const parsed = await new CodeParser().parse(path);
    expect(parsed.text).toContain('export const x = 1;');
    expect(parsed.metadata['language']).toBe('typescript');
    expect(parsed.metadata['filename']).toBe('sample.ts');
  });

  it('falls back to "text" for unknown extensions in supported list', async () => {
    const path = join(dir, 'config.toml');
    await writeFile(path, 'key = "value"\n', 'utf-8');
    const parsed = await new CodeParser().parse(path);
    expect(parsed.metadata['language']).toBe('toml');
  });
});
