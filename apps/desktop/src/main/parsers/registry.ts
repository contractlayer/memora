export type ParsedDocument = {
  text: string;
  pages?: { page: number; text: string }[];
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
