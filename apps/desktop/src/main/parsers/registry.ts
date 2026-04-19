export type ParsedPage = {
  /** 1-indexed page/sheet/slide number. */
  page: number;
  text: string;
  /** Byte offset of this page's first character inside ParsedDocument.text. */
  byteStart: number;
  /** Byte offset (exclusive) of this page's end inside ParsedDocument.text. */
  byteEnd: number;
  /** Optional label — e.g. XLSX sheet name. */
  label?: string;
};

export type ParsedDocument = {
  text: string;
  pages?: ParsedPage[];
  metadata: Record<string, unknown>;
};

export interface Parser {
  readonly mimeTypes: string[];
  readonly extensions: string[];
  parse(filePath: string): Promise<ParsedDocument>;
}

export class ParserRegistry {
  private readonly parsers: Parser[] = [];

  register(parser: Parser): void {
    this.parsers.push(parser);
  }

  resolve(filePath: string): Parser | null {
    const ext = filePath.toLowerCase().split('.').pop() ?? '';
    return this.parsers.find((p) => p.extensions.includes(ext)) ?? null;
  }
}
