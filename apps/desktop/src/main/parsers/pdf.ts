import { readFile } from 'node:fs/promises';
import type { Parser, ParsedDocument, ParsedPage } from './registry';

type PdfjsLegacy = {
  getDocument: (params: Record<string, unknown>) => {
    promise: Promise<PdfDocument>;
  };
};

type PdfDocument = {
  numPages: number;
  getPage: (n: number) => Promise<PdfPage>;
  destroy: () => Promise<void>;
};

type PdfPage = {
  getTextContent: () => Promise<{ items: PdfTextItem[] }>;
};

type PdfTextItem = {
  str?: string;
  hasEOL?: boolean;
};

const PARSE_TIMEOUT_MS = 60_000; // kill runaway pdf jobs (scanned PDFs can loop)
const MAX_PAGES = 500;            // bound work for 1k-page beasts

export class PdfParser implements Parser {
  readonly mimeTypes = ['application/pdf'];
  readonly extensions = ['pdf'];

  async parse(filePath: string): Promise<ParsedDocument> {
    return withTimeout(this.parseInner(filePath), PARSE_TIMEOUT_MS, filePath);
  }

  private async parseInner(filePath: string): Promise<ParsedDocument> {
    // Legacy build is built for Node/Electron — no DOMMatrix/Path2D dependency.
    const pdfjs = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as PdfjsLegacy;
    const data = await readFile(filePath);
    const doc = await pdfjs.getDocument({
      data: new Uint8Array(data),
      // Defensive flags — keep pdfjs in a minimal-feature mode so malformed
      // or unusually-fonted PDFs can't wander into code paths that segfault
      // against missing runtime facilities.
      isEvalSupported: false,
      disableFontFace: true,
      useSystemFonts: false,
      useWorkerFetch: false,
      stopAtErrors: true,
    }).promise;

    const rawPages: { page: number; text: string }[] = [];
    const pageLimit = Math.min(doc.numPages, MAX_PAGES);
    try {
      for (let i = 1; i <= pageLimit; i++) {
        try {
          const page = await doc.getPage(i);
          const content = await page.getTextContent();
          const text = content.items
            .map((item) => (item.str ?? '') + (item.hasEOL ? '\n' : ''))
            .join('')
            .replace(/[ \t]+/g, ' ')
            .trim();
          rawPages.push({ page: i, text });
        } catch (err) {
          console.warn(`[pdf] skipping page ${i} of ${filePath}:`, (err as Error).message);
          rawPages.push({ page: i, text: '' });
        }
      }
    } finally {
      try {
        await doc.destroy();
      } catch {
        // swallow — best-effort cleanup
      }
    }

    return joinPages(rawPages, '\n\n', {
      pageCount: rawPages.length,
      truncated: doc.numPages > pageLimit,
    });
  }
}

/**
 * Join page texts with a separator and record exact byte offsets per page,
 * so downstream code can map chunk byte ranges back to page numbers.
 */
export function joinPages(
  rawPages: { page: number; text: string; label?: string }[],
  separator: string,
  metadata: Record<string, unknown>,
): ParsedDocument {
  const enc = new TextEncoder();
  const sepBytes = enc.encode(separator).byteLength;
  const pages: ParsedPage[] = [];
  const parts: string[] = [];
  let cursor = 0;
  rawPages.forEach((p, i) => {
    if (i > 0) {
      parts.push(separator);
      cursor += sepBytes;
    }
    const start = cursor;
    const bytes = enc.encode(p.text).byteLength;
    parts.push(p.text);
    cursor += bytes;
    pages.push({
      page: p.page,
      text: p.text,
      byteStart: start,
      byteEnd: cursor,
      label: p.label,
    });
  });
  return {
    text: parts.join(''),
    pages,
    metadata,
  };
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`PDF parse timeout after ${ms}ms: ${label}`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}
