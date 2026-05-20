/**
 * Extracts a delay in seconds from transcript text like "after 30 seconds",
 * "in 2 minutes", "after thirty seconds", etc.
 * Handles both digit and spoken-word numbers.
 * Returns total seconds, or null if no delay pattern found.
 */

const WORD_TO_NUM: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
  thirty: 30, forty: 40, fifty: 50, sixty: 60,
  // Tagalog numbers
  isa: 1, dalawa: 2, tatlo: 3, apat: 4, lima: 5,
  anim: 6, pito: 7, walo: 8, siyam: 9, sampu: 10,
};

// Match compound numbers like "twenty five" → 25
function parseSpokenNumber(text: string): number | null {
  // Try digit first
  const digitMatch = text.match(/^\d+$/);
  if (digitMatch) return parseInt(text);

  // Try single word
  const single = WORD_TO_NUM[text.trim()];
  if (single !== undefined) return single;

  // Try compound like "twenty five"
  const parts = text.trim().split(/[\s-]+/);
  if (parts.length === 2) {
    const tens = WORD_TO_NUM[parts[0]];
    const ones = WORD_TO_NUM[parts[1]];
    if (tens !== undefined && ones !== undefined && tens >= 20) {
      return tens + ones;
    }
  }

  return null;
}

const DELAY_PATTERN = /\b(?:after|in|pagkatapos(?:\s+ng)?|mamaya(?:\s+after)?)\s+(.+?)\s*(second|seconds|sec|secs|minute|minutes|min|mins)\b/i;

export function extractDelaySeconds(text: string): number | null {
  const lower = text.toLowerCase();
  const match = lower.match(DELAY_PATTERN);
  if (!match) return null;

  const numText = match[1].trim();
  const unit = match[2].toLowerCase();

  const num = parseSpokenNumber(numText);
  if (num === null || num <= 0) return null;

  return unit.startsWith("min") ? num * 60 : num;
}
