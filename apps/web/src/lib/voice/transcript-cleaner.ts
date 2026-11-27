/**
 * Wispr-Flow-style transcript post-processor:
 * removes vocal fillers ("um", "uh", "er"), collapses accidental word stutters,
 * normalizes spoken clinical terms ("bee pee" -> "BP", "s p o 2" -> "SpO2"),
 * and enforces clean sentence capitalization & terminal punctuation.
 */
export function cleanSpokenTranscript(raw: string): string {
  let text = raw.replace(/\s+/g, ' ').trim();
  if (!text) return '';

  // Remove common standalone fillers without altering genuine medical terms
  text = text
    .replace(/\b(u+m+|u+h+|e+r+m*|a+h+|h+m+m+)\b[,.\s]*/gi, ' ')
    .replace(/(?:^|[,.]\s+)(you know|i mean|sort of|kind of|like)\b[,.\s]*/gi, (m, _g, offset) =>
      offset === 0 ? '' : m.startsWith(',') || m.startsWith('.') ? `${m[0]} ` : ' ',
    );

  // Collapse immediate repeated spoken stutters ("I I feel" -> "I feel")
  text = text.replace(/\b([a-zA-Z']+)\s+\1\b/gi, '$1');

  // Normalize spoken clinical terms
  text = text
    .replace(/\b(?:b\s*\.?\s*p\.?|bee\s*pee)\b/gi, 'BP')
    .replace(/\b(?:s\s*p\s*o\s*(?:2|two)|spo\s*(?:2|two)|sp\s*o2)\b/gi, 'SpO2')
    .replace(/\b(?:h\s*r\s*v)\b/gi, 'HRV')
    .replace(/\b(?:beats per minute)\b/gi, 'bpm');

  text = text.replace(/\s+/g, ' ').replace(/\s+([,.!?])/g, '$1').trim();
  if (!text) return '';

  // Capitalize first letter (for Latin scripts) cleanly
  text = text.charAt(0).toUpperCase() + text.slice(1);

  if (!/[.!?।]$/.test(text)) {
    const looksLikeQuestion =
      /^(how|what|why|when|where|who|can|could|should|do|does|did|is|are|am|will)\b/i.test(text);
    text = `${text}${looksLikeQuestion ? '?' : '.'}`;
  }

  return text;
}
