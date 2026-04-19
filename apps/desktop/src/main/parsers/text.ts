import { readFile } from 'node:fs/promises';
import type { Parser, ParsedDocument } from './registry';

export class TextParser implements Parser {
  readonly mimeTypes = ['text/plain', 'text/markdown'];
  readonly extensions = ['txt', 'md', 'markdown'];

  async parse(filePath: string): Promise<ParsedDocument> {
    const text = await readFile(filePath, 'utf-8');
    return { text, metadata: {} };
  }
}
