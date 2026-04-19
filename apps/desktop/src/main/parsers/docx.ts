import mammoth from 'mammoth';
import type { Parser, ParsedDocument } from './registry';

export class DocxParser implements Parser {
  readonly mimeTypes = [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ];
  readonly extensions = ['docx'];

  async parse(filePath: string): Promise<ParsedDocument> {
    const result = await mammoth.extractRawText({ path: filePath });
    return {
      text: result.value,
      metadata: {
        warnings: result.messages.map((m) => m.message),
      },
    };
  }
}
