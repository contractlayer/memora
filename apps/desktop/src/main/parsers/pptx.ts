import { parseOffice } from 'officeparser';
import type { OfficeContentNode, OfficeParserAST } from 'officeparser';
import type { Parser, ParsedDocument } from './registry';
import { joinPages } from './pdf';

export class PptxParser implements Parser {
  readonly mimeTypes = [
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ];
  readonly extensions = ['pptx'];

  async parse(filePath: string): Promise<ParsedDocument> {
    const ast = await parseOffice(filePath);

    const rawPages = extractSlides(ast);
    if (rawPages.length === 0) {
      // Fall back to the flat text dump — better to index something than fail.
      return {
        text: ast.toText(),
        metadata: { slideCount: 0 },
      };
    }

    return joinPages(rawPages, '\n\n---\n\n', { slideCount: rawPages.length });
  }
}

function extractSlides(ast: OfficeParserAST): { page: number; text: string }[] {
  const out: { page: number; text: string }[] = [];
  walk(ast.content, (node) => {
    if (node.type !== 'slide') return;
    const n = out.length + 1;
    const header = `## Slide ${n}`;
    const body = nodeText(node).trim();
    if (body.length > 0) {
      out.push({ page: n, text: `${header}\n${body}` });
    }
  });
  return out;
}

function walk(nodes: OfficeContentNode[], visit: (n: OfficeContentNode) => void): void {
  for (const node of nodes) {
    visit(node);
    if (node.children && node.children.length > 0) {
      // Don't recurse *into* slides — their text is captured by nodeText.
      if (node.type !== 'slide') walk(node.children, visit);
    }
  }
}

function nodeText(node: OfficeContentNode): string {
  const parts: string[] = [];
  collectText(node, parts);
  return parts.join('\n').replace(/\n{3,}/g, '\n\n');
}

function collectText(node: OfficeContentNode, out: string[]): void {
  const anyNode = node as OfficeContentNode & { text?: string };
  if (typeof anyNode.text === 'string' && anyNode.text.trim().length > 0) {
    out.push(anyNode.text);
  }
  for (const child of node.children ?? []) {
    collectText(child, out);
  }
}
