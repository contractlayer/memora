import ExcelJS from 'exceljs';
import type { Parser, ParsedDocument } from './registry';
import { joinPages } from './pdf';

const MAX_ROWS_PER_SHEET = 10_000; // bound work for million-row dumps
const MAX_CELL_CHARS = 2_000;       // truncate pathological long-cell blobs

export class XlsxParser implements Parser {
  readonly mimeTypes = [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
  ];
  readonly extensions = ['xlsx', 'xls'];

  async parse(filePath: string): Promise<ParsedDocument> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);

    const rawPages: { page: number; text: string; label?: string }[] = [];
    let sheetIndex = 0;
    let truncatedRows = false;

    workbook.eachSheet((worksheet) => {
      sheetIndex++;
      const lines: string[] = [`## Sheet: ${worksheet.name}`];
      let rowCount = 0;

      worksheet.eachRow({ includeEmpty: false }, (row) => {
        if (rowCount >= MAX_ROWS_PER_SHEET) {
          truncatedRows = true;
          return;
        }
        const cells: string[] = [];
        const values = row.values as unknown[];
        // ExcelJS row.values is 1-indexed; skip [0].
        for (let i = 1; i < values.length; i++) {
          cells.push(formatCell(values[i]));
        }
        if (cells.some((c) => c.length > 0)) {
          lines.push(`| ${cells.join(' | ')} |`);
        }
        rowCount++;
      });

      rawPages.push({
        page: sheetIndex,
        text: lines.join('\n'),
        label: worksheet.name,
      });
    });

    return joinPages(rawPages, '\n\n---\n\n', {
      sheetCount: sheetIndex,
      truncated: truncatedRows,
    });
  }
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return clamp(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString();
  // Rich text: { richText: [{ text }] }
  if (typeof value === 'object' && 'richText' in value) {
    const parts = (value as { richText: { text?: string }[] }).richText;
    return clamp(parts.map((p) => p.text ?? '').join(''));
  }
  // Hyperlinks: { text, hyperlink }
  if (typeof value === 'object' && 'text' in value) {
    return clamp(String((value as { text?: unknown }).text ?? ''));
  }
  // Formulas: { formula, result }
  if (typeof value === 'object' && 'result' in value) {
    return formatCell((value as { result: unknown }).result);
  }
  return '';
}

function clamp(s: string): string {
  return s.length > MAX_CELL_CHARS ? `${s.slice(0, MAX_CELL_CHARS)}…` : s;
}
