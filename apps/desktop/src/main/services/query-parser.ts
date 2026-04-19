import type { LlmRouter } from './llm-router';

export type ParsedQuery = {
  /** Inclusive. ISO date string. */
  dateAfter?: string;
  /** Inclusive. ISO date string. */
  dateBefore?: string;
};

/**
 * Cheap heuristic — do we even need to bother calling the LLM to parse dates?
 * If the question has no time-related words, return false and skip the call.
 *
 * Covers the most common Vietnamese + English time vocabulary we expect.
 * Over-triggering is fine: a false positive just costs 1 extra LLM call that
 * returns {} and the normal flow continues.
 */
export function hasTimeIntent(q: string): boolean {
  const lower = q.toLowerCase();
  if (
    /\b(today|yesterday|tomorrow|this (week|month|year|quarter)|last (week|month|year|quarter)|recent|recently|ago|since|before|after|between|during|in 20\d\d|in \d\d\d\d|q[1-4]\s*20\d\d)\b/i.test(
      lower,
    )
  ) {
    return true;
  }
  // Vietnamese time vocab (no word boundaries — Unicode words don't match \b in JS).
  const vnPatterns = [
    'hôm nay',
    'hôm qua',
    'ngày mai',
    'tuần này',
    'tuần trước',
    'tuần rồi',
    'tháng này',
    'tháng trước',
    'năm nay',
    'năm ngoái',
    'năm trước',
    'gần đây',
    'vừa rồi',
    'mới đây',
    'trước đây',
  ];
  for (const p of vnPatterns) if (lower.includes(p)) return true;
  // Bare years / ISO dates.
  if (/\b(19|20)\d{2}\b/.test(lower)) return true;
  if (/\d{4}-\d{2}-\d{2}/.test(lower)) return true;
  return false;
}

export class QueryParser {
  constructor(private readonly llmRouter: LlmRouter) {}

  async parse(question: string, now: Date = new Date()): Promise<ParsedQuery> {
    if (!hasTimeIntent(question)) return {};
    const client = await this.llmRouter.resolve();
    if (!client) return {};

    const today = now.toISOString().slice(0, 10);
    const system =
      'Extract a date range from the user question. ' +
      'Respond with ONE JSON object only, nothing else. ' +
      'Schema: {"dateAfter":"YYYY-MM-DD"|null,"dateBefore":"YYYY-MM-DD"|null}. ' +
      `Today is ${today}. Interpret relative phrases like "last week", "tuần trước", "năm ngoái" against today. ` +
      'If the question has no time constraint, return {"dateAfter":null,"dateBefore":null}. ' +
      'Do not wrap in code fences or add commentary.';

    try {
      const text = await client.chat(
        [
          { role: 'system', content: system },
          { role: 'user', content: `Question: ${question}` },
        ],
        { temperature: 0, maxTokens: 128 },
      );
      return parseResponse(text);
    } catch (err) {
      console.warn('[query-parser] LLM call failed:', err);
      return {};
    }
  }
}

function parseResponse(text: string): ParsedQuery {
  // Strip code fences if present, pull out the first {...} block.
  const cleaned = text.replace(/```(?:json)?\s*/g, '').replace(/```/g, '').trim();
  const match = cleaned.match(/\{[\s\S]*?\}/);
  if (!match) return {};
  try {
    const obj = JSON.parse(match[0]) as { dateAfter?: string | null; dateBefore?: string | null };
    const out: ParsedQuery = {};
    if (obj.dateAfter && /^\d{4}-\d{2}-\d{2}/.test(obj.dateAfter)) {
      out.dateAfter = obj.dateAfter.slice(0, 10);
    }
    if (obj.dateBefore && /^\d{4}-\d{2}-\d{2}/.test(obj.dateBefore)) {
      out.dateBefore = obj.dateBefore.slice(0, 10);
    }
    return out;
  } catch {
    return {};
  }
}
