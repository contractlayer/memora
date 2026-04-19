import type { Parser, ParsedDocument } from './registry';

export class PdfParser implements Parser {
  readonly mimeTypes = ['application/pdf'];
  readonly extensions = ['pdf'];

  async parse(_filePath: string): Promise<ParsedDocument> {
    // TODO(Phase 1, Week 3): use pdfjs-dist to extract text + page map + bbox
    // for citation highlight.
    return { text: '', pages: [], metadata: {} };
  }
}
