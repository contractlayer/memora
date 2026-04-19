import type { Parser, ParsedDocument } from './registry';

export class CodeParser implements Parser {
  readonly mimeTypes = ['text/x-source'];
  readonly extensions = [
    'ts', 'tsx', 'js', 'jsx', 'py', 'go', 'rs', 'java', 'kt',
    'rb', 'php', 'c', 'cc', 'cpp', 'h', 'hpp', 'cs', 'swift',
    'scala', 'sh', 'bash', 'zsh', 'sql', 'yaml', 'yml', 'toml', 'json',
  ];

  async parse(_filePath: string): Promise<ParsedDocument> {
    // TODO(Phase 1, Week 2): tree-sitter symbol-aware parsing.
    // Emit ParsedDocument with symbol map so chunker can group by function/class.
    return { text: '', metadata: { symbols: [] } };
  }
}
