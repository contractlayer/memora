import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import type { Parser, ParsedDocument } from './registry';

const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  py: 'python',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  rb: 'ruby',
  php: 'php',
  c: 'c',
  cc: 'cpp',
  cpp: 'cpp',
  h: 'c',
  hpp: 'cpp',
  cs: 'csharp',
  swift: 'swift',
  scala: 'scala',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  sql: 'sql',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  json: 'json',
};

export class CodeParser implements Parser {
  readonly mimeTypes = ['text/x-source'];
  readonly extensions = Object.keys(EXTENSION_TO_LANGUAGE);

  async parse(filePath: string): Promise<ParsedDocument> {
    // TODO(Phase 1 v1.1): tree-sitter symbol-aware parsing. For v1 ship, we read
    // the file as text and rely on the generic text chunker. Symbol-aware
    // chunking is a search-quality improvement we can add without touching
    // callers — the parser contract stays the same.
    const text = await readFile(filePath, 'utf-8');
    const ext = filePath.toLowerCase().split('.').pop() ?? '';
    return {
      text,
      metadata: {
        language: EXTENSION_TO_LANGUAGE[ext] ?? 'text',
        filename: basename(filePath),
      },
    };
  }
}
