// Approximate token counter. Cheap, tokenizer-free.
// Calibrated against BGE-M3 SentencePiece tokenizer on mixed English + Vietnamese text.
// Final chunk boundaries are not tokenizer-exact; embedding path re-verifies length.

const ASCII_CHARS_PER_TOKEN = 4;
const CJK_CHARS_PER_TOKEN = 1.5;

export function estimateTokens(text: string): number {
  if (text.length === 0) return 0;
  let ascii = 0;
  let wide = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) ascii++;
    else wide++;
  }
  return Math.ceil(ascii / ASCII_CHARS_PER_TOKEN + wide / CJK_CHARS_PER_TOKEN);
}
