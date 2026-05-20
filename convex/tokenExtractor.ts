/**
 * Extracts an explicit token mention from transcript text.
 * Returns the token symbol if the user explicitly named a non-USDC token,
 * or null if no override is needed (ambiguous, no mention, or USDC).
 *
 * Follows the same post-processing pattern as delayExtractor.ts —
 * GPT-4o-mini sometimes ignores explicit token names and defaults to USDC.
 */

const TOKEN_PATTERNS: [string, RegExp][] = [
  ["USDT", /\busdt\b|\busd\s*t\b|\btether\b/i],
  ["ETH", /\beth\b|\bethereum\b|\bether\b/i],
  ["HTT", /\bhtt\b|\bhoodi\b|\btest\s*token\b/i],
];

export function extractTokenFromTranscript(text: string): string | null {
  const matches: string[] = [];

  for (const [symbol, pattern] of TOKEN_PATTERNS) {
    if (pattern.test(text)) {
      matches.push(symbol);
    }
  }

  // Only override when exactly one non-USDC token is found
  return matches.length === 1 ? matches[0] : null;
}
