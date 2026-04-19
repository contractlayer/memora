import type { Parser, ParsedDocument } from './registry';

export class DocxParser implements Parser {
  readonly mimeTypes = [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ];
  readonly extensions = ['docx'];

  async parse(_filePath: string): Promise<ParsedDocument> {
    // TODO(Phase 1, Week 3): mammoth.extractRawText with table handling.
    return { text: '', metadata: {} };
  }
}
