import { ParserRegistry } from './registry';
import { TextParser } from './text';
import { PdfParser } from './pdf';
import { DocxParser } from './docx';
import { XlsxParser } from './xlsx';
import { PptxParser } from './pptx';
import { CodeParser } from './code';

export function buildParserRegistry(): ParserRegistry {
  const registry = new ParserRegistry();
  registry.register(new TextParser());
  registry.register(new PdfParser());
  registry.register(new DocxParser());
  registry.register(new XlsxParser());
  registry.register(new PptxParser());
  registry.register(new CodeParser());
  return registry;
}

export { ParserRegistry };
export type { Parser, ParsedDocument } from './registry';
